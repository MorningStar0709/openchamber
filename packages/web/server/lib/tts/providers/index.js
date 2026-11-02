/**
 * Speech provider registry. A provider implements the wire protocol of one
 * speech backend family. The full shape is:
 *
 *   id: string                        — stable registry key ('openai-audio' default)
 *   label: string                     — display name
 *   defaultTtsModel: string           — used when the request names no model
 *   defaultSttModel: string           — used when the request names no model
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
export const SPEECH_PROVIDERS = Object.freeze([openaiAudioProvider, mimoProvider, bailianProvider]);

/** @public */
export function assertSpeechProvider(provider) {
  if (!provider || typeof provider.id !== 'string' || !provider.id) {
    throw new Error('tts/providers: every provider must export a non-empty string id.');
  }
  if (typeof provider.label !== 'string' || !provider.label) {
    throw new Error(`tts/providers: provider "${provider.id}" must export a non-empty label.`);
  }
  for (const field of ['defaultTtsModel', 'defaultSttModel']) {
    if (typeof provider[field] !== 'string' || !provider[field]) {
      throw new Error(`tts/providers: provider "${provider.id}" must export a non-empty ${field}.`);
    }
  }
  for (const method of ['synth', 'transcribe']) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`tts/providers: provider "${provider.id}" must implement ${method}().`);
    }
  }
  return provider;
}

// Fail fast at load time on a malformed registry rather than silently
// dispatching to a half-registered provider at request time.
const seenProviderIds = new Set();
for (const provider of SPEECH_PROVIDERS) {
  assertSpeechProvider(provider);
  if (seenProviderIds.has(provider.id)) {
    throw new Error(`tts/providers: duplicate provider id "${provider.id}".`);
  }
  seenProviderIds.add(provider.id);
}

const PROVIDERS_BY_ID = new Map(SPEECH_PROVIDERS.map((provider) => [provider.id, provider]));
export const DEFAULT_SPEECH_PROVIDER_ID = openaiAudioProvider.id;

/** @public */
export function resolveSpeechProvider(id) {
  return PROVIDERS_BY_ID.get(id) ?? PROVIDERS_BY_ID.get(DEFAULT_SPEECH_PROVIDER_ID);
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
