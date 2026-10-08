// Preload for Cassette's side panel view. It exposes one send() for panel
// actions and two subscriptions; main validates every action again.

import { contextBridge, ipcRenderer } from "electron";
import type { PanelAction, PanelState } from "./panelTypes";

contextBridge.exposeInMainWorld("cassettePanel", {
  send(action: PanelAction): void {
    ipcRenderer.send("cassette-panel:action", action);
  },
  onPosition(callback: (seconds: number) => void): void {
    ipcRenderer.on("cassette-panel:position", (_event, seconds: number) =>
      callback(seconds),
    );
  },
  onState(callback: (state: PanelState) => void): void {
    ipcRenderer.on("cassette-panel:state", (_event, state: PanelState) =>
      callback(state),
    );
    ipcRenderer.send("cassette-panel:ready");
  },
});
