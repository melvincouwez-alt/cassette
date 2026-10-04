// Development aid, inert unless CASSETTE_DEV_PROBE names a PNG path: once the page
// has settled, capture it and log a few layout facts, so a style change can be
// checked without screenshotting the whole desktop. The window then never
// shows: pages keep rendering hidden, so a test run stays out of the way.

/** True when a probe run keeps the window off screen. */
export function devProbeHidden(): boolean {
  return Boolean(process.env.CASSETTE_DEV_PROBE) && process.env.CASSETTE_DEV_SHOW !== "1";
}

// Captures pass stayHidden, so taking one never makes the window visible.
const HIDDEN = { stayHidden: true, stayAwake: true };

import fs from "fs";
import { nativeTheme, type BrowserWindow, type WebContents } from "electron";
import log from "electron-log/main";

const probeLog = log.scope("dev-probe");

const PROBE_SCRIPT = `(() => {
  const box = (sel) => { const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  return JSON.stringify({
    navigation: box("#navigation"), header: box(".navigation__header"), logo: box(".navigation__header .logo"),
    main: box("main"), font: getComputedStyle(document.body).fontFamily,
    titlebar: getComputedStyle(document.documentElement).getPropertyValue("--probe") || null,
    viewport: [innerWidth, innerHeight],
    playerButtons: [...document.querySelectorAll(".player-bar button, .player-bar [role=button], .player-bar amp-playback-controls-play, .player-bar *")].filter(e => e.tagName === "BUTTON" || e.getAttribute("role") === "button" || e.tagName.startsWith("AMP-")).slice(0, 40).map(e => e.tagName + "." + [...e.classList].slice(0,2).join(".") + " [" + (e.getAttribute("aria-label") || e.getAttribute("title") || e.dataset.testid || "") + "]"),
    atStrip: (() => { const out = []; let e = document.elementFromPoint(150, 70); for (let i = 0; i < 6 && e; i++, e = e.parentElement) { const cs = getComputedStyle(e); out.push(e.tagName + "." + [...e.classList].slice(0,2).join(".") + " bg=" + cs.backgroundColor + " img=" + cs.backgroundImage.slice(0,60) + " mask=" + (cs.maskImage || cs.webkitMaskImage || "").slice(0,60)); } return out; })(),
    heights: [".body-container", ".app-container > .header", "#navigation", "#scrollable-page", ".player-bar", "[data-testid=sign-in-button]"].map(s => { const e = document.querySelector(s); if (!e) return s + " none"; const r = e.getBoundingClientRect(); return s + " y=" + Math.round(r.y) + " h=" + Math.round(r.height) + " bottom=" + Math.round(r.bottom); }),
    bodyKids: [...document.body.children].map(e => { const cs = getComputedStyle(e); return e.tagName + "." + [...e.classList].slice(0,3).join(".") + (e.id ? "#" + e.id : "") + " " + cs.display + " h=" + e.getBoundingClientRect().height + " css-h=" + cs.height; }),
    appKids: (() => { const a = document.querySelector(".app-container") || document.querySelector("#app") || document.body; return [...a.children].slice(0,8).map(e => e.tagName + "." + [...e.classList].slice(0,3).join(".") + " h=" + Math.round(e.getBoundingClientRect().height)); })(),
    scroller: (() => { const s = document.scrollingElement; return [s.tagName, s.scrollHeight, s.clientHeight]; })(),
    positioned: [...document.querySelectorAll("body *")].filter(e => { const p = getComputedStyle(e).position; return p === "fixed" || p === "sticky"; })
      .slice(0, 25).map(e => { const r = e.getBoundingClientRect(); return getComputedStyle(e).position + " " + e.tagName + "." + [...e.classList].slice(0,2).join(".") + (e.id ? "#" + e.id : "") + " " + [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","); }),
    scrollables: [...document.querySelectorAll("body *")].filter(e => { const o = getComputedStyle(e).overflowY; return (o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 10; })
      .slice(0, 10).map(e => e.tagName + "." + [...e.classList].slice(0,2).join(".") + (e.id ? "#" + e.id : "") + " " + e.clientHeight),
    bodyGrid: getComputedStyle(document.body).display + " / " + (document.body.firstElementChild ? document.body.firstElementChild.tagName + "." + [...document.body.firstElementChild.classList].join(".") + " " + getComputedStyle(document.body.firstElementChild).display : ""),
    signin: (() => { const b = [...document.querySelectorAll("button")].find(x => /connecter|sign in/i.test(x.textContent||"")); if (!b) return null;
      const chain = []; let e = b; for (let i = 0; i < 4 && e; i++, e = e.parentElement) chain.push(e.tagName + "." + [...e.classList].join(".") + (e.dataset.testid ? "[" + e.dataset.testid + "]" : ""));
      return { chain, bg: getComputedStyle(b).backgroundColor }; })(),
    navBg: getComputedStyle(document.querySelector("#navigation")||document.body).backgroundColor,
    navVars: [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
      .map(r => r.cssText || "").join(" ").match(/--[a-zA-Z-]*navigation[a-zA-Z-]*/gi)?.filter((v,i,a)=>a.indexOf(v)===i).slice(0,20),
  });
})()`;

/** Capture any view's page to CASSETTE_DEV_PROBE with a suffix, when it is set. */
export function devCapture(contents: WebContents, suffix: string, delayMs: number): void {
  const target = process.env.CASSETTE_DEV_PROBE;
  // Child views have no surface while the window is hidden, so a probe run,
  // which keeps it hidden, only captures them when CASSETTE_DEV_SHOW is also set.
  if (!target || process.env.CASSETTE_DEV_SHOW !== "1") return;
  setTimeout(async () => {
    if (contents.isDestroyed()) return;
    try {
      const image = await contents.capturePage(undefined, HIDDEN);
      fs.writeFileSync(target.replace(/\.png$/, `-${suffix}.png`), image.toPNG());
      probeLog.info(`captured ${suffix}`);
    } catch (err: unknown) {
      probeLog.warn(`capture ${suffix} failed`, err);
    }
  }, delayMs);
}

/** Capture the page once it has settled, when CASSETTE_DEV_PROBE is set. */
export function scheduleDevProbe(win: BrowserWindow, ready: Promise<void>): void {
  const target = process.env.CASSETTE_DEV_PROBE;
  if (!target) return;
  if (process.env.CASSETTE_DEV_DARK === "1") nativeTheme.themeSource = "dark";
  void ready.then(() =>
    setTimeout(async () => {
      if (win.isDestroyed()) return;
      try {
        probeLog.info(await win.webContents.executeJavaScript(PROBE_SCRIPT));
        const image = await win.webContents.capturePage(undefined, HIDDEN);
        fs.writeFileSync(target, image.toPNG());
        probeLog.info("page captured");
      } catch (err: unknown) {
        probeLog.warn("probe failed", err);
      }
    }, 5000),
  );
}
