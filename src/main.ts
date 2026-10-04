import {
  app,
  BrowserWindow,
  components,
  dialog,
  ipcMain,
  Menu,
  session,
  Tray,
  webFrameMain,
} from "electron";
import { DESKTOP_ID } from "./identity";
import { TITLEBAR_CSS } from "./elementaryCss";
import { windowChromeOptions } from "./windowChrome";
import { createHeaderbar, type Headerbar } from "./headerbar";
import { devProbeHidden, scheduleDevProbe } from "./devProbe";
import fs from "fs";
import path from "path";
import log from "electron-log/main";
import { AUTH_FIX_TOKEN, PASSKEY_CONTAINER_SELECTORS } from "./authFrame";
import {
  getZoomFactor,
  getCloseToTrayEnabled,
  getMusicService,
} from "./config";
import {
  getLoadingText,
  getNavigationStrings,
  NAV_LABELS_TOKEN,
} from "./i18n";
import { getAssetPath } from "./paths";
import { Player, IntegrationContext } from "./player";
import {
  buildAppleMusicURL,
  buildItmsRouteURL,
  handleStorefrontNavigation,
  handleLastPageNavigation,
} from "./storefront";
import { extractItmsUrlFromArgv, type ItmsTarget } from "./itms";
import {
  initServiceSwitch,
  routeToMusicService,
  switchService,
} from "./serviceSwitch";
import { initThemeCSS, injectThemeCss } from "./theme";
import {
  createTray,
  initTrayStateManager,
  rebuildTrayMenu,
  setGetMainWindowCallback,
} from "./tray";
import { initSettingsActions, notifySettingsChanged } from "./settings";
import {
  handleSettingsNavigation,
  initSettingsWindow,
  showSettingsWindow,
} from "./settingsWindow";
import { initCommandBridge } from "./commandBridge";
import { initControllerIPC, goBackIfPossible } from "./controllerIPC";
import { CONTROLLER_RESET_CHANNEL } from "./controller";
import {
  getService,
  allServices,
  isAllowedNavigationUrl,
} from "./musicService";
import { init as initNotifications } from "./integrations/notifications";
import { init as initLastfm } from "./integrations/lastfm";
import { cleanArtworkCache } from "./artwork";
import {
  init as initWedgeDetector,
  reset as resetWedgeDetector,
} from "./wedgeDetector";
import { contentReadyProbeScript } from "./contentReady";
import {
  initNotificationProbe,
  muteElementaryNotificationSound,
} from "./notify";
import { errorMessage, liveWebContents, runSteps } from "./utils";
import { openExternalUrl } from "./utils/openExternal";

const SPLASH_MIN_DISPLAY_MS = 500;
const CONTENT_READY_POLL_MS = 100;
const CONTENT_READY_TIMEOUT_MS = 3500;
const CSS_READY_TIMEOUT_MS = 10000;
const SPLASH_WIDTH_PX = 300;
const SPLASH_HEIGHT_PX = 350;
const MAIN_WINDOW_WIDTH_PX = 1280;
const MAIN_WINDOW_HEIGHT_PX = 800;
const PRELOAD_ERROR_NAMES = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

// --- Logging: initialise before anything else ---
log.initialize();
log.transports.file.level = "info";
log.transports.console.level = app.isPackaged ? false : "debug";
log.transports.file.format =
  "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}";
log.transports.console.format = "{h}:{i}:{s}.{ms} [{level}]{scope} {text}";

// Override log levels via environment variable (used by `just run-debug`).
type LogLevel = "error" | "warn" | "info" | "debug" | "silly";
const VALID_LEVELS = new Set<LogLevel>([
  "error",
  "warn",
  "info",
  "debug",
  "silly",
]);
const envLevel = process.env.ELECTRON_LOG_LEVEL;
if (envLevel && VALID_LEVELS.has(envLevel as LogLevel)) {
  const level = envLevel as LogLevel;
  log.transports.file.level = level;
  log.transports.console.level = level;
}

