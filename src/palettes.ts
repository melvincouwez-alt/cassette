// Keep this palette free of Electron so unit tests can import it.
// It maps elementary's stylesheet colours to the 12 semantic slots in
// ThemeDefinition. A "derived" shade has no upstream equivalent and is
// selected to fit the semantic slot.
//
// Palette invariants:
// - overlay differs from subtext0, and crust differs from surface0. Each pair
//   paints different UI elements, so duplicate values flatten their contrast.
// - text and subtext0 reach 4.5:1 against base after the template applies
//   alpha.
//
// Upstream source for the colour values:
// - elementary  https://github.com/elementary/stylesheet  GPL-3.0 (colour values only)

import type { ThemeDefinition } from './themeTemplate';

/**
 * Cassette's look: elementary's greys with Cassette's raspberry brand accent
 * (src/elementaryColours.ts), whatever the system accent is.
 */
export const ELEMENTARY_THEME: ThemeDefinition = {
  name: 'elementary',
  label: 'elementary',
  dark: {
    base: '#333333', // bg_color
    mantle: '#2b2b2b', // derived
    crust: '#1a1a1a', // BLACK_700
    surface0: '#3a3a3a', // base_color
    surface1: '#4d4d4d', // BLACK_300
    surface2: '#666666', // BLACK_100
    overlay: '#abacae', // SILVER_500
    text: '#ffffff', // fg_color
    subtext1: '#d4d4d4', // SILVER_300
    subtext0: '#cecece', // placeholder_text_color
    accent: '#ff8fab', // RASPBERRY 300
    accentHover: '#ffc2d1', // RASPBERRY 100
  },
  light: {
    base: '#fafafa', // bg_color
    mantle: '#f0f0f0', // derived
    crust: '#dfdfdf', // color_primary
    surface0: '#ebebeb', // derived
    surface1: '#d4d4d4', // SILVER_300
    surface2: '#abacae', // SILVER_500
    overlay: '#7e8087', // SILVER_700
    text: '#333333', // fg_color
    subtext1: '#4d4d4d', // BLACK_300
    subtext0: '#555761', // SILVER_900
    accent: '#c42a55', // RASPBERRY, darkened for 4.5:1 on the page
    accentHover: '#7d0a2c', // RASPBERRY 900
  },
};
