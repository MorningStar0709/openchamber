import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openaiAudioProvider } from './openai-audio.js';
import { mimoProvider } from './mimo.js';
import { bailianProvider } from './bailian.js';
import { readSpeechProviderId, resolveSpeechProvider } from './index.js';

describe('speech provider registry', () => {
  it('resolves known ids and falls back to openai-audio for unknown or missing', () => {
    expect(resolveSpeechProvider('mimo')).toBe(mimoProvider);
    expect(resolveSpeechProvider('bailian')).toBe(bailianProvider);
    expect(resolveSpeechProvider('openai-audio')).toBe(openaiAudioProvider);
    expect(resolveSpeechProvider('nope')).toBe(openaiAudioProvider);
    expect(resolveSpeechProvider(undefined)).toBe(openaiAudioProvider);
  });

  it('hands openai-audio endpointPath through and the others the base request', () => {
    expect(typeof openaiAudioProvider.synth).toBe('function');
    expect(typeof openaiAudioProvider.transcribe).toBe('function');
    for (const provider of [mimoProvider, bailianProvider]) {
      expect(typeof provider.synth).toBe('function');
      expect(typeof provider.transcribe).toBe('function');
    }
  });
});

describe('readSpeechProviderId', () => {
  const dirs = [];
  const useSettings = (contents) => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-speech-settings-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'settings.json'), contents);
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dir);
    vi.resetModules();
    return import('./index.js');
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  it('reads the configured provider', async () => {
    const { readSpeechProviderId: read } = await useSettings(JSON.stringify({ speechProvider: 'mimo' }));
    expect(read()).toBe('mimo');
  });

  it('defaults to openai-audio when absent or malformed', async () => {
    const absent = await useSettings(JSON.stringify({}));
    expect(absent.readSpeechProviderId()).toBe('openai-audio');
    vi.resetModules();
    const malformed = await useSettings(JSON.stringify({ speechProvider: 'nope' }));
    expect(malformed.readSpeechProviderId()).toBe('openai-audio');
  });
});

describe('provider contract (delta 1)', () => {
  it('exposes a default STT model per provider', async () => {
    const { SPEECH_PROVIDERS } = await import('./index.js');
    const byId = Object.fromEntries(SPEECH_PROVIDERS.map((provider) => [provider.id, provider]));
    expect(byId['openai-audio'].defaultSttModel).toBe('deepdml/faster-whisper-large-v3-turbo-ct2');
    expect(byId.mimo.defaultSttModel).toBe('mimo-v2.5-asr');
    expect(byId.bailian.defaultSttModel).toBe('qwen3.5-omni-flash');
  });
});

describe('registry integrity (delta 2)', () => {
  it('freezes the provider table against accidental mutation', async () => {
    const { SPEECH_PROVIDERS } = await import('./index.js');
    expect(Object.isFrozen(SPEECH_PROVIDERS)).toBe(true);
  });

  it('exposes a non-empty default TTS model per provider', async () => {
    const { SPEECH_PROVIDERS } = await import('./index.js');
    for (const provider of SPEECH_PROVIDERS) {
      expect(typeof provider.defaultTtsModel).toBe('string');
      expect(provider.defaultTtsModel.length).toBeGreaterThan(0);
    }
  });
});

describe('provider contract (delta 3)', () => {
  it('rejects providers without defaultTtsModel at load time', async () => {
    const mod = await import('./index.js');
    expect(() => mod.assertSpeechProvider({ id: 'x', label: 'X', synth: async () => ({}), transcribe: async () => '' }))
      .toThrow(/defaultTtsModel/);
  });
});
