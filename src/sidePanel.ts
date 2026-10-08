// Cassette's side panel: lyrics, the queue and search, drawn natively from
// assets/panel.{html,css,js} in a view on the right of the window, under the
// header bar. Apple's own side panels and search page stay where they are; the
// header bar buttons open this one instead.
//
// Data comes from MusicKit in Apple's page through executeJavaScript(), with
// fixed scripts: the only value that reaches one from outside is the search
// term, passed through JSON.stringify(). What comes back is checked and
// trimmed here before the panel sees it, and the panel names rows by index
// into what main sent, so it can only play or open something listed here.

import path from "path";
import {
  ipcMain,
  WebContentsView,
  type BrowserWindow,
  type IpcMainEvent,
} from "electron";
import log from "electron-log/main";
import { getAssetPath } from "./paths";
import { isAllowedNavigationUrl } from "./musicService";
import { routeToMusicService } from "./serviceSwitch";
import type { NowPlayingPayload, Player } from "./player";
import type {
  LyricsState,
  PanelAction,
  PanelRow,
  PanelState,
  PanelTab,
  SearchRow,
} from "./panelTypes";

const panelLog = log.scope("panel");

/** Width of the panel, as elementary Music's side pane. */
export const PANEL_WIDTH_PX = 360;
/** Queue rows sent to the panel at most. */
const MAX_QUEUE_ROWS = 200;
/** Search terms longer than this are cut. */
const MAX_TERM_LENGTH = 200;
const MAX_TEXT = 300;
/** Position updates to the lyrics at most this often. */
const POSITION_INTERVAL_MS = 200;

const TABS: readonly PanelTab[] = ["lyrics", "queue", "search"];
const RESULT_KINDS = new Set(["song", "album", "artist", "playlist"]);

// --- Scripts run in Apple's page --------------------------------------------

const QUEUE_SCRIPT = `(() => {
  const mk = window.MusicKit && MusicKit.getInstance();
  if (!mk || !mk.queue) return null;
  return {
    position: mk.queue.position,
    items: mk.queue.items.slice(0, ${MAX_QUEUE_ROWS}).map((i) => ({
      title: i.attributes?.name ?? i.title ?? "",
      subtitle: i.attributes?.artistName ?? i.artistName ?? "",
      artwork: i.attributes?.artwork?.url ?? "",
    })),
  };
})()`;

const LYRICS_SCRIPT = `(async () => {
  const mk = window.MusicKit && MusicKit.getInstance();
  const item = mk && mk.nowPlayingItem;
  if (!item) return { status: "empty" };
  const p = item.attributes?.playParams ?? {};
  const id = p.catalogId ?? (p.kind === "song" && !p.isLibrary ? p.id : null) ?? (/^\\d+$/.test(item.id) ? item.id : null);
  if (!id || (item.type !== "song" && item.type !== "songs" && p.kind !== "song")) return { status: "none" };
  try {
    const r = await mk.api.music("/v1/catalog/{{storefrontId}}/songs/" + encodeURIComponent(id) + "/lyrics");
    const ttml = r?.data?.data?.[0]?.attributes?.ttml;
    return typeof ttml === "string" && ttml ? { status: "ok", ttml } : { status: "none" };
  } catch (e) {
    return { status: e && (e.errorCode === "NOT_FOUND" || e.status === 404 || /404|not found/i.test(String(e.message))) ? "none" : "error" };
  }
})()`;

function searchScript(term: string): string {
  return `(async () => {
  const mk = window.MusicKit && MusicKit.getInstance();
  if (!mk) return null;
  const r = await mk.api.music("/v1/catalog/{{storefrontId}}/search", {
    term: ${JSON.stringify(term)},
    types: "songs,albums,artists,playlists",
    limit: 8,
  });
  const res = r?.data?.results ?? {};
  const out = [];
  for (const [type, kind] of [["songs", "song"], ["albums", "album"], ["artists", "artist"], ["playlists", "playlist"]]) {
    for (const d of res[type]?.data ?? []) {
      const a = d.attributes ?? {};
      out.push({
        kind, id: d.id, url: a.url ?? "",
        title: a.name ?? "",
        subtitle: a.artistName ?? a.curatorName ?? "",
        artwork: a.artwork?.url ?? "",
      });
    }
  }
  return out;
})()`;
}

function playQueueScript(index: number): string {
  return `(() => { const mk = MusicKit.getInstance(); return mk.changeToMediaAtIndex(${index}).then(() => mk.play()).then(() => true); })()`;
}

