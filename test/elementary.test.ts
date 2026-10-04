import { describe, expect, it } from "vitest";
import { shade } from "../src/elementaryColours";
import { pageTitle } from "../src/headerbar";

describe("elementary colours", () => {
  it("shades towards black and white", () => {
    expect(shade("#e03a64", -1)).toBe("#000000");
    expect(shade("#e03a64", 1)).toBe("#ffffff");
    expect(shade("#808080", 0)).toBe("#808080");
  });
});

describe("header bar title", () => {
  it("drops Apple's suffix and keeps the page name", () => {
    expect(pageTitle("Nouveautés - Apple Music")).toBe("Nouveautés");
    expect(pageTitle("Rumours – Fleetwood Mac – Apple Music")).toBe(
      "Rumours – Fleetwood Mac",
    );
  });

  it("shows the app name for Apple's generic titles, bidi marks included", () => {
    expect(pageTitle("‎Apple Music – Lecteur web")).toBe("Cassette");
    expect(pageTitle("")).toBe("Cassette");
  });
});
