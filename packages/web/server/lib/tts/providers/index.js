/**
 * Speech provider registry. A provider implements the wire protocol of one
 * speech backend family behind two duck-typed methods:
 *
 *   synth({ text, voice, model, speed, instructions, apiKey, baseURL, endpointPath })
 *     -> { buffer: Buffer, contentType: string }
 *   transcribe({ audioBuffer, mimeType, model, apiKey, baseURL, language, endpointPath })
 *     -> string
 *
 * The default is `openai-audio` (historical behavior). The TTS/STT routes
 * resolve the provider per request from the `speechProvider` settings key,
 * so a change applies without a restart (session-work settings set the
 * precedent of reading settings at use time).
 */

import fs from 'node:fs';
import path from 'node:path';

import { getOpenChamberSettingsFilePath, readMergedSettingsSync } from '../../opencode/settings-files.js';

import { openaiAudioProvider } from './openai-audio.js';
import { mimoProvider } from './mimo.js';
import { bailianProvider } from './bailian.js';

/** @public */
export const SPEECH_PROVIDERS = [openaiAudioProvider, mimoProvider, bailianProvider];

// Fail fast at load time on a malformed registry rather than silently
// dispatching to a half-registered provider at request time.
for (const provider of SPEECH_PROVIDERS) {
  if (!provider || typeof provider.id !== 'string' || !provider.id) {
    throw new Error('tts/providers: every provider must export a non-empty string id.');
  }
  for (const method of ['synth', 'transcribe']) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`tts/providers: provider "${provider.id}" must implement ${method}().`);
    }
  }
}

const PROVIDERS_BY_ID = new Map(SPEECH_PROVIDERS.map((provider) => [provider.id, provider]));
export const DEFAULT_SPEECH_PROVIDER_ID = openaiAudioProvider.id;

/** @public */
export function resolveSpeechProvider(id) {
  return PROVIDERS_BY_ID.get(id) ?? openaiAudioProvider;
}

/** @public */
export function readSpeechProviderId() {
  // Resolved at call time: OPENCHAMBER_DATA_DIR may be re-pointed between
  // module load and use (tests do), and a load-bound path would read stale.
  const settings = readMergedSettingsSync({ fs, path, settingsFilePath: getOpenChamberSettingsFilePath() });
  return PROVIDERS_BY_ID.has(settings.speechProvider)
    ? settings.speechProvider
    : DEFAULT_SPEECH_PROVIDER_ID;
}
