import fs from 'fs';
import path from 'path';

import { getOpenChamberSettingsFilePath, readMergedSettingsSync } from '../opencode/settings-files.js';

/** Default quiet window; mirrors IDLE_QUIET_MS in runtime.js. */
export const DEFAULT_IDLE_QUIET_MS = 60_000;
export const MIN_IDLE_QUIET_MS = 1_000;
export const MAX_IDLE_QUIET_MS = 3_600_000;

// Same bounds as packages/ui/src/lib/sessionAssistQuietMs.ts; the server
// cannot import the TS source, so keep the constants in sync.
export function isSessionAssistIdleQuietMs(value) {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_IDLE_QUIET_MS && value <= MAX_IDLE_QUIET_MS;
}

/** Read at every turn end so a settings change applies without a restart. */
export function readSessionAssistQuietMs() {
  let settings;
  try {
    settings = readMergedSettingsSync({ fs, path, settingsFilePath: getOpenChamberSettingsFilePath() });
  } catch {
    return undefined;
  }
  const value = settings.sessionAssistIdleQuietMs;
  if (isSessionAssistIdleQuietMs(value)) return value;
  if (value !== undefined) {
    console.warn(`Ignoring invalid sessionAssistIdleQuietMs value (expected an integer between ${MIN_IDLE_QUIET_MS} and ${MAX_IDLE_QUIET_MS}).`);
  }
  return undefined;
}
