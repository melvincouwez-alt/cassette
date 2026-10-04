import { nativeTheme, type WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ELEMENTARY_CSS } from "../src/elementaryCss";
import { ELEMENTARY_THEME } from "../src/palettes";
import { buildThemeCss } from "../src/themeTemplate";
import {
  getThemeCss,
  initThemeCSS,
  injectThemeCss,
  notifyDocumentReplacing,
} from "../src/theme";

describe("theme", () => {
  beforeEach(() => {
    vi.mocked(nativeTheme.on).mockClear();
    // The module retains its key between tests. Queue the clear first so test
    // operations start without a tracked sheet.
    notifyDocumentReplacing();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The CSS queue is not exported, so draining the microtask queue is the only
  // way to wait for work a colour-scheme change enqueued.
  async function flushCssQueue(): Promise<void> {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }

  function fakeContents() {
    const insertCSS = vi.fn().mockResolvedValue("key");
    return { insertCSS, contents: { insertCSS } as unknown as WebContents };
  }

  // A WebContents whose insertCSS stays pending until release() is called, so
  // a test can hold a page-load injection open and queue work behind it.
  function heldContents() {
    let release: (key: string) => void = () => {
      /* replaced below */
    };
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const insertCSS = vi.fn().mockReturnValue(pending);
    return {
      insertCSS,
      release: (key: string) => release(key),
      contents: { insertCSS } as unknown as WebContents,
    };
  }

  // A main window for initThemeCSS(), with the colour-scheme listener it
  // registers and the did-navigate listener that advances the document.
  function windowHarness() {
    const removeInsertedCSS = vi.fn().mockResolvedValue(undefined);
    const insertCSS = vi.fn().mockResolvedValue("scheme-key");
    const contentsListeners = new Map<string, () => void>();
    const win = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        isDestroyed: vi.fn().mockReturnValue(false),
        removeInsertedCSS,
        insertCSS,
        on: vi.fn((event: string, handler: () => void) => {
          contentsListeners.set(event, handler);
        }),
      },
    } as unknown as Parameters<typeof initThemeCSS>[0];
    initThemeCSS(win);
    const schemeListener = vi
      .mocked(nativeTheme.on)
      .mock.calls.find(([event]) => event === "updated")?.[1] as
      | (() => void)
      | undefined;
    return {
      insertCSS,
      removeInsertedCSS,
      navigate: () => contentsListeners.get("did-navigate")?.(),
      schemeChanged: () => schemeListener?.(),
    };
  }

  it("renders the elementary palette followed by the elementary rules", () => {
    const css = getThemeCss();
    expect(css).toBe(`${buildThemeCss(ELEMENTARY_THEME)}\n${ELEMENTARY_CSS}`);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("@media (prefers-color-scheme: light)");
    expect(css).toContain("--keyColor: #ff8fab !important;");
    expect(getThemeCss()).toBe(css);
  });

  it("injects Cassette's stylesheet on a page load", async () => {
    const { insertCSS, contents } = fakeContents();

    await injectThemeCss(contents);

    expect(insertCSS).toHaveBeenCalledExactlyOnceWith(getThemeCss());
  });

  it("replaces the tracked sheet when the colour scheme changes", async () => {
    const harness = windowHarness();
    const { contents } = fakeContents();
    await injectThemeCss(contents);

    harness.schemeChanged();
    await flushCssQueue();

    expect(harness.removeInsertedCSS).toHaveBeenCalledExactlyOnceWith("key");
    expect(harness.insertCSS).toHaveBeenCalledExactlyOnceWith(getThemeCss());
  });

  it("leaves one stylesheet when a scheme change lands during a page load", async () => {
    // Both entry points share one queue, so the scheme change waits for the
    // in-flight injection and removes the key that injection produced.
    const harness = windowHarness();
    const { insertCSS, release, contents } = heldContents();

    const loading = injectThemeCss(contents);
    await flushCssQueue();
    expect(insertCSS).toHaveBeenCalledTimes(1);

    harness.schemeChanged();
    await flushCssQueue();
    expect(harness.removeInsertedCSS).not.toHaveBeenCalled();
    expect(harness.insertCSS).not.toHaveBeenCalled();

    release("load-key");
    await loading;
    await flushCssQueue();

    expect(harness.removeInsertedCSS).toHaveBeenCalledExactlyOnceWith(
      "load-key",
    );
    expect(harness.insertCSS).toHaveBeenCalledTimes(1);
  });

  it("settles the returned promise when the operation itself fails", async () => {
    const insertCSS = vi
      .fn()
      .mockRejectedValue(new Error("Failed to insert CSS"));
    const failing = { insertCSS } as unknown as WebContents;

    await expect(injectThemeCss(failing)).resolves.toBeUndefined();

    // Handling the failure must not stop the next queued operation running.
    const next = fakeContents();
    await injectThemeCss(next.contents);
    expect(next.insertCSS).toHaveBeenCalledTimes(1);
  });

  it("drops queued work when the document is replaced before it runs", async () => {
    // insertCSS reaches whatever document the WebContents holds at call time,
    // so an injection queued for the old page must not land on the new one.
    const harness = windowHarness();
    const held = heldContents();
    const stale = fakeContents();

    const inFlight = injectThemeCss(held.contents);
    await flushCssQueue();
    const queued = injectThemeCss(stale.contents);
    harness.navigate();
    held.release("load-key");
    await inFlight;
    await queued;
    await flushCssQueue();

    expect(stale.insertCSS).not.toHaveBeenCalled();

    // The released key belongs to the replaced document, so the next scheme
    // change must insert without attempting a removal.
    harness.schemeChanged();
    await flushCssQueue();
    expect(harness.removeInsertedCSS).not.toHaveBeenCalled();
    expect(harness.insertCSS).toHaveBeenCalledTimes(1);
  });

  it("recovers after a failed removal", async () => {
    // A rejected removal leaves a key naming a sheet that cannot be removed, so
    // keeping it would send every later change down the same removal.
    const harness = windowHarness();
    const { contents } = fakeContents();
    await injectThemeCss(contents);
    harness.removeInsertedCSS.mockRejectedValueOnce(
      new Error("Failed to remove inserted CSS"),
    );

    harness.schemeChanged();
    await flushCssQueue();
    expect(harness.insertCSS).not.toHaveBeenCalled();

    harness.schemeChanged();
    await flushCssQueue();
    expect(harness.removeInsertedCSS).toHaveBeenCalledTimes(1);
    expect(harness.insertCSS).toHaveBeenCalledTimes(1);
  });

});
