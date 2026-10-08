import { contextBridge, ipcRenderer } from "electron";

/**
 * Build an exhaustive channel allowlist, making missing and unknown keys compile errors.
 * channelSet() owns the Object.keys() cast, while allows() narrows untrusted main-world strings to the channel union.
 */
function channelSet<C extends string>(
  channels: Record<C, true>,
): { all: readonly C[]; allows(value: string): value is C } {
  const all = Object.keys(channels) as C[];
  const set = new Set<string>(all);
  return { all, allows: (value: string): value is C => set.has(value) };
}

// Channels the renderer is allowed to send to the main process.
// Extend this list and SendChannel in src/types/hook.d.ts together.
const SEND_CHANNELS = channelSet<SendChannel>({
  playbackStateDidChange: true,
  hookReady: true,
  playbackCapabilitiesDidChange: true,
  playbackStopped: true,
  nowPlayingItemDidChange: true,
  timedMetadataDidChange: true,
  playbackTimeDidChange: true,
  repeatModeDidChange: true,
  shuffleModeDidChange: true,
  volumeDidChange: true,
  "nav:back": true,
  "nav:forward": true,
  "nav:reload": true,
  "nav:settings": true,
});

// Channels the main process is allowed to send to the renderer.
// Each channel maps to a window.__sidra method dispatched via ipcRenderer.on().
// The command allowlist in assets/musicKitHook.js must stay in sync.
const RECEIVE_CHANNELS = channelSet<ReceiveChannel>({
  "player:play": true,
  "player:openUri": true,
  "player:pause": true,
  "player:stop": true,
  "player:playPause": true,
  "player:next": true,
  "player:previous": true,
  "player:seek": true,
  "player:setVolume": true,
  "player:setRepeat": true,
  "player:setShuffle": true,
});

// The preload runs in the isolated world (contextIsolation: true), so it cannot
// call window.__sidra directly. That object lives in the main world, set up by
// musicKitHook.js. window.postMessage() crosses the isolation boundary, and the
// hook dispatches each sidra:command message to the matching __sidra method.
// The target origin is window.location.origin, so the bridge works on either
// service host without naming one.
for (const channel of RECEIVE_CHANNELS.all) {
  ipcRenderer.on(channel, (_event, ...args: unknown[]) => {
    const message = {
      type: "sidra:command",
      channel,
      args,
    } satisfies SidraCommandMessage;
    window.postMessage(message, window.location.origin);
  });
}

/**
 * Expose only allowlisted sends through window.AMWrapper for the hook's sendToMain().
 * satisfies checks the bridge contract because exposeInMainWorld() does not type-check its payload.
 */
contextBridge.exposeInMainWorld("AMWrapper", {
  ipcRenderer: {
    send: (channel: string, data: unknown, generation?: number) => {
      if (!SEND_CHANNELS.allows(channel)) {
        console.warn(
          `AMWrapper: blocked send on unlisted channel "${channel}"`,
        );
        return;
      }
      ipcRenderer.send(channel, data, generation);
    },
  },
} satisfies AMWrapperBridge);
