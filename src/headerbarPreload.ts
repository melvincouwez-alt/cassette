// Preload for Cassette's header bar view. It exposes one send() limited to the
// header actions and one state subscription; nothing else crosses the bridge.

import { contextBridge, ipcRenderer } from "electron";
import type { HeaderAction, HeaderState } from "./headerbarTypes";

const ACTIONS: Record<HeaderAction, true> = {
  back: true,
  forward: true,
  settings: true,
  playPause: true,
  previous: true,
  next: true,
  shuffle: true,
  repeat: true,
  queue: true,
  lyrics: true,
  mute: true,
  mini: true,
  search: true,
};

function isAction(value: string): value is HeaderAction {
  return Object.prototype.hasOwnProperty.call(ACTIONS, value);
}

contextBridge.exposeInMainWorld("ariaHeader", {
  send(action: string): void {
    if (isAction(action)) ipcRenderer.send("aria-header:action", action);
  },
  seek(fraction: number): void {
    if (Number.isFinite(fraction) && fraction >= 0 && fraction <= 1)
      ipcRenderer.send("aria-header:seek", fraction);
  },
  setVolume(fraction: number): void {
    if (Number.isFinite(fraction) && fraction >= 0 && fraction <= 1)
      ipcRenderer.send("aria-header:volume", fraction);
  },
  onPosition(callback: (seconds: number) => void): void {
    ipcRenderer.on("aria-header:position", (_event, seconds: number) =>
      callback(seconds),
    );
  },
  onState(callback: (state: HeaderState) => void): void {
    ipcRenderer.on("aria-header:state", (_event, state: HeaderState) =>
      callback(state),
    );
    ipcRenderer.send("aria-header:ready");
  },
});