const mainLog = log.scope("main");
const splashLog = log.scope("splash");
mainLog.info(`${app.name} ${app.getVersion()}`);

app.on("child-process-gone", (_event, details) => {
  const serviceName =
    details.serviceName === undefined
      ? ""
      : ` serviceName=${JSON.stringify(details.serviceName)}`;
  mainLog.warn(
    `event=child-process-gone processType=${details.type} reason=${details.reason} exitCode=${details.exitCode}${serviceName}`,
  );
});

// --- Platform switches: must run before app.whenReady() ---
if (process.platform === "linux") {
  app.commandLine.appendSwitch(
    "enable-features",
    "UseOzonePlatform,WaylandWindowDecorations",
  );
  // MediaSessionService off: Sidra registers its own MPRIS service, and
  // Chromium's would be a second, conflicting registration on the same bus.
  // AudioServiceOutOfProcess off: it moves audio back in-process, which is
  // where SetGlobalAppName can reach PulseAudio at all.
  app.commandLine.appendSwitch(
    "disable-features",
    "MediaSessionService,WaylandWpColorManagerV1,AudioServiceOutOfProcess",
  );
  // Set the XDG desktop name so GetXdgAppId() returns Cassette's id and
  // GetPossiblyOverriddenApplicationName() can read Name= from its .desktop file.
  // Pairs with the AudioServiceOutOfProcess switch above: without both, the
  // PulseAudio stream is labelled "Chromium" and no PULSE_PROP_* override helps.
  app.setDesktopName(`${DESKTOP_ID}.desktop`);
  mainLog.info("Linux platform switches applied");
}

// Use a platform-accurate Chrome UA, stripping Electron identifiers that
// Apple Music detects and blocks. The platform component must be truthful
// to match Sec-CH-UA-Platform Client Hints sent on every request.
// Read the Chrome major from process.versions.chrome so CastLabs ECS updates
// also update the UA. Chrome's reduced UA fixes the other components at 0.
function chromeUA(): string {
  const version = `${process.versions.chrome.split(".")[0]}.0.0.0`;
  const webkit = "AppleWebKit/537.36 (KHTML, like Gecko)";
  const safari = "Safari/537.36";
  return `Mozilla/5.0 (X11; Linux x86_64) ${webkit} Chrome/${version} ${safari}`;
}

// Set fallback UA before app.whenReady() so any early requests use it
const UA = chromeUA();
app.userAgentFallback = UA;

// Prevent garbage collection of tray icon
let appTray: Tray | null = null;

let isQuitting = false;
app.on("before-quit", () => {
  isQuitting = true;
});

let win: BrowserWindow | null = null;
let headerbar: Headerbar | null = null;
let rendererDocumentGeneration = 0;

// Single-instance lock: forward subsequent launches to the running instance so
// itms:// URLs from a second invocation are routed instead of opening a new
// window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Capture any itms:// argument from initial launch argv.
let pendingItmsTarget: ItmsTarget | null = extractItmsUrlFromArgv(
  process.argv,
);

function focusMainWindow(): void {
  if (!win) return;
  const wasHidden = !win.isVisible();
  if (wasHidden) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
  if (wasHidden && appTray) rebuildTrayMenu(appTray);
}

function routeItmsTarget(target: ItmsTarget | null): void {
  if (!target) return;
  if (!win) {
    pendingItmsTarget = target;
    return;
  }
  // Resolved before the switch; buildItmsRouteURL pins the music origin itself.
  const url =
    target.kind === "url" ? target.url : buildItmsRouteURL(target.token);
  routeToMusicService(url);
  mainLog.info(`itms target routed: kind=${target.kind}`);
}

/** Local styles and scripts prepared for injection into service pages and authentication frames. */
export interface Assets {
  STYLE_FIX_CSS: string;
  authFrameScript: string;
  navBarScript: string;
  hookScript: string;
}

