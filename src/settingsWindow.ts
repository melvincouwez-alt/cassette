import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import path from "path";
import { pathToFileURL } from "url";
import log from "electron-log/main";
import { getAssetPath } from "./paths";
import { getLoadingText, getTrayStrings } from "./i18n";
import { isAllowedNavigationUrl } from "./musicService";
import {
  applySettingsAction,
  getSettingsState,
  subscribeSettingsChanges,
} from "./settings";
import { getThemeCss } from "./theme";
import { liveWebContents } from "./utils";
import { windowChromeOptions } from "./windowChrome";

let settingsWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let currentSettingsUrl: string | null = null;
const settingsLog = log.scope("settings");

// Accept only the current local Settings document in its own main frame.
function validateSender(event: IpcMainInvokeEvent): void {
  const contents = liveWebContents(settingsWindow);
  if (
    !contents ||
    event.sender !== contents ||
    event.senderFrame !== contents.mainFrame ||
    event.senderFrame?.url !== currentSettingsUrl ||
    contents.getURL() !== currentSettingsUrl
  ) {
    throw new Error("Invalid settings sender");
  }
}

/** Focus the existing Settings window or create one for the live main window. */
export function showSettingsWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const labels = getTrayStrings();
  const url = pathToFileURL(getAssetPath("assets", "settings.html"));
  url.search = new URLSearchParams({
    lang: getLoadingText().lang,
    settings: labels.settings,
    settingsError: labels.settingsError,
  }).toString();
  const settingsUrl = url.href;
  const window = new BrowserWindow({
    title: labels.settings,
    width: 620,
    height: 760,
    minWidth: 360,
    minHeight: 420,
    show: false,
    frame: true,
    ...windowChromeOptions(),
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "settingsPreload.js"),
    },
  });
  settingsWindow = window;
  currentSettingsUrl = settingsUrl;
  const contents = window.webContents;
  // Cassette's stylesheet never changes while the window is open, so it is
  // inserted once, before the window is shown.
  const applyStyle = (): Promise<void> => {
    if (
      window.isDestroyed() ||
      contents.isDestroyed() ||
      contents.getURL() !== settingsUrl
    )
      return Promise.resolve();
    return contents
      .insertCSS(getThemeCss())
      .then(() => undefined)
      .catch(() => {
        settingsLog.warn("Settings style failed to apply");
      });
  };
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  window.setMenu(null);
  window.once("ready-to-show", () => {
    const show = (): void => {
      clearTimeout(showTimer);
      showTimer = undefined;
      if (!window.isDestroyed()) window.show();
    };
    // Do not keep Settings hidden if CSS injection stalls.
    showTimer = setTimeout(show, 1000);
    void applyStyle().then(() => {
      if (showTimer !== undefined) show();
    });
  });
  window.once("closed", () => {
    clearTimeout(showTimer);
    showTimer = undefined;
    if (settingsWindow === window) {
      settingsWindow = null;
      currentSettingsUrl = null;
    }
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.loadURL(settingsUrl).catch(() => {
    settingsLog.warn("Settings page failed to load");
    if (!window.isDestroyed()) window.close();
  });
}

/** Open Settings only for navigation requests from an allowed main-frame document. */
export function handleSettingsNavigation(
  event: IpcMainEvent,
  window: BrowserWindow,
): void {
  if (
    window.isDestroyed() ||
    window.webContents.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !event.senderFrame ||
    !isAllowedNavigationUrl(event.senderFrame.url)
  )
    return;
  showSettingsWindow();
}

/** Register Settings IPC, updates and the shortcut. Return an idempotent teardown. */
export function initSettingsWindow(window: BrowserWindow): () => void {
  mainWindow = window;
  const contents = window.webContents;
  ipcMain.handle("settings:get", (event) => {
    validateSender(event);
    return getSettingsState();
  });
  ipcMain.handle("settings:apply", (event, action: unknown) => {
    validateSender(event);
    return applySettingsAction(action);
  });
  const unsubscribe = subscribeSettingsChanges((state) => {
    const contents = liveWebContents(settingsWindow);
    if (contents?.getURL() === currentSettingsUrl) {
      contents.send("settings:state", state);
    }
  });
  const onInput = (event: Electron.Event, input: Electron.Input): void => {
    const modifier = input.control && !input.meta;
    if (
      input.type !== "keyDown" ||
      input.key !== "," ||
      !modifier ||
      input.alt ||
      input.shift
    )
      return;
    event.preventDefault();
    if (!input.isAutoRepeat) showSettingsWindow();
  };
  contents.on("before-input-event", onInput);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    contents.removeListener("before-input-event", onInput);
    window.removeListener("closed", dispose);
    app.removeListener("will-quit", dispose);
    ipcMain.removeHandler("settings:get");
    ipcMain.removeHandler("settings:apply");
    unsubscribe();
    mainWindow = null;
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  };
  window.once("closed", dispose);
  app.on("will-quit", dispose);
  return dispose;
}