function playSongScript(id: string): string {
  return `(() => MusicKit.getInstance().setQueue({ song: ${JSON.stringify(id)}, startPlaying: true }).then(() => true))()`;
}

// --- Checks on what came back ------------------------------------------------

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : "";
}

/** Apple's artwork template at thumbnail size, or "" unless it is on mzstatic.com. */
export function artworkUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.replace("{w}", "96").replace("{h}", "96").replace("{f}", "jpg");
  return /^https:\/\/[a-z0-9.-]+\.mzstatic\.com\/[^\s"'<>]*$/i.test(url) ? url : "";
}

function row(value: unknown): PanelRow | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  return { title: text(v.title), subtitle: text(v.subtitle), artwork: artworkUrl(v.artwork) };
}

interface SearchHit extends SearchRow {
  id: string;
  url: string;
}

function searchHit(value: unknown): SearchHit | null {
  const base = row(value);
  if (!base) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || !RESULT_KINDS.has(v.kind)) return null;
  if (typeof v.id !== "string" || !/^[\w.-]{1,64}$/.test(v.id)) return null;
  return {
    ...base,
    kind: v.kind as SearchRow["kind"],
    id: v.id,
    url: typeof v.url === "string" ? v.url : "",
  };
}

function lyricsState(value: unknown): LyricsState {
  if (typeof value !== "object" || value === null) return { status: "error" };
  const v = value as Record<string, unknown>;
  if (v.status === "ok" && typeof v.ttml === "string" && v.ttml.length < 2_000_000)
    return { status: "ok", ttml: v.ttml };
  if (v.status === "none" || v.status === "empty") return { status: v.status };
  return { status: "error" };
}

/** Validate a panel action against the rows main last sent. */
export function isPanelAction(value: unknown): value is PanelAction {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "close":
      return true;
    case "tab":
      return TABS.includes(v.tab as PanelTab);
    case "search":
      return typeof v.term === "string";
    case "playQueueItem":
    case "openResult":
      return Number.isInteger(v.index) && (v.index as number) >= 0;
    default:
      return false;
  }
}

// --- The panel ---------------------------------------------------------------

export interface SidePanel {
  /** Open on a tab, or close when that tab is already showing. */
  toggle: (tab: PanelTab) => void;
  close: () => void;
  /** The tab showing, or null when closed. */
  current: () => PanelTab | null;
  /** Called whenever the panel opens, closes or changes tab. */
  onChange: (listener: () => void) => void;
}