function createSplash(): {
  splash: BrowserWindow | null;
  minDisplay: Promise<void>;
  cssReady: Promise<void>;
  markCssReady: () => void;
} {
  // Linux has no splash: the window opens at once behind the header bar's
  // start-up cover (src/headerbar.ts), as an elementary app does.
  const splash = process.platform === "linux" ? null : createSplashWindow();
  let resolveMinDisplay!: () => void;
  const minDisplay = new Promise<void>((resolve) => {
    resolveMinDisplay = resolve;
  });
  setTimeout(resolveMinDisplay, splash ? SPLASH_MIN_DISPLAY_MS : 0);
  let resolveCssReady!: () => void;
  // The timeout guarantees that setupSplashTransition() can finish if an event
  // handler fails before it calls markCssReady(). An unsettled cssReady would
  // otherwise keep the splash open and the main window hidden.
  const cssReady = Promise.race([
    new Promise<void>((resolve) => {
      resolveCssReady = resolve;
    }),
    new Promise<void>((resolve) => setTimeout(resolve, CSS_READY_TIMEOUT_MS)),
  ]);
  splashLog.info(splash ? "splash created" : "no splash on this platform");
  return {
    splash,
    minDisplay,
    cssReady,
    markCssReady: () => resolveCssReady(),
  };
}

