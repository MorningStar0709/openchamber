import { describe, expect, it, vi } from 'vitest';

import { mimoProvider } from './mimo.js';

const TTS_BODY = { said: '桥接器回归测试' };

describe('mimo speech provider', () => {
  it('sends the text as the assistant message and decodes the base64 WAV', async () => {
    const wavBytes = Buffer.from('RIFF-mimo-wav');
    const fetchMock = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://token-plan-cn.xiaomimimo.com/v1/chat/completions');
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        model: 'mimo-v2.5-tts',
        messages: [{ role: 'assistant', content: '桥接器回归测试' }],
        modalities: ['text', 'audio'],
        audio: { voice: 'mimo_default', format: 'wav' },
      });
      expect(init.headers.authorization).toBe('Bearer tp-key');
      return new Response(JSON.stringify({
        choices: [{ message: { audio: { data: wavBytes.toString('base64'), format: 'wav' } } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await mimoProvider.synth({
      text: '桥接器回归测试',
      voice: 'mimo_default',
      model: 'mimo-v2.5-tts',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1/',
    });

    expect(result.buffer.equals(wavBytes)).toBe(true);
    expect(result.contentType).toBe('audio/wav');
    vi.unstubAllGlobals();
  });

  it('surfaces upstream errors with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'messages must contain an assistant role for TTS model' },
    }), { status: 400, headers: { 'content-type': 'application/json' } })));

    await expect(mimoProvider.synth({
      text: 'x',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    })).rejects.toThrow('messages must contain an assistant role');
    vi.unstubAllGlobals();
  });

  it('transcribes via input_audio with inline base64 and returns plain text', async () => {
    const audio = Buffer.from('fake-wav-bytes');
    const fetchMock = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      expect(body.model).toBe('mimo-v2.5-asr');
      expect(body.modalities).toEqual(['audio', 'text']);
      expect(body.messages).toEqual([{
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: audio.toString('base64'), format: 'wav' } }],
      }]);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '转写结果文本' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const text = await mimoProvider.transcribe({
      audioBuffer: audio,
      mimeType: 'audio/wav',
      model: 'mimo-v2.5-asr',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    });

    expect(text).toBe('转写结果文本');
    vi.unstubAllGlobals();
  });

  it('refuses to synthesize without an API key', async () => {
    await expect(mimoProvider.synth({ text: 'x', baseURL: 'https://x/v1' }))
      .rejects.toThrow('API key');
  });
});
