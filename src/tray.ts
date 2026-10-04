import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  Tray,
} from "electron";
import path from "path";
import log from "electron-log/main";
import { getTrayStrings, type TrayStrings } from "./i18n";
import { getAssetPath, getProductInfo } from "./paths";
import {
  Player,
  isTerminalPlaybackState,
  type NowPlayingPayload,
} from "./player";
import {
  getNotificationsEnabled,
  getLastfmEnabled,
  getLastfmSessionKey,
  getLastfmUsername,
  getCloseToTrayEnabled,
} from "./config";
import { showAboutWindow } from "./aboutWindow";
import { isConfigured as isLastfmConfigured } from "./integrations/lastfm";
import { applySettingsAction, getSettingsState } from "./settings";
import { downloadArtwork } from "./artwork";
import { sendCommand } from "./commandBridge";
import { createPauseEdgeTimer } from "./pauseTimer";

const trayLog = log.scope("tray");

const iconsDir = getAssetPath("assets", "icons");
const menuIconsDir = path.join(iconsDir, "tray", "menu");

/** Menu actions with an icon, checked at call sites. */
export type MenuIconKey =
  | "about"
  | "player"
  | "start-page"
  | "notifications"
  | "lastfm"
  | "zoom"
  | "quit"
  | "artist"
  | "album"
  | "record-vinyl"
  | "previous"
  | "play"
  | "pause"
  | "next"
  | "volume"
  | "close-to-tray"
  | "show-window"
  | "hide-window";

// Maps tray action keys to PNG basenames (without extension) in assets/icons/tray/menu/{light,dark}/
const menuIconFileMap: Record<MenuIconKey, string> = {
  about: "circle-info",
  player: "headphones",
  "start-page": "music",
  notifications: "bell",
  lastfm: "lastfm",
  zoom: "expand",
  quit: "eject",
  artist: "star",
  album: "compact-disc",
  "record-vinyl": "record-vinyl",
  previous: "backward-step",
  play: "play",
  pause: "pause",
  next: "forward-step",
  volume: "volume",
  "close-to-tray": "toggle-on",
  "show-window": "eye",
  "hide-window": "eye-slash",
};

/**
 * Icon for a menu action, or undefined when its PNG is missing. Callers spread
 * the result conditionally, because Electron renders a blank gutter for an
 * empty NativeImage.
 */
export function getMenuIcon(
  action: MenuIconKey,
): Electron.NativeImage | undefined {
  const variant = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const iconPath = path.join(
    menuIconsDir,
    variant,
    `${menuIconFileMap[action]}.png`,
  );
  const source = nativeImage.createFromPath(iconPath);
  return source.isEmpty() ? undefined : source;
}

function isGnomeSession(): boolean {
  return (
    process.env.XDG_CURRENT_DESKTOP?.toLowerCase()
      .split(":")
      .includes("gnome") ?? false
  );
}

// Pantheon's panel is dark whatever the colour scheme, and its indicators are
// white symbolic glyphs.
function isPantheonSession(): boolean {
  return (
    process.env.XDG_CURRENT_DESKTOP?.toLowerCase()
      .split(":")
      .includes("pantheon") ?? false
  );
}

function getLinuxTrayIconPath(): string {
  if (isPantheonSession()) {
    return path.join(iconsDir, "sidra-tray-dark.png");
  }
  if (isGnomeSession()) {
    return path.join(iconsDir, "sidra-tray-outline.png");
  }

  return nativeTheme.shouldUseDarkColors
    ? path.join(iconsDir, "sidra-tray-dark.png")
    : path.join(iconsDir, "sidra-tray-light.png");
}