function createSplashWindow(): BrowserWindow {
  const splashZoom = getZoomFactor();
  const splash = new BrowserWindow({
    width: Math.round(SPLASH_WIDTH_PX * splashZoom),
    height: Math.round(SPLASH_HEIGHT_PX * splashZoom),
    frame: false,
    resizable: false,
    fullscreenable: false,
    fullscreen: false,
    center: true,
    skipTaskbar: true,
    backgroundColor: "#1a0a10",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const { text: loadingText, lang: loadingLang } = getLoadingText();
  splash.loadFile(getAssetPath("assets", "splash.html"), {
    query: { text: loadingText, lang: loadingLang },
  });
  splash.show();
  splashLog.info("splash shown");
  splash.webContents.on("did-finish-load", () => {
    splash.webContents.setZoomFactor(getZoomFactor());
  });
  return splash;
}

function setupApplicationMenu(): void {
  if (process.env.CASSETTE_DEVTOOLS === "1") {
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
      {
        role: "viewMenu",
        submenu: [{ role: "toggleDevTools" }],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  } else {
    Menu.setApplicationMenu(null);
  }
  mainLog.info("application menu set");
}

// The renderer→main channels split by owner: the nav: prefix is the navigation
// bar's namespace, and every other channel is a MusicKit event for the Player.
// Each table below is a total record over its half, so a channel renamed in
// src/types/hook.d.ts and a channel added there with no listener both fail tsc
// here rather than compiling on and never firing.
type NavSendChannel = Extract<SendChannel, `nav:${string}`>;
type PlayerSendChannel = Exclude<SendChannel, NavSendChannel>;
type SendListener = Parameters<typeof ipcMain.on>[1];

// Object.keys() preserves insertion order, so listeners register in the order
// the table lists them.
function onSendChannels<C extends SendChannel>(
  listeners: Record<C, SendListener>,
  accepts?: (
    event: Electron.IpcMainEvent,
    data: unknown,
    generation: unknown,
  ) => boolean,
): void {
  for (const channel of Object.keys(listeners) as C[]) {
    ipcMain.on(
      channel,
      accepts
        ? (event, data, generation) => {
            if (accepts(event, data, generation))
              listeners[channel](event, data);
          }
        : listeners[channel],
    );
  }
}

function initPlayerIPC(): Player {
  const player = new Player();
  onSendChannels<PlayerSendChannel>(
    {
      hookReady: (event, generation) => {
        if (
          generation !== rendererDocumentGeneration ||
          event.sender !== win?.webContents ||
          event.senderFrame !== win.webContents.mainFrame
        )
          return;
        player.handleHookReady(event.senderFrame.url);
      },
      playbackCapabilitiesDidChange: (_event, data) =>
        player.handlePlaybackCapabilitiesDidChange(data),
      playbackStopped: (_event, data) => player.handlePlaybackStopped(data),
      playbackStateDidChange: (_event, data) =>
        player.handlePlaybackStateDidChange(data),
      nowPlayingItemDidChange: (_event, data) =>
        player.handleNowPlayingItemDidChange(data),
      timedMetadataDidChange: (_event, data) =>
        player.handleTimedMetadataDidChange(data),
      playbackTimeDidChange: (_event, data) =>
        player.handlePlaybackTimeDidChange(data),
      repeatModeDidChange: (_event, data) =>
        player.handleRepeatModeDidChange(data),
      shuffleModeDidChange: (_event, data) =>
        player.handleShuffleModeDidChange(data),
      volumeDidChange: (_event, data) => player.handleVolumeDidChange(data),
    },
    (event, _data, generation) =>
      generation === rendererDocumentGeneration &&
      event.sender === win?.webContents &&
      event.senderFrame === win.webContents.mainFrame,
  );
  return player;
}

async function initSession(): Promise<Electron.Session> {
  // Clear stale service worker and cache data while Widevine initialises.
  // Both operations are independent, and navigation has not started.
  const ses = session.fromPartition("persist:sidra");
  await Promise.all([
    components.whenReady(),
    ses.clearData({
      dataTypes: ["serviceWorkers", "cache"],
      origins: allServices().map((svc) => svc.origin),
    }),
  ]);
  interface CdmComponentStatus {
    status: string;
    title: string;
    version: string;
  }

  const cdmStatus = Object.values(components.status())[0] as
    CdmComponentStatus | undefined;
  if (cdmStatus) {
    mainLog.info(
      `Widevine CDM ready: ${cdmStatus.title} v${cdmStatus.version} (${cdmStatus.status})`,
    );
  } else {
    mainLog.warn("Widevine CDM ready: status unavailable");
  }

  // Set UA on the default session (updates navigator.userAgentData Client Hints)
  session.defaultSession.setUserAgent(UA);

  return ses;
}

function loadAssets(): Assets {
  const styleFixCssPath = getAssetPath("assets", "styleFix.css");
  const STYLE_FIX_CSS = fs.readFileSync(styleFixCssPath, "utf-8");
  const authStyleFixCssPath = getAssetPath("assets", "authStyleFix.css");
  const authCss = fs.readFileSync(authStyleFixCssPath, "utf-8");
  const authFramePath = getAssetPath("assets", "authFrameFix.js");
  const authFrameScript = fs
    .readFileSync(authFramePath, "utf-8")
    .replace(AUTH_FIX_TOKEN, () =>
      JSON.stringify({
        css: authCss,
        containerSelectors: PASSKEY_CONTAINER_SELECTORS,
        logPrefix: AUTH_FRAME_LOG_PREFIX,
      }),
    );
  const navBarPath = getAssetPath("assets", "navigationBar.js");
  const navBarScript = fs
    .readFileSync(navBarPath, "utf-8")
    .replace(NAV_LABELS_TOKEN, () => JSON.stringify(getNavigationStrings()));
  const hookPath = getAssetPath("assets", "musicKitHook.js");
  const hookScript = fs
    .readFileSync(hookPath, "utf-8")
    .replace("__SIDRA_SERVICE_HOSTS__", () =>
      JSON.stringify(allServices().map((service) => service.host)),
    );
  return { STYLE_FIX_CSS, authFrameScript, navBarScript, hookScript };
}

function createMainWindow(ses: Electron.Session): {
  win: BrowserWindow;
  winReady: Promise<void>;
} {
  const win = new BrowserWindow({
    title: app.getName(),
    width: MAIN_WINDOW_WIDTH_PX,
    height: MAIN_WINDOW_HEIGHT_PX,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    ...windowChromeOptions(),
    webPreferences: {
      partition: "persist:sidra",
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      plugins: true,
      sandbox: true,
    },
  });

  // did-finish-load fires while Apple Music is still an empty shell, so the
  // window is held back until the service's contentReadySelector appears in the
  // page. The poll starts at the first in-page navigation, which is where the
  // SPA takes over rendering, and a timeout shows the window regardless so a
  // selector Apple has renamed delays the launch instead of blocking it.
  let pollCancelled = false;
  const winReady = Promise.race([
    new Promise<void>((resolve) => {
      win.webContents.once("did-navigate-in-page", () => {
        const poll = () => {
          if (pollCancelled) return;
          // Guard the native webContents getter before creating the promise.
          // The startup timer can run after the window is destroyed.
          const contents = liveWebContents(win);
          if (!contents) return;
          const selector = getService(getMusicService()).contentReadySelector;
          contents
            .executeJavaScript(contentReadyProbeScript(selector))
            .then((ready) => {
              if (ready) resolve();
              else if (!pollCancelled) setTimeout(poll, CONTENT_READY_POLL_MS);
            })
            .catch(() => {
              if (!pollCancelled) setTimeout(poll, CONTENT_READY_POLL_MS);
            });
        };
        poll();
      });
    }),
    new Promise<void>((resolve) =>
      setTimeout(resolve, CONTENT_READY_TIMEOUT_MS),
    ),
  ]);
  winReady.then(() => {
    pollCancelled = true;
  });

  return { win, winReady };
}

function setupSplashTransition(
  win: BrowserWindow,
  splash: BrowserWindow | null,
  minDisplay: Promise<void>,
  cssReady: Promise<void>,
  winReady: Promise<void>,
): void {
  // Without a splash the window is already showing its header bar and cover,
  // which the header bar fades out once the page is ready.
  if (!splash && !devProbeHidden()) win.show();
  Promise.all([minDisplay, cssReady, winReady]).then(() => {
    if (!splash) {
      headerbar?.reveal();
      return;
    }
    if (devProbeHidden()) return;
    win.show();
    splashLog.info("splash closed");
    splash.close();
  });
}

function setupSessionHeaders(ses: Electron.Session): void {
  // Set UA on the persist:sidra session used by the window
  ses.setUserAgent(UA);

  // Strip Electron and app name tokens from outgoing request headers
  const urlFilters = allServices().map((svc) => `${svc.origin}/*`);
  ses.webRequest.onBeforeSendHeaders(
    { urls: urlFilters },
    (details, callback) => {
      const ua = details.requestHeaders["User-Agent"];
      if (ua && ua !== UA) {
        details.requestHeaders["User-Agent"] = UA;
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

function setupWindowZoomAndNav(win: BrowserWindow): void {
  win.webContents.setZoomFactor(getZoomFactor());
  const onSettings: SendListener = (event) =>
    handleSettingsNavigation(event, win);
  win.once("closed", () => ipcMain.removeListener("nav:settings", onSettings));

  onSendChannels<NavSendChannel>({
    "nav:settings": onSettings,
    "nav:back": () => goBackIfPossible(win),
    "nav:forward": () => win.webContents.navigationHistory.goForward(),
    "nav:reload": () => {
      resetWedgeDetector();
      win.webContents.reload();
    },
  });
}

// Contain injection failures in both full-load and in-page navigation handlers.
// The URL read can throw after WebContents destruction, so it stays inside the catch.
// Separate catches let navigation controls load even when the MusicKit hook fails.
async function injectRendererScripts(
  win: BrowserWindow,
  assets: Assets,
  context: string,
): Promise<void> {
  try {
    const currentUrl = win.webContents.getURL();
    if (isAllowedNavigationUrl(currentUrl)) {
      await win.webContents.executeJavaScript(
        assets.hookScript.replace("__SIDRA_DOCUMENT_GENERATION__", () =>
          String(rendererDocumentGeneration),
        ),
      );
      mainLog.debug("MusicKit hook injected");
    } else {
      mainLog.warn(
        "skipped hookScript injection on disallowed host:",
        currentUrl,
      );
    }
  } catch (e: unknown) {
    mainLog.warn(`failed to inject hookScript ${context}:`, e);
  }
  // On Linux the header bar carries back, forward and settings.
  if (process.platform === "linux") return;
  try {
    await win.webContents.executeJavaScript(assets.navBarScript);
    mainLog.debug("Navigation bar injected");
  } catch (e: unknown) {
    mainLog.warn(`failed to inject navBarScript ${context}:`, e);
  }
}

function setupNavigationHandlers(win: BrowserWindow, player: Player): void {
  // Keep page-initiated main-frame navigation on registered service and authentication hosts.
  // Main-process loadURL() calls bypass this event and need their own validated targets.
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
      mainLog.warn("blocked navigation to disallowed host:", url);
    }
  });
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame) {
      win.webContents.send(CONTROLLER_RESET_CHANNEL);
      mainLog.debug("did-start-navigation:", details.url);
    }
  });
  win.webContents.on("did-navigate", (_event, url) => {
    rendererDocumentGeneration += 1;
    player.resetForDocumentReplacement();
    mainLog.debug("did-navigate:", url);
    handleStorefrontNavigation(url);
  });
}

const AUTH_FRAME_HOSTS = new Set<string>(
  allServices().flatMap((svc) => [...svc.authFrameHosts]),
);
const AUTH_FRAME_LOG_PREFIX = "[sidra] auth-frame hide:";

// assets/authFrameFix.js hides the passkey and "Sign in with iPhone" routes in
// Apple's sign-in iframe, and reports what it hid back over console-message,
// which is the only channel out of a frame the main process has not preloaded.
function setupAuthFrameInjection(win: BrowserWindow, script: string): void {
  const authLog = log.scope("auth-frame");

  win.webContents.on(
    "did-frame-finish-load",
    (_event, isMainFrame, frameProcessId, frameRoutingId) => {
      if (isMainFrame) return;
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      if (!frame) {
        authLog.warn(
          `webFrameMain.fromId returned null for processId=${frameProcessId} routingId=${frameRoutingId}`,
        );
        return;
      }
      let host: string;
      try {
        host = new URL(frame.url).hostname;
      } catch {
        return;
      }
      if (!AUTH_FRAME_HOSTS.has(host)) return;
      authLog.info(`auth iframe detected: ${frame.url}`);
      frame.executeJavaScript(script).catch((err) => {
        authLog.warn("auth iframe injection failed:", errorMessage(err));
      });
    },
  );

  win.webContents.on("console-message", (event) => {
    if (!event.message.startsWith(AUTH_FRAME_LOG_PREFIX)) return;
    const frameHost = (() => {
      try {
        return new URL(event.frame.url).hostname;
      } catch {
        return "";
      }
    })();
    if (!AUTH_FRAME_HOSTS.has(frameHost)) return;
    authLog.info(event.message.slice(AUTH_FRAME_LOG_PREFIX.length).trim());
  });
}

function setupWindowEvents(win: BrowserWindow, markCssReady: () => void): void {
  win.webContents.on("unresponsive", () => {
    mainLog.warn("event=unresponsive processType=renderer");
  });
  win.webContents.on("responsive", () => {
    mainLog.info("event=responsive processType=renderer");
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    mainLog.error(
      `event=render-process-gone processType=renderer reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    const errorName = PRELOAD_ERROR_NAMES.has(error.name)
      ? error.name
      : "UnknownError";
    mainLog.warn(
      `event=preload-error processType=renderer preloadPath=${path.basename(preloadPath)} errorName=${errorName}`,
    );
  });

  win.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  // A failed load cannot apply CSS, so release the splash without waiting for the fallback timeout.
  let cssMarked = false;
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    if (!cssMarked) {
      markCssReady();
      cssMarked = true;
    }
    mainLog.error("page load failed:", errorCode, errorDescription);
  });

  // Apple Music registers a beforeunload handler while audio plays. Electron
  // shows no confirmation dialog, so the handler silently blocks close() and
  // app.quit() with no error. Overriding it here lets Sidra exit.
  win.webContents.on("will-prevent-unload", (event) => {
    event.preventDefault();
  });

  win.on("close", (event) => {
    if (!isQuitting && getCloseToTrayEnabled()) {
      event.preventDefault();
      win.hide();
      mainLog.info("close intercepted: hiding window to tray");
      if (appTray) rebuildTrayMenu(appTray);
    }
  });

  // Keep external navigation out of the renderer and accept only HTTP or HTTPS URLs.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url, mainLog);
    return { action: "deny" };
  });
}

function setupContentHandlers(
  win: BrowserWindow,
  player: Player,
  markCssReady: () => void,
  assets: Assets,
): void {
  async function injectContent(): Promise<void> {
    mainLog.info("page loaded:", win.webContents.getURL());
    win.webContents.setZoomFactor(getZoomFactor());
    await win.webContents.insertCSS(assets.STYLE_FIX_CSS);
    if (process.platform === "linux")
      await win.webContents.insertCSS(TITLEBAR_CSS);
    mainLog.debug("CSS fixes injected");
    await injectThemeCss(win.webContents);
    await injectRendererScripts(win, assets, "on load");
  }

  let initialized = false;
  let integrationsReady = false;
  win.webContents.on("did-navigate-in-page", async (_event, url) => {
    handleStorefrontNavigation(url);
    handleLastPageNavigation(url);
    if (integrationsReady)
      await injectRendererScripts(win, assets, "on SPA navigation");
  });
  win.webContents.on("did-finish-load", async () => {
    // Claim initialisation before injectContent() yields. Two did-finish-load
    // events in one injection round trip must not register every integration twice.
    const firstLoad = !initialized;
    initialized = true;

    if (firstLoad) {
      // Isolate initialisers so one failure cannot skip the others or delay
      // markCssReady() until the splash timeout.
      runSteps(
        [
          [
            "notifications",
            () => initNotifications({ player, getMainWindow: () => win }),
          ],
          ["lastfm", () => initLastfm({ player, getMainWindow: () => win })],
          [
            "mpris",
            () => {
              if (process.platform !== "linux") return;
              const mpris = require("./integrations/mpris") as {
                init(ctx: IntegrationContext): void;
              };
              mpris.init({ player, getMainWindow: () => win });
            },
          ],
          [
            "wedgeDetector",
            () => initWedgeDetector({ player, getMainWindow: () => win }),
          ],
          [
            "trayState",
            () => {
              if (!appTray) return;
              // Register teardown so the tray timers and player listeners end on quit.
              const teardownTrayState = initTrayStateManager(player, appTray);
              app.on("will-quit", teardownTrayState);
            },
          ],
        ],
        (name, e) =>
          mainLog.error(`integration initialisation failed: ${name}:`, e),
      );
      integrationsReady = true;
    }

    // Register integrations before the hook sends its initial playback state.
    // Injection failure must still reach markCssReady() to dismiss the splash.
    try {
      await injectContent();
    } catch (e: unknown) {
      mainLog.warn("failed to inject content on load:", e);
    }

    if (firstLoad) markCssReady();
  });
}

if (gotLock) {
  app.on("second-instance", (_event, argv) => {
    const target = extractItmsUrlFromArgv(argv);
    routeItmsTarget(target);
    focusMainWindow();
  });

  app
    .whenReady()
    .then(async () => {
      mainLog.info("app ready, waiting for Widevine CDM...");
      const { splash, minDisplay, cssReady, markCssReady } = createSplash();
      setupApplicationMenu();
      const player = initPlayerIPC();
      initNotificationProbe();
      muteElementaryNotificationSound();
      const ses = await initSession();
      cleanArtworkCache();

      const ok = app.setAsDefaultProtocolClient("itms");
      mainLog.info(`itms protocol registration: ${ok ? "ok" : "failed"}`);

      const assets = loadAssets();
      const created = createMainWindow(ses);
      win = created.win;
      const winReady = created.winReady;
      initCommandBridge((channel, ...args) => {
        const contents = liveWebContents(win);
        if (!contents) {
          mainLog.warn(
            `source=command channel=${channel} reason=renderer-gone result=dropped`,
          );
          return;
        }
        contents.send(channel, ...args);
      });
      initControllerIPC(win);
      setGetMainWindowCallback(() => win);
      initServiceSwitch({
        getTray: () => appTray,
        loadURL: (url) => {
          win
            ?.loadURL(url, { userAgent: UA })
            .catch((err) =>
              mainLog.warn(
                "service navigation loadURL failed:",
                errorMessage(err),
              ),
            );
          notifySettingsChanged();
        },
      });
      const teardownSettingsActions = initSettingsActions({
        getMainWindow: () => win,
        applyZoom: (factor) => liveWebContents(win)?.setZoomFactor(factor),
        switchService,
        refreshTray: () => {
          if (appTray) rebuildTrayMenu(appTray);
        },
      });
      app.on("will-quit", teardownSettingsActions);
      initSettingsWindow(win);
      setupWindowZoomAndNav(win);
      initThemeCSS(win);
      if (process.platform === "linux") {
        const mainWin = win;
        headerbar = createHeaderbar(mainWin, {
          back: () => goBackIfPossible(mainWin),
          forward: () => mainWin.webContents.navigationHistory.goForward(),
          // headerbar.ts has already checked the sender is the header view.
          settings: () => showSettingsWindow(),
          player,
        });
      }
      scheduleDevProbe(win, winReady);
      setupSplashTransition(win, splash, minDisplay, cssReady, winReady);
      setupSessionHeaders(ses);
      setupContentHandlers(win, player, markCssReady, assets);
      setupWindowEvents(win, markCssReady);
      setupNavigationHandlers(win, player);
      setupAuthFrameInjection(win, assets.authFrameScript);
      appTray = createTray();
      if (process.env.CASSETTE_DEVTOOLS === "1") {
        win.webContents.openDevTools();
        mainLog.info("DevTools opened (CASSETTE_DEVTOOLS=1)");
      }
      mainLog.info("loading Apple Music...");
      win
        .loadURL(buildAppleMusicURL(), { userAgent: UA })
        .catch((err) =>
          mainLog.warn("initial navigation loadURL failed:", errorMessage(err)),
        );

      // Drain any itms target captured at launch. Routed after the initial home
      // load so the content-ready probe binds to its first did-navigate-in-page.
      winReady.then(() => {
        if (pendingItmsTarget) {
          routeItmsTarget(pendingItmsTarget);
          pendingItmsTarget = null;
        }
      });
    })
    .catch((err: unknown) => {
      // The splash is already on screen and setupSplashTransition() was never
      // reached, so without this catch a startup failure leaves the splash up
      // for the life of the process with no message.
      mainLog.error("startup failed:", err);
      const detail = errorMessage(err);
      dialog.showErrorBox(
        `${app.getName()} failed to start`,
        `${app.getName()} could not finish starting.\n\n${detail}\n\nSee the log for details, then start it again.`,
      );
      app.quit();
    });
}

app.on("window-all-closed", () => {
  mainLog.info("all windows closed, quitting");
  app.quit();
});
