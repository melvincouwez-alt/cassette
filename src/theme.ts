import { BrowserWindow, nativeTheme, type WebContents } from "electron";
import log from "electron-log/main";
import { ELEMENTARY_THEME } from "./palettes";
import { buildThemeCss } from "./themeTemplate";
import { liveWebContents } from "./utils";
import { ELEMENTARY_CSS } from "./elementaryCss";

const themeLog = log.scope("theme");

// The insertCSS key of the sheet currently on the page, which is what a later
// removeInsertedCSS needs. Null means no sheet is tracked.
let themeCssKey: string | null = null;

// Every mutation of themeCssKey runs on this one chain, so a theme change and a
// post-load injection cannot interleave and strand a stylesheet on the page.
let themeCssOp: Promise<void> = Promise.resolve();

// WebContents survives document replacement, so queued insertCSS work can reach
// a different page. Reject stale generations to avoid untracked duplicate stylesheets.
let documentGeneration = 0;

// Every await inside queued work is another point where navigation can commit.
// The entry check in enqueueThemeCssOp() covers only the wait for the queue.
// Work must re-check its generation after later waits, before it changes the
// document or records a key that the document no longer holds.
function documentReplaced(generation: number): boolean {
  if (generation === documentGeneration) return false;
  themeCssKey = null;
  themeLog.debug("Theme CSS operation abandoned: document replaced");
  return true;
}

function enqueueThemeCssOp(
  work: (generation: number) => Promise<void>,
): Promise<void> {
  const generation = documentGeneration;
  themeCssOp = themeCssOp
    .then(() => {
      if (generation !== documentGeneration) {
        // Any sheet the old document held died with it, so the tracked key is
        // stale too; removeInsertedCSS would reject on it.
        themeCssKey = null;
        themeLog.debug("Theme CSS operation skipped: document replaced");
        return;
      }
      return work(generation);
    })
    // Catch after then() so a failed operation cannot reject the shared chain
    // or block later operations. Drop the uncertain key to avoid another failed removal.
    .catch((error: unknown) => {
      themeCssKey = null;
      themeLog.warn("Theme CSS operation failed", error);
    });
  return themeCssOp;
}

// Insert a stylesheet and record its key, the only place either happens. The
// generation is re-checked after the insert: a key recorded once the document
// has gone would be removed against the new one, which rejects and takes the
// theme change behind it down with it.
async function insertAndTrack(
  contents: WebContents,
  css: string,
  generation: number,
  appliedMessage: string,
): Promise<void> {
  const key = await contents.insertCSS(css);
  if (documentReplaced(generation)) return;
  themeCssKey = key;
  themeLog.debug(appliedMessage);
}

// Re-inject the theme CSS on the main window after a colour-scheme change.
// Before initialisation there is no document to update, and injectThemeCss()
// runs on every page load, so an early change needs no queued replay.
let applyThemeCSSInternal: () => Promise<void> = () => {
  themeLog.warn("Theme CSS not applied, theme system not initialised yet");
  return Promise.resolve();
};

let elementaryCssCache: string | null = null;

/**
 * Cassette's stylesheet: the elementary palette, whose accent is Cassette's
 * raspberry, plus the rules that make Apple's page read as an elementary app
 * (font, sidebar, buttons). Rendered once and cached.
 */
export function getThemeCss(): string {
  elementaryCssCache ??= `${buildThemeCss(ELEMENTARY_THEME)}\n${ELEMENTARY_CSS}`;
  return elementaryCssCache;
}

/**
 * Inject the resolved theme CSS after a page load. main.ts calls this on every
 * load. The load replaced the document, so nothing is removed here: any key held
 * belongs to the old document and removeInsertedCSS would reject on it.
 */
export function injectThemeCss(contents: WebContents): Promise<void> {
  return enqueueThemeCssOp(async (generation) => {
    await insertAndTrack(
      contents,
      getThemeCss(),
      generation,
      "Theme CSS injected",
    );
  });
}

/**
 * Initialise document tracking and colour-scheme updates for one window. Call
 * once.
 */
export function initThemeCSS(win: BrowserWindow): void {
  // Commit of a main-frame navigation; did-navigate-in-page keeps the document,
  // so it is not one and must not advance the counter.
  win.webContents.on("did-navigate", () => {
    documentGeneration += 1;
  });

  applyThemeCSSInternal = () =>
    enqueueThemeCssOp(async (generation) => {
      // nativeTheme 'updated' and a tray click can both arrive after destruction.
      // liveWebContents() avoids reading the native getter from a destroyed window.
      const contents = liveWebContents(win);
      if (!contents) {
        themeCssKey = null;
        return;
      }
      const previousKey = themeCssKey;
      if (previousKey !== null) {
        await contents.removeInsertedCSS(previousKey);
        themeCssKey = null;
        // Navigation can commit during removal, so verify the document before inserting.
        if (documentReplaced(generation)) return;
      }
      const verb = previousKey !== null ? "re-injected" : "injected";
      await insertAndTrack(
        contents,
        getThemeCss(),
        generation,
        `Theme CSS ${verb}`,
      );
    });

  nativeTheme.on("updated", () => {
    void applyThemeCSSInternal();
  });
}

/**
 * Clear the tracked key before service navigation can remove a stylesheet from
 * the wrong document. Queueing orders the clear after in-flight insertion and
 * before the next load. Stale-generation handling preserves the clear.
 */
export function notifyDocumentReplacing(): void {
  void enqueueThemeCssOp(() => {
    themeCssKey = null;
    return Promise.resolve();
  });
}

