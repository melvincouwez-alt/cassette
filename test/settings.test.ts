import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conf } from 'electron-conf/main';
import type { BrowserWindow } from 'electron';
import * as config from '../src/config';
import { applySettingsAction, getSettingsState, initSettingsActions, notifySettingsChanged, subscribeSettingsChanges } from '../src/settings';

const applyZoom = vi.fn();
const refreshTray = vi.fn();
const switchService = vi.fn((id: 'music' | 'classical') => config.setMusicService(id));
const window = { isVisible: () => false, show: vi.fn(), focus: vi.fn() };
let dispose: () => void;

beforeEach(() => {
  (Conf as unknown as { _data: Map<string, unknown> })._data.clear();
  vi.clearAllMocks();
  dispose = initSettingsActions({ getMainWindow: () => window as unknown as BrowserWindow, applyZoom, switchService, refreshTray });
});
afterEach(() => dispose());

describe('settings actions', () => {
  it('reads defaults', () => {
    expect(getSettingsState()).toMatchObject({ musicService: 'music', startPage: 'new', zoomFactor: 1 });
  });

  it('persists before runtime effects and publishes the new state', () => {
    applyZoom.mockImplementationOnce(() => expect(config.getZoomFactor()).toBe(1.5));
    const listener = vi.fn();
    const unsubscribe = subscribeSettingsChanges(listener);
    applySettingsAction({ type: 'closeToTray', value: true });
    applySettingsAction({ type: 'zoomFactor', value: 1.5 });
    applySettingsAction({ type: 'notifications', value: false });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ closeToTray: true, zoomFactor: 1.5, notifications: false }));
    unsubscribe();
    notifySettingsChanged();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('shows a hidden player when close to tray is disabled', () => {
    config.setCloseToTrayEnabled(true);
    applySettingsAction({ type: 'closeToTray', value: false });
    expect(config.getCloseToTrayEnabled()).toBe(false);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('switches once and preserves independent start pages', () => {
    applySettingsAction({ type: 'startPage', serviceId: 'music', value: 'radio' });
    applySettingsAction({ type: 'musicService', value: 'classical' });
    applySettingsAction({ type: 'musicService', value: 'classical' });
    expect(switchService).toHaveBeenCalledOnce();
    expect(getSettingsState().startPage).toBe('home');
    applySettingsAction({ type: 'startPage', serviceId: 'classical', value: 'search' });
    expect(config.getStartPage()).toBe('radio');
    expect(config.getClassicalStartPage()).toBe('search');
    expect(() => applySettingsAction({ type: 'startPage', serviceId: 'music', value: 'home' })).toThrow();
  });

  it.each([
    null, [], {}, { type: 'arbitrary' }, { type: 'notifications', value: 1 },
    { type: 'zoomFactor', value: 1.1 }, { type: 'zoomFactor', value: NaN },
    { type: 'musicService', value: 'other' }, { type: 'theme', value: 'nord' },
    { type: 'startPage', serviceId: 'music', value: 'search' },
    { type: 'notifications', value: true, extra: true }, { type: 'lastfmDisconnect' },
    { type: 'lastfmEnabled', value: true },
  ])('rejects unavailable or malformed actions: %j', action => {
    expect(() => applySettingsAction(action)).toThrow('Invalid settings action');
    expect(refreshTray).not.toHaveBeenCalled();
  });
});
