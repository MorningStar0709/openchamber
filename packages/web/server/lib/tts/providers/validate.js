/**
 * Shared input validation for speech providers.
 *
 * Every provider validates its caller-facing inputs (API key, server URL,
 * audio bytes) before touching the network, so misconfiguration fails fast
 * with an actionable message instead of an obscure fetch or parse error.
 */

/**
 * Ensure `value` is an http(s) URL string; throws a clear error otherwise.
 * Prevents accidental fetches against file:, ftp:, or metadata endpoints when
 * a user-supplied base URL slips past the settings layer.
 */
export function assertHttpUrl(value, what) {
  if (typeof value !== 'string') {
    throw new Error(`${what} must be a URL.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${what} must be a URL (got ${JSON.stringify(value)}).`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${what} must be an http(s) URL (got ${url.protocol}//…).`);
  }
  return value.replace(/\/+$/, '');
}

/**
 * Ensure `buffer` is a non-empty audio payload to transcribe.
 */
export function assertAudioBuffer(buffer, what) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error(`${what} requires a non-empty audio buffer.`);
  }
  return buffer;
}

/**
 * Both non-default providers require a caller-supplied API key.
 */
export function requireSpeechCredentials(apiKey, label) {
  if (!apiKey) {
    throw new Error(`${label} requires an API key (Voice settings).`);
  }
}

/**
 * Derive the wire-format audio subtype from a MIME type, stripping any
 * `;codecs=…` parameters, e.g. `audio/webm;codecs=opus` -> `webm`.
 */
export function audioFormatOf(mimeType, fallback = 'wav') {
  if (typeof mimeType !== 'string') return fallback;
  const match = /^audio\/([^;\s]+)/i.exec(mimeType.trim());
  return match ? match[1].toLowerCase() : fallback;
}
