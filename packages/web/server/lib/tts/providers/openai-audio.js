/**
 * Default provider: the OpenAI Audio API (/v1/audio/speech, /audio/transcriptions),
 * including OpenAI-compatible servers addressed via a custom base URL.
 * This is the historical behavior, unchanged.
 */

import { ttsService } from '../service.js';
import { transcribeAudio } from '../stt.js';

const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';

/** @public */
export const openaiAudioProvider = {
  id: 'openai-audio',
  label: 'OpenAI Audio API',
  defaultTtsModel: DEFAULT_TTS_MODEL,
  // The historical route default; the routes pass no voice for the default
  // provider, so the OpenAI default stays 'nova' exactly as before.
  defaultSttModel: 'deepdml/faster-whisper-large-v3-turbo-ct2',

  async synth(options = {}) {
    return ttsService.generateSpeechStream({ ...options, voice: options.voice ?? 'nova' });
  },

  async transcribe(options) {
    return transcribeAudio(options);
  },
};
