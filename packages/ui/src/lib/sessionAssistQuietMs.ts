/**
 * Quiet period after a turn ends before session assist generates. The
 * server applies the same bounds (`session-assist/settings.js`).
 */
export const SESSION_ASSIST_DEFAULT_IDLE_QUIET_MS = 60_000;
export const SESSION_ASSIST_MIN_IDLE_QUIET_MS = 1_000;
export const SESSION_ASSIST_MAX_IDLE_QUIET_MS = 3_600_000;

export const isSessionAssistIdleQuietMs = (value: number): boolean => (
  Number.isInteger(value) && value >= SESSION_ASSIST_MIN_IDLE_QUIET_MS && value <= SESSION_ASSIST_MAX_IDLE_QUIET_MS
);
