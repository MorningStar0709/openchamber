/**
 * Bailian (Aliyun DashScope) speech provider.
 *
 * Wire evidence 2026-11-02 (probed with a live DashScope key):
 * - TTS is NOT the Omni chat protocol and NOT /audio/speech: it is the
 *   multimodal-generation endpoint with the dedicated qwen3-tts-flash model.
 *   The response carries an OSS URL (output.audio.url) that must be fetched;
 *   `voice` is required.
 * - STT goes through the compatible-mode chat/completions endpoint with a
 *   qwen-omni model, but input_audio must be a `data:` URI (inline base64 is
 *   rejected) and a transcription instruction is required, otherwise the
 *   model answers the audio conversationally instead of transcribing it.
 */

import { assertAudioBuffer, assertHttpUrl, audioBufferFromBase64, audioFormatOf, contentTextOf, MAX_SPEECH_AUDIO_BYTES, requireSpeechCredentials } from './validate.js';

const TTS_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const DEFAULT_ORIGIN = 'https://dashscope.aliyuncs.com';
const DEFAULT_STT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_TTS_MODEL = 'qwen3-tts-flash';
const DEFAULT_STT_MODEL = 'qwen3.5-omni-flash';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_AUDIO_DOWNLOAD_BYTES = MAX_SPEECH_AUDIO_BYTES;
const TRANSCRIBE_INSTRUCTION = '请把用户消息中的音频转写为文字，只输出转写文本，不要回答问题。';

/** Fetch with network failures wrapped in a provider-labelled message. */
async function fetchChecked(url, init, label) {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new Error(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readJson(response, what) {
  // Only non-OK bodies tolerate a parse failure (plain-text error pages); a
  // successful response that is not JSON is a provider error, not an empty one.
  // Non-OK bodies are read through a bounded slice: a misbehaving gateway must
  // not be buffered whole into memory just to build an error message.
  if (!response.ok) {
    const raw = (await response.text()).slice(0, 4096);
    const data = JSON.parse(raw || '{}');
    throw new Error(data?.message || data?.error?.message || `${what} failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${what} returned a non-JSON response.`);
  }
}

/**
 * `baseURL` overrides the DashScope origin (e.g. an international endpoint).
 * The TTS endpoint hangs off the origin, never off a compatible-mode path, so
 * one setting serves both directions: `https://host/compatible-mode/v1` and
 * `https://host` both reach `https://host/api/v1/services/…/generation`.
 * Bailian is a cloud-only vendor — plain http would leak the bearer key, so
 * the scheme is enforced here (the MiMo escape hatch stays http-allowing).
 */
function ttsUrl(baseURL) {
  const normalized = assertHttpUrl(baseURL ?? DEFAULT_ORIGIN, 'Bailian base URL');
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'https:') {
    throw new Error('Bailian requires an https base URL (plain http would leak the API key).');
  }
  return `${parsed.origin}${TTS_PATH}`;
}

async function downloadAudio(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Bailian TTS returned an unusable audio URL.');
  }
  if (parsed.protocol !== 'https:') {
    // Only fetch URLs the API vouched for over TLS; never http:// or other schemes.
    throw new Error(`Bailian TTS audio URL must be https (got ${parsed.protocol}//…).`);
  }
  // redirect:'error' so a 302 cannot bounce the download off the https check
  // onto an http:// or internal address.
  const response = await fetchChecked(parsed, {
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'Bailian TTS audio download');
  if (!response.ok) {
    throw new Error(`Failed to fetch Bailian audio result (HTTP ${response.status}).`);
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_AUDIO_DOWNLOAD_BYTES) {
    throw new Error(`Bailian audio result exceeds the ${MAX_AUDIO_DOWNLOAD_BYTES / (1024 * 1024)}MB size limit.`);
  }
  if (!response.body) {
    throw new Error('Bailian TTS audio download returned an empty body.');
  }
  // Stream the body so a missing or forged content-length cannot bypass the cap.
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_AUDIO_DOWNLOAD_BYTES) {
        throw new Error(`Bailian audio result exceeds the ${MAX_AUDIO_DOWNLOAD_BYTES / (1024 * 1024)}MB size limit.`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buffer = Buffer.concat(chunks);
  // Only audio content types are served to the client. A textual body is an
  // error page (expired signature, gateway failure) — passing it off as WAV
  // would stream silence back as HTTP 200 — so textual types throw; an absent
  // or binary type falls back to the API's documented audio/wav.
  const served = (response.headers.get('content-type') ?? '').trim();
  if (/^(text\/|application\/(json|xml|javascript)|image\/)/i.test(served)) {
    throw new Error(`Bailian TTS audio download returned a non-audio body (${served || 'unknown content type'}).`);
  }
  const contentType = /^audio\//i.test(served) ? served : 'audio/wav';
  return { buffer, contentType };
}

/** @public */
export const bailianProvider = {
  id: 'bailian',
  label: 'Bailian (qwen3-tts + qwen-omni)',
  defaultTtsModel: DEFAULT_TTS_MODEL,

  async synth({ text, voice, model = DEFAULT_TTS_MODEL, apiKey, baseURL }) {
    const key = requireSpeechCredentials(apiKey, 'Bailian TTS');
    if (typeof voice !== 'string' || !voice.trim()) throw new Error('Bailian TTS requires a voice.');
    const response = await fetchChecked(ttsUrl(baseURL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        input: { text },
        parameters: { voice, format: 'wav' },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, 'Bailian TTS');
    const data = await readJson(response, 'Bailian TTS');
    const audio = data?.output?.audio;
    if (audio?.data) {
      return { buffer: audioBufferFromBase64(audio.data, 'Bailian TTS'), contentType: 'audio/wav' };
    }
    if (audio?.url) {
      return downloadAudio(audio.url);
    }
    throw new Error('Bailian TTS returned no audio.');
  },

  defaultSttModel: DEFAULT_STT_MODEL,

  async transcribe({ audioBuffer, mimeType = 'audio/wav', model = DEFAULT_STT_MODEL, apiKey, baseURL = DEFAULT_STT_BASE_URL }) {
    const key = requireSpeechCredentials(apiKey, 'Bailian STT');
    assertAudioBuffer(audioBuffer, 'Bailian STT');
    const format = audioFormatOf(mimeType);
    const dataUri = `data:audio/${format};base64,${audioBuffer.toString('base64')}`;
    const response = await fetchChecked(`${assertHttpUrl(baseURL, 'Bailian STT base URL')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: TRANSCRIBE_INSTRUCTION },
          { role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri, format } }] },
        ],
        modalities: ['audio', 'text'],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, 'Bailian STT');
    const data = await readJson(response, 'Bailian STT');
    const text = contentTextOf(data?.choices?.[0]?.message?.content);
    if (!text) throw new Error('Bailian STT returned no transcription text.');
    return text;
  },
};
