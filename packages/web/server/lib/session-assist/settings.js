import fs from 'fs';
import path from 'path';

import { getOpenChamberSettingsFilePath, readMergedSettingsSync } from '../opencode/settings-files.js';

/** Default quiet window (historically the IDLE_QUIET_MS constant in runtime.js). */
export const DEFAULT_IDLE_QUIET_MS = 60_000;
export const MIN_IDLE_QUIET_MS = 1_000;
export const MAX_IDLE_QUIET_MS = 3_600_000;

// Same bounds as packages/ui/src/lib/sessionAssistQuietMs.ts; the server
// cannot import the TS source, so keep the constants in sync.
export function isSessionAssistIdleQuietMs(value) {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_IDLE_QUIET_MS && value <= MAX_IDLE_QUIET_MS;
}

/**
 * Read the merged settings document. Contract guard: readMergedSettingsSync
 * currently swallows read/parse failures and always returns an object, and
 * getOpenChamberSettingsFilePath() is a pure path join — so the catch arms
 * are unreachable today. They exist so a future refactor that throws does
 * not silently crash the turn-end path.
 */
function readSettings() {
  try {
    return readMergedSettingsSync({ fs, path, settingsFilePath: getOpenChamberSettingsFilePath() });
  } catch (error) {
    console.error('[session-assist] Failed to read settings; session assist keeps its defaults.', error);
    return null;
  }
}

// Warn once per distinct rejected value, keyed by a stable serialization:
// `readMergedSettingsSync` returns fresh objects for non-primitive values, so
// an identity check would re-warn on every turn. The latch resets after a
// valid read so a re-introduced misconfiguration surfaces again.
const warnedInvalidQuietMsKeys = new Set();

function warnKeyOf(value) {
  try {
    return `${typeof value}:${JSON.stringify(value)}`;
  } catch {
    return String(value);
  }
}

/** Read at every turn end so a settings change applies without a restart. */
export function readSessionAssistQuietMs() {
  const settings = readSettings();
  if (!settings) return undefined;
  const value = settings.sessionAssistIdleQuietMs;
  if (isSessionAssistIdleQuietMs(value)) {
    warnedInvalidQuietMsKeys.clear();
    return value;
  }
  if (value !== undefined) {
    const key = warnKeyOf(value);
    if (!warnedInvalidQuietMsKeys.has(key)) {
      warnedInvalidQuietMsKeys.add(key);
      console.warn(`Ignoring invalid sessionAssistIdleQuietMs value (expected an integer between ${MIN_IDLE_QUIET_MS} and ${MAX_IDLE_QUIET_MS}).`);
    }
  }
  return undefined;
}

/** Session recap/suggestion toggles; both default to enabled. */
export function readSessionAssistTargets() {
  const settings = readSettings();
  if (!settings) return { recap: true, suggestion: true };
  return {
    recap: settings.sessionRecapEnabled !== false,
    suggestion: settings.sessionSuggestionEnabled !== false,
  };
}
