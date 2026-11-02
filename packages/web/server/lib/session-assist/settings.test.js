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
