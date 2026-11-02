/**
 * Default provider: the OpenAI Audio API (/v1/audio/speech, /audio/transcriptions),
 * including OpenAI-compatible servers addressed via a custom base URL.
 * This is the historical behavior, unchanged.
 */

import { ttsService } from '../service.js';
import { transcribeAudio } from '../stt.js';

/** @public */
export const openaiAudioProvider = {
  id: 'openai-audio',
  label: 'OpenAI Audio API',

  async synth(options) {
    return ttsService.generateSpeechStream(options);
  },

  async transcribe(options) {
    return transcribeAudio(options);
  },
};
