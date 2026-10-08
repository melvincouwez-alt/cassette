// Contract between src/headerbar.ts, its preload and assets/headerbar.js.

import type { PanelTab } from "./panelTypes";

/** Clicks the header bar can report. The window buttons are the frame's own. */
export type HeaderAction =
  | "back"
  | "forward"
  | "settings"
  | "playPause"
  | "previous"
  | "next"
  | "shuffle"
  | "repeat"
  | "queue"
  | "lyrics"
  | "mute"
  | "mini"
  | "search";

/** The track the header bar shows, from the player's validated payload. */
export interface HeaderTrack {
  title: string;
  artist: string;
  /** https URL on mzstatic.com, or "" when there is none. */
  artwork: string;
}

/** Everything the header bar draws, except the playback position. */
export interface HeaderState {
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  /** Room the frame's window buttons take at the start and end of the bar, in px. */
  insetStart: number;
  insetEnd: number;
  track: HeaderTrack | null;
  playing: boolean;
  /** Seconds, or 0 when unknown (radio, nothing queued). */
  duration: number;
  canSeek: boolean;
  shuffle: boolean;
  /** MusicKit repeat mode: 0 none, 1 one, 2 all. */
  repeat: number;
  /** Cassette's own volume (MusicKit's), 0 to 1. */
  volume: number;
  /** The window is shrunk to the bar alone, as a mini player. */
  mini: boolean;
  /** The side panel tab showing, or null when the panel is closed. */
  panel: PanelTab | null;
}
