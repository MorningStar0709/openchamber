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
import os from 'node:os';
import path from 'node:path';

import { readMergedSettingsSync } from '../../opencode/settings-files.js';

import { openaiAudioProvider } from './openai-audio.js';
import { mimoProvider } from './mimo.js';
import { bailianProvider } from './bailian.js';

/** @public */
export const SPEECH_PROVIDERS = [openaiAudioProvider, mimoProvider, bailianProvider];

const PROVIDERS_BY_ID = new Map(SPEECH_PROVIDERS.map((provider) => [provider.id, provider]));
export const DEFAULT_SPEECH_PROVIDER_ID = openaiAudioProvider.id;

/** @public */
export function resolveSpeechProvider(id) {
  return PROVIDERS_BY_ID.get(id) ?? openaiAudioProvider;
}

const OPENCHAMBER_SETTINGS_FILE = path.join(
  process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber'),
  'settings.json',
);

/** @public */
export function readSpeechProviderId() {
  const settings = readMergedSettingsSync({ fs, path, settingsFilePath: OPENCHAMBER_SETTINGS_FILE });
  return PROVIDERS_BY_ID.has(settings.speechProvider)
    ? settings.speechProvider
    : DEFAULT_SPEECH_PROVIDER_ID;
}
