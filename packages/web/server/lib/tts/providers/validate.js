/**
 * Shared input validation for speech providers.
 *
 * Every provider validates its caller-facing inputs (API key, server URL,
 * audio bytes) before touching the network, so misconfiguration fails fast
 * with an actionable message instead of an obscure fetch or parse error.
 */

/** Hard ceiling for a single speech payload (upload or download). */
export const MAX_SPEECH_AUDIO_BYTES = 32 * 1024 * 1024;

/**
 * Ensure `value` is an http(s) URL string; throws a clear error otherwise.
 * Returns the URL normalized (no trailing slash, no query, no fragment) so
 * providers can safely append their own path segments. Note the check is
 * deliberately scheme-level only: custom gateways on plain http (including
 * LAN adapters such as http://100.64.0.4:8390) are a supported setup, so
 * this is not a full SSRF guard.
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
  if (url.search) {
    throw new Error(`${what} must not carry a query string.`);
  }
  if (url.hash) {
    throw new Error(`${what} must not carry a fragment.`);
  }
  const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  return normalized || url.origin;
}

/**
 * Ensure `buffer` is a non-empty audio payload within the size ceiling,
 * before any base64 amplification or network call.
 */
export function assertAudioBuffer(buffer, what, maxBytes = MAX_SPEECH_AUDIO_BYTES) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error(`${what} requires a non-empty audio buffer.`);
  }
  if (buffer.length > maxBytes) {
    throw new Error(`${what} audio exceeds the ${maxBytes / (1024 * 1024)}MB size limit.`);
  }
  return buffer;
}

/**
 * Decode a base64 audio payload from a provider response, rejecting malformed
 * input and oversized results instead of silently returning garbage.
 */
export function audioBufferFromBase64(data, what, maxBytes = MAX_SPEECH_AUDIO_BYTES) {
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(data)) {
    throw new Error(`${what} returned malformed audio data.`);
  }
  const buffer = Buffer.from(data, 'base64');
  if (buffer.length === 0) {
    throw new Error(`${what} returned empty audio.`);
  }
  if (buffer.length > maxBytes) {
    throw new Error(`${what} audio exceeds the ${maxBytes / (1024 * 1024)}MB size limit.`);
  }
  return buffer;
}

/**
 * Both non-default providers require a caller-supplied API key.
 */
export function requireSpeechCredentials(apiKey, label) {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error(`${label} requires an API key (Voice settings).`);
  }
}

/**
 * Derive the wire-format audio subtype from a MIME type, stripping any
 * `;codecs=…` parameters, e.g. `audio/webm;codecs=opus` -> `webm`.
 * Anything outside a conservative token alphabet falls back to `fallback`.
 */
export function audioFormatOf(mimeType, fallback = 'wav') {
  if (typeof mimeType !== 'string') return fallback;
  const match = /^audio\/([a-z0-9][a-z0-9.+-]*)/i.exec(mimeType.trim());
  return match ? match[1].toLowerCase() : fallback;
}

/** Reduce an Omni-style chat message content (string | content-block[]) to text. */
export function contentTextOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  return '';
}
