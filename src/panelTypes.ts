// Contract between src/sidePanel.ts, its preload and assets/panel.js.

/** The panel's three pages, opened from the header bar. */
export type PanelTab = "lyrics" | "queue" | "search";

/** One row in the queue or in search results. Artwork is an https mzstatic URL or "". */
export interface PanelRow {
  title: string;
  subtitle: string;
  artwork: string;
}

/** A search result; the kind decides what a click does (play or open the page). */
export interface SearchRow extends PanelRow {
  kind: "song" | "album" | "artist" | "playlist";
}

export type LyricsState =
  | { status: "empty" | "loading" | "none" | "error" }
  /** Apple's TTML, parsed in the panel with DOMParser and read as text only. */
  | { status: "ok"; ttml: string };

/** Everything the panel draws, except the playback position. */
export interface PanelState {
  tab: PanelTab;
  /** Title of the current track, shown above the lyrics. */
  track: string;
  lyrics: LyricsState;
  queue: { items: PanelRow[]; position: number };
  search: {
    term: string;
    status: "idle" | "loading" | "ok" | "error";
    results: SearchRow[];
  };
}

/**
 * What the panel can ask for. Rows are named by index into the state main
 * sent, never by id or URL, so the renderer cannot make Cassette open or play
 * something it did not list.
 */
export type PanelAction =
  | { type: "close" }
  | { type: "tab"; tab: PanelTab }
  | { type: "search"; term: string }
  | { type: "playQueueItem"; index: number }
  | { type: "openResult"; index: number };
