import fs from 'fs';
import os from 'os';
import path from 'path';

import { readMergedSettingsSync } from '../opencode/settings-files.js';

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

const OPENCHAMBER_SETTINGS_FILE = path.join(
  process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber'),
  'settings.json',
);

/** Read at every turn end so a settings change applies without a restart. */
export function readSessionAssistQuietMs() {
  const settings = readMergedSettingsSync({ fs, path, settingsFilePath: OPENCHAMBER_SETTINGS_FILE });
  return isSessionAssistIdleQuietMs(settings.sessionAssistIdleQuietMs)
    ? settings.sessionAssistIdleQuietMs
    : undefined;
}
