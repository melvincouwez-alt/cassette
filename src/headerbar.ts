// Cassette's header bar on Linux. The frame's title bar is hidden (src/windowChrome.ts)
// and its window buttons float over the top of the window; a separate view,
// drawn from assets/headerbar.html, fills the strip under them as an
// elementary HeaderBar in Cassette's raspberry: back and forward, the page title
// and the settings button, clear of the buttons on either side. Apple's page is
// shifted down by the same height (TITLEBAR_CSS in src/elementaryCss.ts).
//
// The same view covers the whole window while Apple's page loads, showing the
// window colour and a spinner, so the window can open at once instead of after
// a splash screen; reveal() fades that cover out and shrinks the view back to
// the bar.

import path from "path";
import {
  ipcMain,
  nativeTheme,
  WebContentsView,
  type BrowserWindow,
  type IpcMainEvent,
} from "electron";
import log from "electron-log/main";
import { getAssetPath } from "./paths";
import type { HeaderAction, HeaderState, HeaderTrack } from "./headerbarTypes";
import type {
  NowPlayingPayload,
  PlaybackCapabilities,
  PlaybackStatePayload,
  Player,
  TimedMetadataPayload,
} from "./player";
import { sendCommand } from "./commandBridge";
import { devCapture } from "./devProbe";

const headerLog = log.scope("headerbar");

/** Height of the bar, as an elementary HeaderBar with image buttons. */
export const HEADERBAR_HEIGHT_PX = 48;

/** The page's titlebar area: [x, width], or null without an overlay. */
const WCO_PROBE = `(() => {
  const o = navigator.windowControlsOverlay;
  if (!o || !o.visible) return null;
  const r = o.getTitlebarAreaRect();
  return [r.x, r.width];
})()`;

/** Fade time of the start-up cover in assets/headerbar.css, plus a frame. */
const REVEAL_FADE_MS = 240;

/** Window colour behind everything, matching the header bar's page colour. */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? "#333333" : "#fafafa";
}

/** Apple Music titles its pages "Page - Apple Music"; the bar shows the page. */
export function pageTitle(documentTitle: string): string {
  const title = documentTitle
    // Apple prefixes some titles with bidi marks, which \s does not match.
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s*[-–—|]\s*Apple\s+Music(\s+Classical)?\s*$/i, "")
    .trim();
  return title === "" || /^Apple\s+Music/i.test(title) ? "Cassette" : title;
}

export interface HeaderbarHandlers {
  back: () => void;
  forward: () => void;
  settings: () => void;
  player: Player;
}

/** Apple's own buttons, left in the hidden player bar, that open its side panels. */
const APPLE_PANEL_BUTTON: Record<"queue" | "lyrics", string> = {
  queue: ".up-next-queue__button",
  lyrics: '.player-bar button[class*="lyrics"]',
};

/** Position updates to the header bar at most this often. */
const POSITION_INTERVAL_MS = 500;

function trackFrom(payload: NowPlayingPayload | null): HeaderTrack | null {
  if (!payload?.name) return null;
  return {
    title: payload.name,
    artist: payload.artistName ?? "",
    artwork: payload.artworkUrl ?? "",
  };
}

export interface Headerbar {
  /** Fade out the start-up cover once Apple's page has drawn. */
  reveal: () => void;
}

