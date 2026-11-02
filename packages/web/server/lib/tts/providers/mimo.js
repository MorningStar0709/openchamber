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

const REQUEST_TIMEOUT_MS = 120_000;

function chatCompletionsUrl(baseURL) {
  return `${String(baseURL).replace(/\/+$/, '')}/chat/completions`;
}

async function postChatCompletions({ baseURL, apiKey, body }) {
  const response = await fetch(chatCompletionsUrl(baseURL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `MiMo request failed with HTTP ${response.status}`);
  }
  return data;
}

/** @public */
export const mimoProvider = {
  id: 'mimo',
  label: 'MiMo (Qwen-Omni chat/completions)',

  async synth({ text, voice, model = 'mimo-v2.5-tts', apiKey, baseURL }) {
    if (!apiKey) throw new Error('MiMo TTS requires an API key (Voice settings).');
    if (!baseURL) throw new Error('MiMo TTS requires a custom server URL.');
    const data = await postChatCompletions({
      baseURL,
      apiKey,
      body: {
        model,
        messages: [{ role: 'assistant', content: text }],
        modalities: ['text', 'audio'],
        audio: { ...(voice ? { voice } : {}), format: 'wav' },
      },
    });
    const audioData = data?.choices?.[0]?.message?.audio?.data;
    if (!audioData) throw new Error('MiMo TTS returned no audio.');
    return {
      buffer: Buffer.from(audioData, 'base64'),
      contentType: 'audio/wav',
    };
  },

  async transcribe({ audioBuffer, model = 'mimo-v2.5-asr', apiKey, baseURL }) {
    if (!apiKey) throw new Error('MiMo STT requires an API key (Voice settings).');
    if (!baseURL) throw new Error('MiMo STT requires a custom server URL.');
    const data = await postChatCompletions({
      baseURL,
      apiKey,
      body: {
        model,
        messages: [{
          role: 'user',
          content: [{ type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format: 'wav' } }],
        }],
        modalities: ['audio', 'text'],
      },
    });
    return data?.choices?.[0]?.message?.content ?? '';
  },
};
