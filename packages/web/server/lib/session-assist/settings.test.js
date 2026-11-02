import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_IDLE_QUIET_MS,
  MAX_IDLE_QUIET_MS,
  MIN_IDLE_QUIET_MS,
  isSessionAssistIdleQuietMs,
  readSessionAssistQuietMs,
} from './settings.js';

describe('isSessionAssistIdleQuietMs', () => {
  it('accepts integers inside the bounded range only', () => {
    expect(isSessionAssistIdleQuietMs(DEFAULT_IDLE_QUIET_MS)).toBe(true);
    expect(isSessionAssistIdleQuietMs(MIN_IDLE_QUIET_MS)).toBe(true);
    expect(isSessionAssistIdleQuietMs(MAX_IDLE_QUIET_MS)).toBe(true);
    expect(isSessionAssistIdleQuietMs(MIN_IDLE_QUIET_MS - 1)).toBe(false);
    expect(isSessionAssistIdleQuietMs(MAX_IDLE_QUIET_MS + 1)).toBe(false);
    expect(isSessionAssistIdleQuietMs(1.5)).toBe(false);
    expect(isSessionAssistIdleQuietMs('60000')).toBe(false);
    expect(isSessionAssistIdleQuietMs(NaN)).toBe(false);
    expect(isSessionAssistIdleQuietMs(null)).toBe(false);
    expect(isSessionAssistIdleQuietMs(undefined)).toBe(false);
  });
});

describe('readSessionAssistQuietMs', () => {
  const dirs = [];
  const useSettings = (contents) => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-assist-settings-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'settings.json'), contents);
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dir);
    vi.resetModules();
    return import('./settings.js');
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  it('returns the configured window', async () => {
    const { readSessionAssistQuietMs: read } = await useSettings(JSON.stringify({ sessionAssistIdleQuietMs: 5_000 }));
    expect(read()).toBe(5_000);
  });

  it('returns undefined when the key is absent or malformed, keeping the runtime default', async () => {
    const absent = await useSettings(JSON.stringify({}));
    expect(absent.readSessionAssistQuietMs()).toBeUndefined();
    vi.resetModules();
    const malformed = await useSettings(JSON.stringify({ sessionAssistIdleQuietMs: 'soon' }));
    expect(malformed.readSessionAssistQuietMs()).toBeUndefined();
  });
});

describe('readSessionAssistQuietMs degradation', () => {
  it('degrades to undefined when the settings file is corrupt JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-assist-quiet-corrupt-'));
    writeFileSync(join(dir, 'settings.json'), '{not valid json');
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dir);
    vi.resetModules();
    const { readSessionAssistQuietMs: read } = await import('./settings.js');
    expect(() => read()).not.toThrow();
    expect(read()).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('warns when the stored value is out of range', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-assist-quiet-invalid-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessionAssistIdleQuietMs: 500 }));
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dir);
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { readSessionAssistQuietMs: read } = await import('./settings.js');
    expect(read()).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
});

describe('readSessionAssistQuietMs (delta 2)', () => {
  it('warns only once for a persistently invalid value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-assist-quiet-warnonce-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessionAssistIdleQuietMs: 500 }));
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dir);
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { readSessionAssistQuietMs: read } = await import('./settings.js');
    read();
    read();
    read();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('warns again for a different invalid value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-assist-quiet-warnpervalue-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessionAssistIdleQuietMs: 500 }));
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dir);
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { readSessionAssistQuietMs: read } = await import('./settings.js');
    read();
    expect(warn).toHaveBeenCalledTimes(1);
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessionAssistIdleQuietMs: 400 }));
    read();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
});

describe('readSessionAssistTargets (delta 2)', () => {
  it('falls back to both targets enabled when the settings file is unreadable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-assist-targets-corrupt-'));
    writeFileSync(join(dir, 'settings.json'), '{not valid json');
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dir);
    vi.resetModules();
    const { readSessionAssistTargets } = await import('./settings.js');
    expect(readSessionAssistTargets()).toEqual({ recap: true, suggestion: true });
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('honors explicit target toggles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-assist-targets-off-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessionRecapEnabled: false, sessionSuggestionEnabled: false }));
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dir);
    vi.resetModules();
    const { readSessionAssistTargets } = await import('./settings.js');
    expect(readSessionAssistTargets()).toEqual({ recap: false, suggestion: false });
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
});


  it('resets the warn latch after a valid value, so a re-introduced misconfiguration warns again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-assist-quiet-reset-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessionAssistIdleQuietMs: 500 }));
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dir);
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { readSessionAssistQuietMs: read } = await import('./settings.js');
    read();
    read();
    expect(warn).toHaveBeenCalledTimes(1);
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessionAssistIdleQuietMs: 60000 }));
    read();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessionAssistIdleQuietMs: 500 }));
    read();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

describe('bounds parity with the UI constants (delta 3)', () => {
  it('server and ui quiet-window bounds agree', async () => {
    const ui = await import('../../../../ui/src/lib/sessionAssistQuietMs');
    const server = await import('./settings.js');
    // The UI file deliberately exports no default: 60s is the server's own
    // fallback, only the bounds are a shared contract.
    expect(server.MIN_IDLE_QUIET_MS).toBe(ui.SESSION_ASSIST_MIN_IDLE_QUIET_MS);
    expect(server.MAX_IDLE_QUIET_MS).toBe(ui.SESSION_ASSIST_MAX_IDLE_QUIET_MS);
  });
});
