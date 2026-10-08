import type { BrowserWindow } from "electron";
import * as config from "./config";
import { getLoadingText, getTrayStrings, type TrayStrings } from "./i18n";
import {
  MUSIC_SERVICES,
  allServices,
  isMusicServiceId,
  DEFAULT_SERVICE_ID,
  type AnyStartPageId,
  type MusicServiceId,
  type MusicStartPageId,
  type ClassicalStartPageId,
} from "./musicService";

/** Zoom levels that Settings accepts. */
export type ZoomFactor = 1 | 1.25 | 1.5 | 1.75 | 2;
/** Actions that Settings and tray controls accept after runtime validation. */
export type SettingsAction =
  | { type: "musicService"; value: MusicServiceId }
  | { type: "startPage"; serviceId: "music"; value: MusicStartPageId | "last" }
  | {
      type: "startPage";
      serviceId: "classical";
      value: ClassicalStartPageId | "last";
    }
  | { type: "zoomFactor"; value: ZoomFactor }
  | {
      type: "closeToTray" | "notifications";
      value: boolean;
    };

/** A stored option value paired with its display label. */
export interface SettingsOption<T> {
  value: T;
  label: string;
}
/** Current settings, available choices and translated labels for the renderer. */
export interface SettingsState {
  musicService: MusicServiceId;
  startPage: AnyStartPageId | "last";
  zoomFactor: number;
  closeToTray: boolean;
  notifications: boolean;
  options: {
    musicService: SettingsOption<MusicServiceId>[];
    startPage: SettingsOption<AnyStartPageId | "last">[];
    zoomFactor: SettingsOption<ZoomFactor>[];
  };
  labels: TrayStrings;
  lang: string;
}

/** Isolated preload API for the local Settings page. */
export interface SettingsBridge {
  /** Read the current settings and available choices. */
  getState(): Promise<SettingsState>;
  /** Apply a validated action and return the resulting state. */
  apply(action: SettingsAction): Promise<SettingsState>;
  /** Subscribe to state changes and return an unsubscribe function. */
  onState(listener: (state: SettingsState) => void): () => void;
}

interface SettingsRuntime {
  getMainWindow: () => BrowserWindow | null;
  applyZoom: (factor: number) => void;
  switchService: (id: MusicServiceId) => void;
  refreshTray: () => void;
}

let runtime: SettingsRuntime | null = null;
const listeners = new Set<(state: SettingsState) => void>();

/** Connect application callbacks, returning their teardown function. */
export function initSettingsActions(callbacks: SettingsRuntime): () => void {
  runtime = callbacks;
  return () => {
    if (runtime !== callbacks) return;
    runtime = null;
    listeners.clear();
  };
}

/** Map every service's start-page IDs to translated labels. */
export function startPageLabels(
  strings: TrayStrings,
): Record<AnyStartPageId | "last", string> {
  return {
    home: strings.startPageHome,
    new: strings.startPageNew,
    radio: strings.startPageRadio,
    "all-playlists": strings.startPageAllPlaylists,
    browse: strings.startPageBrowse,
    playlists: strings.startPagePlaylists,
    search: strings.startPageSearch,
    last: strings.startPageLast,
  };
}

/** Resolve stored settings against the active service and currently available options. */
export function getSettingsState(): SettingsState {
  const labels = getTrayStrings();
  const storedService = config.getMusicService();
  const musicService = isMusicServiceId(storedService)
    ? storedService
    : DEFAULT_SERVICE_ID;
  const service = MUSIC_SERVICES[musicService];
  const pageLabels = startPageLabels(labels);
  const pages: (AnyStartPageId | "last")[] = [
    ...service.startPages.map((page) => page.id),
    "last",
  ];
  const storedPage = config.getStartPageFor(musicService);
  return {
    musicService,
    startPage: pages.includes(storedPage)
      ? storedPage
      : service.defaultStartPage,
    zoomFactor: config.getZoomFactor(),
    closeToTray: config.getCloseToTrayEnabled(),
    notifications: config.getNotificationsEnabled(),
    options: {
      musicService: allServices().map((service) => ({
        value: service.id,
        label: service.displayName,
      })),
      startPage: pages.map((value) => ({ value, label: pageLabels[value] })),
      zoomFactor: [
        { value: 1, label: labels.zoom100 },
        { value: 1.25, label: labels.zoom125 },
        { value: 1.5, label: labels.zoom150 },
        { value: 1.75, label: labels.zoom175 },
        { value: 2, label: labels.zoom200 },
      ],
    },
    labels,
    lang: getLoadingText().lang,
  };
}

/** Register a state listener and return its unsubscribe function. */
export function subscribeSettingsChanges(
  listener: (state: SettingsState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Send one freshly resolved state to all registered listeners. */
export function notifySettingsChanged(): void {
  if (!listeners.size) return;
  const state = getSettingsState();
  for (const listener of listeners) listener(state);
}

function isSettingsAction(
  action: unknown,
  state: SettingsState,
): action is SettingsAction {
  if (typeof action !== "object" || action === null || Array.isArray(action))
    return false;
  const data = action as Record<string, unknown>;
  const keys =
    data.type === "startPage"
      ? ["type", "value", "serviceId"]
      : ["type", "value"];
  if (
    Object.keys(data).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(data, key))
  )
    return false;
  switch (data.type) {
    case "musicService":
      return state.options.musicService.some(
        (option) => option.value === data.value,
      );
    case "startPage":
      return (
        data.serviceId === state.musicService &&
        state.options.startPage.some((option) => option.value === data.value)
      );
    case "zoomFactor":
      return state.options.zoomFactor.some(
        (option) => option.value === data.value,
      );
    case "closeToTray":
    case "notifications":
      return typeof data.value === "boolean";
    default:
      return false;
  }
}

/** Validate an action against available choices, apply it and refresh the tray and Settings. */
export function applySettingsAction(action: unknown): SettingsState {
  const state = getSettingsState();
  if (!isSettingsAction(action, state))
    throw new Error("Invalid settings action");
  if (!runtime) throw new Error("Settings actions are not initialised");
  switch (action.type) {
    case "musicService":
      if (action.value !== state.musicService)
        runtime.switchService(action.value);
      break;
    case "startPage":
      if (action.serviceId === "music") config.setStartPage(action.value);
      else config.setClassicalStartPage(action.value);
      break;
    case "zoomFactor":
      config.setZoomFactor(action.value);
      runtime.applyZoom(action.value);
      break;
    case "closeToTray": {
      config.setCloseToTrayEnabled(action.value);
      const window = runtime.getMainWindow();
      if (!action.value && window && !window.isVisible()) {
        window.show();
        window.focus();
      }
      break;
    }
    case "notifications":
      config.setNotificationsEnabled(action.value);
      break;
  }
  runtime.refreshTray();
  notifySettingsChanged();
  return getSettingsState();
}
