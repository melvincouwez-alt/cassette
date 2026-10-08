import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadPreload() {
  vi.resetModules();
  vi.stubGlobal('window', {
    location: { origin: 'https://music.apple.com' },
    postMessage: vi.fn(),
  });

  const { contextBridge, ipcRenderer } = await import('electron');
  Object.assign(ipcRenderer, { on: vi.fn() });
  vi.mocked(ipcRenderer.send).mockClear();
  vi.mocked(contextBridge.exposeInMainWorld).mockClear();

  await import('../src/preload');
  return { contextBridge, ipcRenderer };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preload', () => {
  it('compiles without a relative runtime require', () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'sidra-preload-'));
    try {
      execFileSync(process.execPath, [
        'node_modules/typescript/lib/tsc.js',
        '-p',
        'tsconfig.json',
        '--outDir',
        outputDirectory,
        '--sourceMap',
        'false',
      ]);
      const compiled = readFileSync(join(outputDirectory, 'preload.js'), 'utf8');
      const requires = [...compiled.matchAll(/\brequire\((["'])([^"']+)\1\)/g)]
        .map((match) => match[2]);

      expect(requires).toEqual(['electron']);
      const settingsPreload = readFileSync(join(outputDirectory, 'settingsPreload.js'), 'utf8');
      expect([...settingsPreload.matchAll(/\brequire\((["'])([^"']+)\1\)/g)].map(match => match[2]))
        .toEqual(['electron']);
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('blocks unlisted channels on the public bridge', async () => {
    const harness = await loadPreload();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const exposed = vi.mocked(harness.contextBridge.exposeInMainWorld).mock.calls
      .find(([key]) => key === 'AMWrapper')?.[1] as {
        ipcRenderer: { send(channel: string, data?: unknown, generation?: number): void };
      };

    exposed.ipcRenderer.send('controller:action', 'up');
    expect(harness.ipcRenderer.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'AMWrapper: blocked send on unlisted channel "controller:action"',
    );

    exposed.ipcRenderer.send('playbackStateDidChange', true, 7);
    expect(harness.ipcRenderer.send).toHaveBeenCalledWith('playbackStateDidChange', true, 7);
  });

  it('allows only the Settings entry point, not private Settings channels', async () => {
    const harness = await loadPreload();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const exposed = vi.mocked(harness.contextBridge.exposeInMainWorld).mock.calls
      .find(([key]) => key === 'AMWrapper')?.[1] as {
        ipcRenderer: { send(channel: string, data?: unknown): void };
      };
    for (const channel of ['settings:get', 'settings:apply', 'settings:state']) {
      exposed.ipcRenderer.send(channel);
    }
    expect(harness.ipcRenderer.send).not.toHaveBeenCalled();
    exposed.ipcRenderer.send('nav:settings');
    expect(harness.ipcRenderer.send).toHaveBeenCalledWith('nav:settings', undefined, undefined);
  });
});