/** Add the header bar to a frameless window. Call once. */
export function createHeaderbar(
  win: BrowserWindow,
  handlers: HeaderbarHandlers,
): Headerbar {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "headerbarPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  view.setBackgroundColor("#00000000");
  win.contentView.addChildView(view);

  let loading = true;
  let title = "Cassette";
  let insetStart = 0;
  let insetEnd = 0;
  const { player } = handlers;
  let track: HeaderTrack | null = null;
  let playing = player.playbackSnapshot().isPlaying;
  let capabilities: PlaybackCapabilities = player.capabilitiesSnapshot();
  let shuffle = false;
  let repeat = 0;
  let volume = 1;
  // Level restored when the mute button is pressed again.
  let unmutedVolume = 1;

  const layout = (): void => {
    if (win.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    view.setBounds({
      x: 0,
      y: 0,
      width,
      height: loading ? height : HEADERBAR_HEIGHT_PX,
    });
  };

  const state = (): HeaderState => {
    const history = win.webContents.navigationHistory;
    return {
      title,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      loading,
      insetStart,
      insetEnd,
      track,
      playing,
      duration: capabilities.durationUs ? capabilities.durationUs / 1e6 : 0,
      canSeek: capabilities.canSeek !== false && !!capabilities.durationUs,
      shuffle,
      repeat,
      volume,
    };
  };

  const push = (): void => {
    if (win.isDestroyed() || view.webContents.isDestroyed()) return;
    view.webContents.send("aria-header:state", state());
  };

  // Only the page carries the Window Controls Overlay API, so the free strip
  // between the frame's buttons is read there and handed to the header view.
  const measureInsets = (): void => {
    const contents = win.isDestroyed() ? null : win.webContents;
    if (!contents || contents.isDestroyed()) return;
    contents
      .executeJavaScript(WCO_PROBE)
      .then((rect: unknown) => {
        if (!Array.isArray(rect) || rect.length !== 2) return;
        const [x, width] = rect as number[];
        const total = win.getContentBounds().width;
        const start = Math.max(0, Math.round(x));
        const end = Math.max(0, Math.round(total - x - width));
        if (start === insetStart && end === insetEnd) return;
        insetStart = start;
        insetEnd = end;
        headerLog.debug(`window buttons take ${start}px / ${end}px`);
        push();
      })
      .catch(() => undefined);
  };
  let measureTimer: NodeJS.Timeout | null = null;
  const remeasure = (): void => {
    if (measureTimer) clearTimeout(measureTimer);
    measureTimer = setTimeout(measureInsets, 100);
  };

  // Up Next and Lyrics stay Apple's side panels; their buttons sit in the
  // player bar, hidden on Linux, and a click on a hidden button still works.
  const openApplePanel = (panel: "queue" | "lyrics"): void => {
    const contents = win.isDestroyed() ? null : win.webContents;
    if (!contents || contents.isDestroyed()) return;
    const selector = JSON.stringify(APPLE_PANEL_BUTTON[panel]);
    contents
      .executeJavaScript(`document.querySelector(${selector})?.click(), true`)
      .catch(() => headerLog.warn(`could not open Apple's ${panel} panel`));
  };

  const actions: Record<HeaderAction, (event: IpcMainEvent) => void> = {
    back: () => handlers.back(),
    forward: () => handlers.forward(),
    settings: () => handlers.settings(),
    playPause: () => sendCommand("player:playPause"),
    previous: () => sendCommand("player:previous"),
    next: () => sendCommand("player:next"),
    shuffle: () => sendCommand("player:setShuffle", shuffle ? 0 : 1),
    // none -> all -> one -> none, as elementary Music cycles it
    repeat: () => sendCommand("player:setRepeat", repeat === 0 ? 2 : repeat === 2 ? 1 : 0),
    queue: () => openApplePanel("queue"),
    lyrics: () => openApplePanel("lyrics"),
    mute: () => sendCommand("player:setVolume", volume > 0 ? 0 : unmutedVolume),
  };

  const onSeek = (event: IpcMainEvent, fraction: unknown): void => {
    if (event.sender !== view.webContents) return;
    if (typeof fraction !== "number" || !(fraction >= 0 && fraction <= 1)) return;
    const duration = capabilities.durationUs ? capabilities.durationUs / 1e6 : 0;
    if (duration > 0) sendCommand("player:seek", fraction * duration);
  };

  const onVolumeInput = (event: IpcMainEvent, fraction: unknown): void => {
    if (event.sender !== view.webContents) return;
    if (typeof fraction !== "number" || !(fraction >= 0 && fraction <= 1)) return;
    sendCommand("player:setVolume", fraction);
  };

  const onItem = (payload: NowPlayingPayload | null): void => {
    track = trackFrom(payload);
    push();
  };
  const onTimed = (payload: TimedMetadataPayload): void => {
    track = { title: payload.name, artist: payload.artistName, artwork: track?.artwork ?? "" };
    push();
  };
  const onState = (payload: PlaybackStatePayload): void => {
    playing = player.playbackSnapshot().isPlaying || payload?.state === 2;
    push();
  };
  const onCapabilities = (payload: PlaybackCapabilities): void => {
    capabilities = payload;
    push();
  };
  const onShuffle = (mode: number | null): void => {
    shuffle = mode === 1;
    push();
  };
  const onRepeat = (mode: number | null): void => {
    repeat = mode ?? 0;
    push();
  };
  const onVolume = (level: number | null): void => {
    if (typeof level !== "number" || !(level >= 0 && level <= 1)) return;
    volume = level;
    if (level > 0) unmutedVolume = level;
    push();
  };
  let lastPositionAt = 0;
  const onTime = (positionUs: number): void => {
    const now = Date.now();
    if (now - lastPositionAt < POSITION_INTERVAL_MS) return;
    lastPositionAt = now;
    if (!view.webContents.isDestroyed())
      view.webContents.send("aria-header:position", positionUs / 1e6);
  };
  player.on("nowPlayingItemDidChange", onItem);
  player.on("timedMetadataDidChange", onTimed);
  player.on("playbackStateDidChange", onState);
  player.on("playbackCapabilitiesDidChange", onCapabilities);
  player.on("shuffleModeDidChange", onShuffle);
  player.on("repeatModeDidChange", onRepeat);
  player.on("playbackTimeDidChange", onTime);
  player.on("volumeDidChange", onVolume);

  // Only the header view may drive these; the preload already filters the
  // action names, and the lookup below refuses anything else that arrives.
  const onAction = (event: IpcMainEvent, action: unknown): void => {
    if (event.sender !== view.webContents) return;
    if (typeof action !== "string" || !Object.hasOwn(actions, action)) {
      headerLog.warn("refused header action");
      return;
    }
    actions[action as HeaderAction](event);
  };
  const onReady = (event: IpcMainEvent): void => {
    if (event.sender === view.webContents) push();
  };
  const onTitle = (_event: Electron.Event, documentTitle: string): void => {
    title = pageTitle(documentTitle);
    headerLog.debug(`title: ${JSON.stringify(documentTitle)} -> ${title}`);
    push();
  };

  ipcMain.on("aria-header:action", onAction);
  ipcMain.on("aria-header:seek", onSeek);
  ipcMain.on("aria-header:volume", onVolumeInput);
  ipcMain.on("aria-header:ready", onReady);
  win.webContents.on("page-title-updated", onTitle);
  win.webContents.on("did-navigate", push);
  win.webContents.on("did-navigate-in-page", push);
  win.webContents.on("dom-ready", remeasure);
  const onResize = (): void => {
    layout();
    remeasure();
  };
  win.on("resize", onResize);
  win.on("maximize", remeasure);
  win.on("unmaximize", remeasure);
  win.on("enter-full-screen", remeasure);
  win.on("leave-full-screen", remeasure);

  win.once("closed", () => {
    ipcMain.removeListener("aria-header:action", onAction);
    ipcMain.removeListener("aria-header:seek", onSeek);
    ipcMain.removeListener("aria-header:volume", onVolumeInput);
    player.removeListener("nowPlayingItemDidChange", onItem);
    player.removeListener("timedMetadataDidChange", onTimed);
    player.removeListener("playbackStateDidChange", onState);
    player.removeListener("playbackCapabilitiesDidChange", onCapabilities);
    player.removeListener("shuffleModeDidChange", onShuffle);
    player.removeListener("repeatModeDidChange", onRepeat);
    player.removeListener("playbackTimeDidChange", onTime);
    player.removeListener("volumeDidChange", onVolume);
    ipcMain.removeListener("aria-header:ready", onReady);
    if (measureTimer) clearTimeout(measureTimer);
  });

  layout();
  devCapture(view.webContents, "cover", 1500);
  void view.webContents
    .loadFile(getAssetPath("assets", "headerbar.html"))
    .catch((err: unknown) => headerLog.warn("header bar failed to load", err));

  return {
    reveal: () => {
      if (!loading) return;
      loading = false;
      push();
      // Shrink the view once the fade has run, or the cover would vanish at once.
      setTimeout(layout, REVEAL_FADE_MS);
      devCapture(view.webContents, "header", 1500);
      headerLog.info("content revealed");
    },
  };
}
