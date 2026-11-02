/**
 * Default provider: the OpenAI Audio API (/v1/audio/speech, /audio/transcriptions),
 * including OpenAI-compatible servers addressed via a custom base URL.
 * This is the historical behavior, unchanged.
 */

import { ttsService } from '../service.js';
import { transcribeAudio } from '../stt.js';

const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
// STT default stays the historical route value: an OpenRouter-hosted
// whisper-large-v3 turbo, not an OpenAI transcription model.
const DEFAULT_STT_MODEL = 'deepdml/faster-whisper-large-v3-turbo-ct2';

/** @public */
export const openaiAudioProvider = {
  id: 'openai-audio',
  label: 'OpenAI Audio API',
  defaultTtsModel: DEFAULT_TTS_MODEL,
  defaultSttModel: DEFAULT_STT_MODEL,

  async synth(options = {}) {
    const opts = options ?? {};
    // 'nova' is the historical route default; routes pass no voice for the
    // default provider, so the effective default stays exactly as before.
    return ttsService.generateSpeechStream({ ...opts, voice: opts.voice ?? 'nova' });
  },

  async transcribe(options = {}) {
    return transcribeAudio(options ?? {});
  },
};
