// Cassette's window on Linux keeps the frame Chromium draws from the GTK theme,
// which is what gives it elementary's rounded corners, shadow, resize edges and
// window buttons, but hides its title bar (Window Controls Overlay): the
// buttons float over src/headerbar.ts, which draws the rest of the header bar
// in Cassette's raspberry and leaves room for them.

import type { BrowserWindowConstructorOptions } from "electron";
import { HEADERBAR_HEIGHT_PX, windowBackground } from "./headerbar";

/** BrowserWindow options for the header bar window; empty off Linux. */
export function windowChromeOptions(): Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "titleBarOverlay" | "backgroundColor"
> {
  if (process.platform !== "linux") return {};
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: "#ffffff",
      height: HEADERBAR_HEIGHT_PX,
    },
    backgroundColor: windowBackground(),
  };
}
