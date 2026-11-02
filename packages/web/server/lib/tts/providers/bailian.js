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

const TTS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const DEFAULT_STT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const REQUEST_TIMEOUT_MS = 120_000;
const TRANSCRIBE_INSTRUCTION = '请把用户消息中的音频转写为文字，只输出转写文本，不要回答问题。';

async function readJson(response, what) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error?.message || `${what} failed with HTTP ${response.status}`);
  }
  return data;
}

/** @public */
export const bailianProvider = {
  id: 'bailian',
  label: 'Bailian (qwen3-tts + qwen-omni)',

  async synth({ text, voice, model = 'qwen3-tts-flash', apiKey }) {
    if (!apiKey) throw new Error('Bailian TTS requires an API key (Voice settings).');
    if (!voice) throw new Error('Bailian TTS requires a voice.');
    const response = await fetch(TTS_URL, {
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
      const audioResponse = await fetch(audio.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!audioResponse.ok) {
        throw new Error(`Failed to fetch Bailian audio result (HTTP ${audioResponse.status}).`);
      }
      return {
        buffer: Buffer.from(await audioResponse.arrayBuffer()),
        contentType: audioResponse.headers.get('content-type') ?? 'audio/wav',
      };
    }
    throw new Error('Bailian TTS returned no audio.');
  },

  async transcribe({ audioBuffer, mimeType = 'audio/wav', model = 'qwen3.5-omni-flash', apiKey, baseURL = DEFAULT_STT_BASE_URL }) {
    if (!apiKey) throw new Error('Bailian STT requires an API key (Voice settings).');
    const dataUri = `data:${mimeType};base64,${audioBuffer.toString('base64')}`;
    const response = await fetch(`${String(baseURL).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: TRANSCRIBE_INSTRUCTION },
          { role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri, format: 'wav' } }] },
        ],
        modalities: ['audio', 'text'],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await readJson(response, 'Bailian STT');
    return data?.choices?.[0]?.message?.content ?? '';
  },
};
