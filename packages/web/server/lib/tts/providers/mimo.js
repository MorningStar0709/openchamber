/**
 * MiMo speech provider (token-plan / Qwen-Omni line protocol).
 *
 * Wire evidence 2026-11-02 (probed against token-plan-cn.xiaomimimo.com):
 * - TTS and STT both go through POST {baseURL}/chat/completions, not the
 *   OpenAI Audio API; `/v1/audio/speech` does not exist on this gateway.
 * - TTS speaks the *assistant* message content: a lone user message is
 *   rejected ("messages must contain an assistant role for TTS model") and
 *   an instruction-style assistant message gets spoken instead of the text.
 * - TTS returns a base64 WAV in choices[0].message.audio.data; `speed` and
 *   `response_format` mean nothing here.
 * - STT takes inline base64 in input_audio (no data: URI) and returns the
 *   transcription as plain message content; no instruction message needed.
 */

import { assertAudioBuffer, assertHttpUrl, audioBufferFromBase64, audioFormatOf, contentTextOf, requireSpeechCredentials } from './validate.js';

const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_TTS_MODEL = 'mimo-v2.5-tts';
const DEFAULT_STT_MODEL = 'mimo-v2.5-asr';

function chatCompletionsUrl(baseURL) {
  return `${assertHttpUrl(baseURL, 'MiMo base URL')}/chat/completions`;
}

function summarizeErrorBody(text) {
  const snippet = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return snippet ? ` — body: ${snippet}` : '';
}

async function postChatCompletions({ baseURL, apiKey, body, label }) {
  let response;
  try {
    response = await fetch(chatCompletionsUrl(baseURL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const data = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    const message = data?.error?.message || data?.message;
    throw new Error(message
      ? `${label} failed with HTTP ${response.status}: ${message}`
      : `${label} failed with HTTP ${response.status}${summarizeErrorBody(raw)}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned an unparseable JSON response.`);
  }
}

/** @public */
export const mimoProvider = {
  id: 'mimo',
  label: 'MiMo (Qwen-Omni chat/completions)',
  defaultTtsModel: DEFAULT_TTS_MODEL,

  async synth({ text, voice, model = DEFAULT_TTS_MODEL, apiKey, baseURL }) {
    requireSpeechCredentials(apiKey, 'MiMo TTS');
    if (!baseURL) throw new Error('MiMo TTS requires a custom server URL.');
    const data = await postChatCompletions({
      baseURL,
      apiKey,
      label: 'MiMo TTS',
      body: {
        model,
        messages: [{ role: 'assistant', content: text }],
        modalities: ['text', 'audio'],
        // MiMo speaks the assistant message; an instruction-style assistant
        // message would be read aloud instead of the text (2026-11-02 probe).
        audio: { voice: voice ?? 'mimo_default', format: 'wav' },
      },
    });
    const audio = data?.choices?.[0]?.message?.audio;
    if (!audio?.data) throw new Error('MiMo TTS returned no audio.');
    const format = typeof audio.format === 'string' && /^[a-z0-9.+-]+$/.test(audio.format) ? audio.format : 'wav';
    return {
      buffer: audioBufferFromBase64(audio.data, 'MiMo TTS'),
      contentType: `audio/${format}`,
    };
  },

  defaultSttModel: DEFAULT_STT_MODEL,

  async transcribe({ audioBuffer, mimeType = 'audio/wav', model = DEFAULT_STT_MODEL, apiKey, baseURL }) {
    requireSpeechCredentials(apiKey, 'MiMo STT');
    if (!baseURL) throw new Error('MiMo STT requires a custom server URL.');
    assertAudioBuffer(audioBuffer, 'MiMo STT');
    const data = await postChatCompletions({
      baseURL,
      apiKey,
      label: 'MiMo STT',
      body: {
        model,
        messages: [{
          role: 'user',
          content: [{ type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format: audioFormatOf(mimeType) } }],
        }],
        modalities: ['audio', 'text'],
      },
    });
    const text = contentTextOf(data?.choices?.[0]?.message?.content);
    if (!text) throw new Error('MiMo STT returned no transcription text.');
    return text;
  },
};
