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

import { assertAudioBuffer, assertHttpUrl, audioFormatOf, requireSpeechCredentials } from './validate.js';

const TTS_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const DEFAULT_ORIGIN = 'https://dashscope.aliyuncs.com';
const DEFAULT_STT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_STT_MODEL = 'qwen3.5-omni-flash';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_AUDIO_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const TRANSCRIBE_INSTRUCTION = '请把用户消息中的音频转写为文字，只输出转写文本，不要回答问题。';

async function readJson(response, what) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error?.message || `${what} failed with HTTP ${response.status}`);
  }
  return data;
}

/** `baseURL` overrides the DashScope origin (e.g. an international endpoint). */
function ttsUrl(baseURL) {
  return `${assertHttpUrl(baseURL ?? DEFAULT_ORIGIN, 'Bailian base URL')}${TTS_PATH}`;
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
  const response = await fetch(parsed, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Failed to fetch Bailian audio result (HTTP ${response.status}).`);
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_AUDIO_DOWNLOAD_BYTES) {
    throw new Error(`Bailian audio result exceeds the ${MAX_AUDIO_DOWNLOAD_BYTES / (1024 * 1024)}MB size limit.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_AUDIO_DOWNLOAD_BYTES) {
    throw new Error(`Bailian audio result exceeds the ${MAX_AUDIO_DOWNLOAD_BYTES / (1024 * 1024)}MB size limit.`);
  }
  // Only audio content types are served to the client; anything else is
  // treated as a mislabeled WAV (the API is expected to return audio/wav).
  const served = response.headers.get('content-type') ?? '';
  const contentType = /^audio\//i.test(served.trim()) ? served.trim() : 'audio/wav';
  return { buffer, contentType };
}

/** Reduce an Omni chat message content (string | content-block[]) to text. */
function contentTextOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  return '';
}

/** @public */
export const bailianProvider = {
  id: 'bailian',
  label: 'Bailian (qwen3-tts + qwen-omni)',

  async synth({ text, voice, model = 'qwen3-tts-flash', apiKey, baseURL }) {
    requireSpeechCredentials(apiKey, 'Bailian TTS');
    if (!voice) throw new Error('Bailian TTS requires a voice.');
    const response = await fetch(ttsUrl(baseURL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: { text },
        parameters: { voice, format: 'wav' },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await readJson(response, 'Bailian TTS');
    const audio = data?.output?.audio;
    if (audio?.data) {
      return { buffer: Buffer.from(audio.data, 'base64'), contentType: 'audio/wav' };
    }
    if (audio?.url) {
      return downloadAudio(audio.url);
    }
    throw new Error('Bailian TTS returned no audio.');
  },

  defaultSttModel: DEFAULT_STT_MODEL,

  async transcribe({ audioBuffer, mimeType = 'audio/wav', model = DEFAULT_STT_MODEL, apiKey, baseURL = DEFAULT_STT_BASE_URL }) {
    requireSpeechCredentials(apiKey, 'Bailian STT');
    assertAudioBuffer(audioBuffer, 'Bailian STT');
    const format = audioFormatOf(mimeType);
    const dataUri = `data:${mimeType};base64,${audioBuffer.toString('base64')}`;
    const response = await fetch(`${assertHttpUrl(baseURL, 'Bailian STT base URL')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
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
    });
    const data = await readJson(response, 'Bailian STT');
    const text = contentTextOf(data?.choices?.[0]?.message?.content);
    if (!text) throw new Error('Bailian STT returned no transcription text.');
    return text;
  },
};
