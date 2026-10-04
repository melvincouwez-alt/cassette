import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { getTrayStrings, getAboutStrings, getLoadingText } from './i18n';
import { getAssetPath, getProductInfo } from './paths';
import { getZoomFactor } from './config';
import { openExternalUrl } from './utils/openExternal';

const ABOUT_WINDOW_WIDTH_PX = 400;
const ABOUT_WINDOW_HEIGHT_PX = 470;
const ABOUT_LINKS = /^https:\/\/(github\.com\/(melvincouwez-alt\/cassette|wimpysworld\/sidra)|blueoakcouncil\.org\/license\/1\.0\.0)$/;

const aboutLog = log.scope('about');

let aboutWindow: BrowserWindow | null = null;

/** Show the About window, or focus the one already open. */
export function showAboutWindow(): void {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  aboutLog.info('showing About window');
  // Scale the fixed window with its contents to prevent clipping at higher zoom.
  const zoomFactor = getZoomFactor();
  aboutWindow = new BrowserWindow({
    width: Math.round(ABOUT_WINDOW_WIDTH_PX * zoomFactor),
    height: Math.round(ABOUT_WINDOW_HEIGHT_PX * zoomFactor),
    frame: false,
    resizable: false,
    fullscreenable: false,
    fullscreen: false,
    center: true,
    skipTaskbar: true,
    backgroundColor: '#1a0a10',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Wait for the page to render so the window does not flash empty.
  aboutWindow.once('ready-to-show', () => {
    aboutWindow?.webContents.setZoomFactor(getZoomFactor());
    aboutWindow?.show();
  });

  // The three links open in the browser; nothing else leaves the window.
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (ABOUT_LINKS.test(url)) openExternalUrl(url, aboutLog);
    return { action: 'deny' };
  });
  aboutWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });

  const info = getProductInfo();
  const trayStrings = getTrayStrings();
  const aboutStrings = getAboutStrings();

  // With no preload, the sandboxed page receives text and product details through query parameters.
  aboutWindow.loadFile(getAssetPath('assets', 'about.html'), {
    query: {
      name: info.productName,
      version: app.getVersion(),
      description: aboutStrings.description,
      lang: getLoadingText().lang,
      author: info.author,
      license: info.license,
      about: trayStrings.about,
      close: aboutStrings.close,
      versionPrefix: aboutStrings.versionPrefix,
      copyrightSuffix: aboutStrings.copyrightSuffix,
      licensePrefix: aboutStrings.licensePrefix,
      year: String(new Date().getFullYear()),
    },
  });
}