function escapePango(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Replaces `&` with a fullwidth ampersand (U+FF06) for Linux menu labels.
 * Electron escapes labels only partially for GTK/Pango and leaves a bare `&`,
 * which Pango reads as the start of a markup entity and then rejects the label.
 */
export function sanitiseLinuxLabel(text: string): string {
  return text.replace(/&/g, "\uFF06");
}

/**
 * Remove parenthesised or bracketed qualifiers, then limit metadata row width
 * to maxLength characters plus an ellipsis.
 */
export function truncateMenuLabel(text: string, maxLength = 32): string {
  const splitIndex = text.search(/[([]/);
  const trimmed = splitIndex > 0 ? text.slice(0, splitIndex).trimEnd() : text;
  return trimmed.length > maxLength
    ? trimmed.slice(0, maxLength).trimEnd() + "…"
    : trimmed;
}

interface NowPlayingState {
  payload: NowPlayingPayload | null;
  artworkPath: string | null;
  isPlaying: boolean;
  volume: number;
}

// The single copy of what the Now Playing rows render. It is module scope
// because the menu builders run outside initTrayStateManager, reached from
// rebuildTrayMenu and from the tray's own click and theme handlers, so the
// handlers there update these fields rather than keeping a second copy.
const nowPlayingState: NowPlayingState = {
  payload: null,
  artworkPath: null,
  isPlaying: false,
  volume: 1,
};
let getMainWindowCallback: (() => BrowserWindow | null) | null = null;

interface SubmenuContext {
  strings: TrayStrings;
  refresh: () => void;
}

function buildChoiceSubmenu(
  label: string,
  iconKey: MenuIconKey,
  selected: string | number,
  options: { value: string | number; label: string }[],
  action: (value: string | number) => unknown,
): Electron.MenuItemConstructorOptions {
  const icon = getMenuIcon(iconKey);
  const selectedLabel =
    options.find((option) => option.value === selected)?.label ??
    `${Math.round(Number(selected) * 100)}%`;
  return {
    label: `${label}: ${selectedLabel}`,
    ...(icon ? { icon } : {}),
    submenu: options.map((option) => ({
      label: option.label,
      type: "radio" as const,
      checked: selected === option.value,
      click: () => {
        applySettingsAction(action(option.value));
      },
    })),
  };
}

function buildPlayerSubmenu(
  ctx: SubmenuContext,
): Electron.MenuItemConstructorOptions {
  const state = getSettingsState();
  return buildChoiceSubmenu(
    ctx.strings.player,
    "player",
    state.musicService,
    state.options.musicService,
    (value) => ({ type: "musicService", value }),
  );
}

function buildStartPageSubmenu(
  ctx: SubmenuContext,
): Electron.MenuItemConstructorOptions {
  const state = getSettingsState();
  return buildChoiceSubmenu(
    ctx.strings.startPage,
    "start-page",
    state.startPage,
    state.options.startPage,
    (value) => ({ type: "startPage", serviceId: state.musicService, value }),
  );
}

function buildToggleSubmenu(
  label: string,
  iconKey: MenuIconKey,
  enabled: boolean,
  type: "notifications" | "closeToTray" | "lastfmEnabled",
  ctx: SubmenuContext,
  extraItems: Electron.MenuItemConstructorOptions[] = [],
): Electron.MenuItemConstructorOptions {
  const icon = getMenuIcon(iconKey);
  return {
    label: `${label}: ${enabled ? ctx.strings.on : ctx.strings.off}`,
    ...(icon ? { icon } : {}),
    submenu: [
      ...[true, false].map((value) => ({
        label: value ? ctx.strings.on : ctx.strings.off,
        type: "radio" as const,
        checked: enabled === value,
        click: () => {
          applySettingsAction({ type, value });
        },
      })),
      ...extraItems,
    ],
  };
}

function buildNotificationsSubmenu(
  ctx: SubmenuContext,
): Electron.MenuItemConstructorOptions {
  return buildToggleSubmenu(
    ctx.strings.notifications,
    "notifications",
    getNotificationsEnabled(),
    "notifications",
    ctx,
  );
}

function buildCloseToTraySubmenu(
  ctx: SubmenuContext,
): Electron.MenuItemConstructorOptions {
  return buildToggleSubmenu(
    ctx.strings.closeToTray,
    "close-to-tray",
    getCloseToTrayEnabled(),
    "closeToTray",
    ctx,
  );
}

function buildLastfmSubmenu(
  ctx: SubmenuContext,
): Electron.MenuItemConstructorOptions {
  if (!getLastfmSessionKey()) {
    const icon = getMenuIcon("lastfm");
    return {
      label: "Last.fm",
      ...(icon ? { icon } : {}),
      submenu: [
        {
          label: ctx.strings.lastfmConnect,
          click: () => {
            applySettingsAction({ type: "lastfmConnect" });
          },
        },
      ],
    };
  }
  return buildToggleSubmenu(
    "Last.fm",
    "lastfm",
    getLastfmEnabled(),
    "lastfmEnabled",
    ctx,
    [
      { type: "separator" },
      { label: `✓ ${getLastfmUsername()}`, enabled: false },
      {
        label: ctx.strings.lastfmDisconnect,
        click: () => {
          applySettingsAction({ type: "lastfmDisconnect" });
        },
      },
    ],
  );
}

function buildZoomSubmenu(
  ctx: SubmenuContext,
): Electron.MenuItemConstructorOptions {
  const state = getSettingsState();
  return buildChoiceSubmenu(
    ctx.strings.zoom,
    "zoom",
    state.zoomFactor,
    state.options.zoomFactor,
    (value) => ({ type: "zoomFactor", value }),
  );
}

// 0 is offered as Mute; the other four take their label from the value.
const VOLUME_LEVELS = [0, 0.25, 0.5, 0.75, 1];

function buildVolumeSubmenu(
  strings: TrayStrings,
  volume: number,
): Electron.MenuItemConstructorOptions {
  const icon = getMenuIcon("volume");
  return {
    label: `${strings.volume}: ${Math.round(volume * 100)}%`,
    ...(icon ? { icon } : {}),
    submenu: VOLUME_LEVELS.map((level) => ({
      label: level === 0 ? strings.mute : `${Math.round(level * 100)}%`,
      type: "radio" as const,
      checked: volume === level,
      click: () => sendCommand("player:setVolume", level),
    })),
  };
}

function buildNowPlayingMenuItems(
  strings: TrayStrings,
): Electron.MenuItemConstructorOptions[] {
  const { payload, volume } = nowPlayingState;
  if (!payload) {
    return [];
  }

  // Track details and transport stay in the wingpanel sound indicator, which
  // reads them from MPRIS; repeating them here showed the controls twice.
  return [buildVolumeSubmenu(strings, volume), { type: "separator" }];
}

function buildContextMenu(tray: Tray): Menu {
  const refresh = () => tray.setContextMenu(buildContextMenu(tray));
  const strings = getTrayStrings();
  const ctx: SubmenuContext = { strings, refresh };
  const aboutIcon = getMenuIcon("about");
  const quitIcon = getMenuIcon("quit");

  const showWindowItems: Electron.MenuItemConstructorOptions[] = [];
  if (getCloseToTrayEnabled()) {
    const windowVisible = getMainWindowCallback?.()?.isVisible() ?? true;
    if (windowVisible) {
      const hideIcon = getMenuIcon("hide-window");
      showWindowItems.push({
        label: strings.hideWindow,
        ...(hideIcon ? { icon: hideIcon } : {}),
        click: () => {
          getMainWindowCallback?.()?.hide();
          refresh();
        },
      });
    } else {
      const showIcon = getMenuIcon("show-window");
      showWindowItems.push({
        label: strings.showWindow,
        ...(showIcon ? { icon: showIcon } : {}),
        click: () => {
          const w = getMainWindowCallback?.();
          w?.show();
          w?.focus();
          refresh();
        },
      });
    }
  }

  const menuItems: Electron.MenuItemConstructorOptions[] = [
    ...showWindowItems,
    ...buildNowPlayingMenuItems(strings),
    {
      label: strings.about,
      ...(aboutIcon ? { icon: aboutIcon } : {}),
      click: () => showAboutWindow(),
    },
    buildPlayerSubmenu(ctx),
    buildStartPageSubmenu(ctx),
    buildCloseToTraySubmenu(ctx),
    buildNotificationsSubmenu(ctx),
    ...(isLastfmConfigured() ? [buildLastfmSubmenu(ctx)] : []),
    buildZoomSubmenu(ctx),
    { type: "separator" },
    {
      label: strings.quit,
      ...(quitIcon ? { icon: quitIcon } : {}),
      click: () => app.quit(),
    },
  ];

  return Menu.buildFromTemplate(menuItems);
}

/** Supply the current main window for tray visibility controls. */
export function setGetMainWindowCallback(
  callback: () => BrowserWindow | null,
): void {
  getMainWindowCallback = callback;
}

/**
 * Merge only supplied fields so volume and playback updates preserve track metadata and artwork.
 */
export function updateNowPlayingState(update: Partial<NowPlayingState>): void {
  Object.assign(nowPlayingState, update);
}

/** Rebuild the menu from current settings and cached Now Playing state. */
export function rebuildTrayMenu(tray: Tray): void {
  tray.setContextMenu(buildContextMenu(tray));
}

// Coalesce event bursts because each rebuild recreates submenus and resizes artwork.
const TRAY_REBUILD_COALESCE_MS = 250;

let rebuildTimer: NodeJS.Timeout | null = null;
let pendingRebuildTray: Tray | null = null;

// A fixed window rather than a debounce: a debounce that restarts on every
// event never expires under a sustained flood, so the menu would never rebuild.
function scheduleTrayRebuild(tray: Tray): void {
  pendingRebuildTray = tray;
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    const target = pendingRebuildTray;
    pendingRebuildTray = null;
    if (target) rebuildTrayMenu(target);
  }, TRAY_REBUILD_COALESCE_MS);
}

/** Cancel a pending rebuild and release its tray and icon resources. */
export function cancelTrayRebuild(): void {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
  pendingRebuildTray = null;
}

/** Show track details or the product name, escaping Linux tooltip markup. */
export function updateTrayTooltip(
  tray: Tray,
  payload: NowPlayingPayload | null,
): void {
  const fallback = getProductInfo().productName;
  const text = payload?.name
    ? payload.artistName
      ? `${payload.name} - ${payload.artistName}`
      : payload.name
    : fallback;
  const tooltip = text || fallback;
  const escaped = escapePango(tooltip);
  trayLog.debug(
    "updateTrayTooltip:",
    payload
      ? `name=${payload.name}, artistName=${payload.artistName}`
      : "null payload",
    "->",
    `"${escaped}"`,
  );
  tray.setToolTip(escaped);
}

/** Create the platform tray icon, menu and visibility handlers. */
export function createTray(): Tray {
  const iconPath = getLinuxTrayIconPath();
  trayLog.info("creating tray with icon:", iconPath);

  const tray = new Tray(iconPath);
  tray.setToolTip(getProductInfo().productName);

  tray.setContextMenu(buildContextMenu(tray));

  tray.on("click", () => {
    if (!getCloseToTrayEnabled()) return;
    const mainWin = getMainWindowCallback?.();
    if (!mainWin) return;
    if (mainWin.isVisible()) {
      mainWin.focus();
    } else {
      mainWin.show();
      mainWin.focus();
      rebuildTrayMenu(tray);
    }
  });

  nativeTheme.on("updated", () => {
    if (!isGnomeSession()) {
      const newIconPath = getLinuxTrayIconPath();
      trayLog.info("theme changed, switching tray icon:", newIconPath);
      tray.setImage(newIconPath);
    }
    trayLog.info("theme changed, rebuilding context menu");
    tray.setContextMenu(buildContextMenu(tray));
  });

  trayLog.info("tray created");

  return tray;
}

/**
 * Update the tray from playback events and clear Now Playing after a sustained
 * pause. Register the returned teardown on will-quit to destroy the pause timer,
 * cancel pending rebuilds and remove player listeners.
 */
export function initTrayStateManager(player: Player, tray: Tray): () => void {
  const TRAY_PAUSE_TIMEOUT_MS = 30_000;
  // Reject artwork for superseded tracks before committing it with metadata.
  let pendingPayload: NowPlayingPayload | null = null;

  // Volume is left as it stands: it belongs to the player, not to the track
  // that has just gone.
  const clearNowPlaying = (): void => {
    pendingPayload = null;
    updateTrayTooltip(tray, null);
    updateNowPlayingState({
      payload: null,
      artworkPath: null,
      isPlaying: false,
    });
    scheduleTrayRebuild(tray);
  };

  const trayPauseTimer = createPauseEdgeTimer(TRAY_PAUSE_TIMEOUT_MS, () => {
    trayLog.debug("tray pause timeout reached, clearing Now Playing");
    clearNowPlaying();
  });

  const onNowPlayingItemDidChange = async (
    payload: NowPlayingPayload | null,
  ): Promise<void> => {
    trayPauseTimer.cancel();
    if (!payload) {
      trayLog.debug(
        "nowPlayingItemDidChange (tray handler): null payload, clearing state",
      );
      clearNowPlaying();
      return;
    }
    trayLog.debug(
      "nowPlayingItemDidChange (tray handler):",
      `"${payload.name}"`,
    );
    pendingPayload = payload;
    updateTrayTooltip(tray, payload);
    let artworkPath: string | null = null;
    if (payload.artworkUrl) {
      artworkPath = await downloadArtwork(payload.artworkUrl);
      if (pendingPayload !== payload) return;
    }
    const { isPlaying } = player.playbackSnapshot();
    updateNowPlayingState({ payload, artworkPath, isPlaying });
    scheduleTrayRebuild(tray);
  };

  const onPlaybackStateDidChange = (
    payload: { status: boolean; state: number } | null,
  ): void => {
    const state = payload?.state ?? 0;
    if (isTerminalPlaybackState(state)) {
      trayPauseTimer.cancel();
      clearNowPlaying();
      return;
    }
    const { isPlaying } = player.playbackSnapshot();

    trayPauseTimer.report(isPlaying);

    updateNowPlayingState({ isPlaying });
    scheduleTrayRebuild(tray);
  };

  const onVolumeDidChange = (volume: number | null): void => {
    if (volume == null) return;
    const { isPlaying } = player.playbackSnapshot();
    updateNowPlayingState({ volume, isPlaying });
    scheduleTrayRebuild(tray);
  };

  player.on("nowPlayingItemDidChange", onNowPlayingItemDidChange);
  player.on("playbackStateDidChange", onPlaybackStateDidChange);
  player.on("volumeDidChange", onVolumeDidChange);

  return () => {
    trayPauseTimer.destroy();
    cancelTrayRebuild();
    player.off("nowPlayingItemDidChange", onNowPlayingItemDidChange);
    player.off("playbackStateDidChange", onPlaybackStateDidChange);
    player.off("volumeDidChange", onVolumeDidChange);
  };
}
