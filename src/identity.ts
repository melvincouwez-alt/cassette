// Cassette's desktop identity on Linux. The .desktop file, the Wayland app_id,
// the MPRIS DesktopEntry and the notification desktop-entry hint must all name
// the same file, or elementary's dock and sound indicator show a generic icon.
// Boomerang looks the app up by this id in its Services Apple tab.

/** Reverse-DNS id, without the .desktop suffix. Matches package.json desktopName. */
export const DESKTOP_ID = "io.github.melvincouwez.Cassette";
