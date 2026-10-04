// Rules the elementary theme adds on top of its palette. Everything inside the
// template literals ships to the renderer (see the note in src/themeTemplate.ts):
// section labels only, rationale stays here.
//
// Inter is elementary's interface font; Apple's page asks for SF Pro first,
// which Linux does not have, and falls back to whatever sans-serif is set.

/** Font and small touches that make Apple's page read as an elementary app. */
export const ELEMENTARY_CSS = `/* elementary: interface font */
:root, body, button, input, select, textarea {
  font-family: "Inter Variable", "Inter", system-ui, sans-serif !important;
  font-feature-settings: "ss03", "cv11" !important;
}

/* elementary: sidebar */
.navigation__header {
  background: transparent !important;
}
nav.navigation {
  background-color: rgba(0, 0, 0, 0.03) !important;
  box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.1) !important;
}
#navigation {
  background: transparent !important;
}
@media (prefers-color-scheme: dark) {
  nav.navigation {
    background-color: rgba(0, 0, 0, 0.15) !important;
    box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.35) !important;
  }
}

/* elementary: accent on the sign-in button */
[data-testid="sign-in-button"], .commerce-button.signin {
  background-color: var(--keyColor) !important;
  border-radius: 6px !important;
}
`;

// On Linux the window is frameless and src/headerbar.ts lays an elementary
// header bar over the top of the page. Apple's layout is one viewport-high
// container with its own scrolling panes and nothing fixed, so moving that
// container down by the bar's height and shortening it by as much is enough.
// Apple's floating player bar is hidden: the header bar carries playback, and
// its Up Next and Lyrics buttons click Apple's own, left in the hidden bar.

/** Room for the header bar, injected whatever the theme (Linux only). */
export const TITLEBAR_CSS = `/* Cassette: room for the header bar */
.body-container {
  margin-top: 48px !important;
  height: calc(100vh - 48px) !important;
}
.body-container :is(.app-container > .header, #scrollable-page) {
  height: calc(100vh - 48px) !important;
  max-height: calc(100vh - 48px) !important;
}
/* Cassette: playback lives in the header bar */
.player-bar {
  display: none !important;
}
.body-container #navigation {
  max-height: calc(100vh - 48px - 44px) !important;
}
`;
