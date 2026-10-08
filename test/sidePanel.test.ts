import { describe, expect, it } from "vitest";
import { artworkUrl, isPanelAction } from "../src/sidePanel";

describe("side panel", () => {
  it("accepts only the fixed actions, with rows named by index", () => {
    expect(isPanelAction({ type: "tab", tab: "queue" })).toBe(true);
    expect(isPanelAction({ type: "search", term: "daft punk" })).toBe(true);
    expect(isPanelAction({ type: "openResult", index: 2 })).toBe(true);
    expect(isPanelAction({ type: "tab", tab: "settings" })).toBe(false);
    expect(isPanelAction({ type: "openResult", index: -1 })).toBe(false);
    expect(isPanelAction({ type: "openResult", index: 1.5 })).toBe(false);
    expect(isPanelAction({ type: "openUrl", url: "https://example.com" })).toBe(false);
    expect(isPanelAction(null)).toBe(false);
  });

  it("keeps artwork on mzstatic.com only, at thumbnail size", () => {
    expect(artworkUrl("https://is1-ssl.mzstatic.com/image/thumb/a.jpg/{w}x{h}bb.jpg")).toBe(
      "https://is1-ssl.mzstatic.com/image/thumb/a.jpg/96x96bb.jpg",
    );
    expect(artworkUrl("https://evil.example/{w}x{h}.jpg")).toBe("");
    expect(artworkUrl("http://is1-ssl.mzstatic.com/a.jpg")).toBe("");
    expect(artworkUrl(42)).toBe("");
  });
});