/** Add the side panel to the main window. Call once. */
export function createSidePanel(
  win: BrowserWindow,
  player: Player,
  topInset: number,
): SidePanel {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "panelPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  view.setVisible(false);
  win.contentView.addChildView(view);

  let open = false;
  let tab: PanelTab = "lyrics";
  let track = "";
  let lyrics: LyricsState = { status: "empty" };
  let lyricsFor: string | null = null;
  let queue: { items: PanelRow[]; position: number } = { items: [], position: -1 };
  let term = "";
  let searchStatus: PanelState["search"]["status"] = "idle";
  let hits: SearchHit[] = [];
  let searchGeneration = 0;
  let changeListener: (() => void) | null = null;

  const page = (): Electron.WebContents | null =>
    win.isDestroyed() || win.webContents.isDestroyed() ? null : win.webContents;

  const run = (script: string): Promise<unknown> => {
    const contents = page();
    if (!contents) return Promise.resolve(null);
    return contents.executeJavaScript(script);
  };

  const state = (): PanelState => ({
    tab,
    track,
    lyrics,
    queue,
    search: {
      term,
      status: searchStatus,
      results: hits.map(({ kind, title, subtitle, artwork }) => ({ kind, title, subtitle, artwork })),
    },
  });

  const push = (): void => {
    if (view.webContents.isDestroyed()) return;
    view.webContents.send("cassette-panel:state", state());
  };

  const layout = (): void => {
    if (win.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    const panelWidth = Math.min(PANEL_WIDTH_PX, width);
    view.setBounds({
      x: width - panelWidth,
      y: topInset,
      width: panelWidth,
      height: Math.max(0, height - topInset),
    });
  };

  const refreshQueue = (): void => {
    run(QUEUE_SCRIPT)
      .then((value) => {
        if (typeof value !== "object" || value === null) return;
        const v = value as Record<string, unknown>;
        const items = Array.isArray(v.items)
          ? v.items.map(row).filter((r): r is PanelRow => r !== null)
          : [];
        const position = Number.isInteger(v.position) ? (v.position as number) : -1;
        queue = { items, position };
        push();
      })
      .catch(() => panelLog.warn("queue read failed"));
  };

  const refreshLyrics = (force = false): void => {
    const key = track;
    if (!force && lyricsFor === key && lyrics.status !== "error") return;
    lyricsFor = key;
    lyrics = key ? { status: "loading" } : { status: "empty" };
    push();
    if (!key) return;
    run(LYRICS_SCRIPT)
      .then((value) => {
        if (lyricsFor !== key) return;
        lyrics = lyricsState(value);
        push();
      })
      .catch(() => {
        if (lyricsFor !== key) return;
        lyrics = { status: "error" };
        push();
      });
  };

  const refreshTab = (): void => {
    if (!open) return;
    if (tab === "queue") refreshQueue();
    else if (tab === "lyrics") refreshLyrics();
  };

  const setOpen = (next: boolean): void => {
    open = next;
    view.setVisible(next);
    if (next) {
      layout();
      push();
      refreshTab();
      if (tab === "search") view.webContents.focus();
    }
    changeListener?.();
  };

  const search = (raw: string): void => {
    term = raw.trim().slice(0, MAX_TERM_LENGTH);
    const generation = ++searchGeneration;
    if (!term) {
      hits = [];
      searchStatus = "idle";
      push();
      return;
    }
    searchStatus = "loading";
    push();
    run(searchScript(term))
      .then((value) => {
        if (generation !== searchGeneration) return;
        hits = Array.isArray(value)
          ? value.map(searchHit).filter((h): h is SearchHit => h !== null)
          : [];
        searchStatus = "ok";
        push();
      })
      .catch(() => {
        if (generation !== searchGeneration) return;
        hits = [];
        searchStatus = "error";
        push();
        panelLog.warn("search failed");
      });
  };

  const openResult = (index: number): void => {
    const hit = hits[index];
    if (!hit) return;
    if (hit.kind === "song") {
      run(playSongScript(hit.id)).catch(() => panelLog.warn("could not play the result"));
      return;
    }
    if (!isAllowedNavigationUrl(hit.url)) {
      panelLog.warn("refused a result URL outside the service hosts");
      return;
    }
    routeToMusicService(hit.url);
  };

  const onAction = (event: IpcMainEvent, action: unknown): void => {
    if (event.sender !== view.webContents) return;
    if (!isPanelAction(action)) {
      panelLog.warn("refused panel action");
      return;
    }
    switch (action.type) {
      case "close":
        setOpen(false);
        break;
      case "tab":
        tab = action.tab;
        push();
        refreshTab();
        changeListener?.();
        break;
      case "search":
        search(action.term);
        break;
      case "playQueueItem":
        if (action.index < queue.items.length)
          run(playQueueScript(action.index))
            .then(refreshQueue)
            .catch(() => panelLog.warn("could not play the queue item"));
        break;
      case "openResult":
        openResult(action.index);
        break;
    }
  };
  const onReady = (event: IpcMainEvent): void => {
    if (event.sender === view.webContents) push();
  };

  const onItem = (payload: NowPlayingPayload | null): void => {
    track = payload?.name ? text(payload.name) : "";
    lyricsFor = null;
    push();
    refreshTab();
  };
  let lastPositionAt = 0;
  const onTime = (positionUs: number): void => {
    if (!open || tab !== "lyrics") return;
    const now = Date.now();
    if (now - lastPositionAt < POSITION_INTERVAL_MS) return;
    lastPositionAt = now;
    if (!view.webContents.isDestroyed())
      view.webContents.send("cassette-panel:position", positionUs / 1e6);
  };

  ipcMain.on("cassette-panel:action", onAction);
  ipcMain.on("cassette-panel:ready", onReady);
  player.on("nowPlayingItemDidChange", onItem);
  player.on("playbackTimeDidChange", onTime);
  win.on("resize", layout);

  win.once("closed", () => {
    ipcMain.removeListener("cassette-panel:action", onAction);
    ipcMain.removeListener("cassette-panel:ready", onReady);
    player.removeListener("nowPlayingItemDidChange", onItem);
    player.removeListener("playbackTimeDidChange", onTime);
  });

  void view.webContents
    .loadFile(getAssetPath("assets", "panel.html"))
    .catch((err: unknown) => panelLog.warn("panel failed to load", err));

  return {
    toggle: (next) => {
      if (open && tab === next) {
        setOpen(false);
        return;
      }
      tab = next;
      if (open) {
        push();
        refreshTab();
        if (next === "search") view.webContents.focus();
        changeListener?.();
      } else setOpen(true);
    },
    close: () => {
      if (open) setOpen(false);
    },
    current: () => (open ? tab : null),
    onChange: (listener) => {
      changeListener = listener;
    },
  };
}
