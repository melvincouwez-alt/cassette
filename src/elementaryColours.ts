// Cassette's brand colour, raspberry, and a pure helper for the elementary theme.
// Kept free of Electron so unit tests can import them.
//
// elementary lets an app carry a brand colour on its header bar; Cassette's is
// raspberry, matching its icon, and it is the accent inside the app whatever
// the system accent is. Values sit between elementary's Strawberry and
// Bubblegum, with its 100-900 steps.

export const RASPBERRY = {
  100: "#ffc2d1",
  300: "#ff8fab",
  500: "#e03a64",
  700: "#b01e47",
  900: "#7d0a2c",
} as const;

/** Accent and its rollover per colour scheme; both reach 4.5:1 on the page. */
export const BRAND_ACCENT = {
  light: { accent: "#c42a55", accentHover: RASPBERRY[900] },
  dark: { accent: RASPBERRY[300], accentHover: RASPBERRY[100] },
} as const;

/** Mix a hex colour towards black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const parts = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `#${parts
    .map((p) => {
      const v = Math.min(255, Math.max(0, Math.round(p + (target - p) * t)));
      return v.toString(16).padStart(2, "0");
    })
    .join("")}`;
}
