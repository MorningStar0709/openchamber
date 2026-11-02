import { describe, expect, it, vi } from 'vitest';

import { bailianProvider } from './bailian.js';

describe('bailian speech provider', () => {
  it('synthesizes via multimodal-generation and follows the OSS audio URL', async () => {
    const wavBytes = Buffer.from('RIFF-bailian-wav');
    const fetchMock = vi.fn(async (url, init) => {
      const target = String(url);
      if (target === 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation') {
        const body = JSON.parse(init.body);
        expect(body).toEqual({
          model: 'qwen3-tts-flash',
          input: { text: '桥接器回归测试' },
          parameters: { voice: 'Cherry', format: 'wav' },
        });
        return new Response(JSON.stringify({
          output: { audio: { url: 'https://oss.example/audio.wav' } },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (target === 'https://oss.example/audio.wav') {
        return new Response(wavBytes, { status: 200, headers: { 'content-type': 'audio/wav' } });
      }
      throw new Error(`unexpected ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await bailianProvider.synth({
      text: '桥接器回归测试',
      voice: 'Cherry',
      model: 'qwen3-tts-flash',
      apiKey: 'sk-key',
    });

    expect(result.buffer.equals(wavBytes)).toBe(true);
    expect(result.contentType).toBe('audio/wav');
    vi.unstubAllGlobals();
  });

  it('requires a voice for synthesis', async () => {
    await expect(bailianProvider.synth({ text: 'x', apiKey: 'sk-key' }))
      .rejects.toThrow('voice');
  });

  it('transcribes via compatible-mode chat with a data URI and instruction', async () => {
    const audio = Buffer.from('fake-wav-bytes');
    const fetchMock = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('qwen3.5-omni-flash');
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1]).toEqual({
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,' + audio.toString('base64'), format: 'wav' } }],
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '嗯。' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const text = await bailianProvider.transcribe({
      audioBuffer: audio,
      mimeType: 'audio/wav',
      apiKey: 'sk-key',
    });

    expect(text).toBe('嗯。');
    vi.unstubAllGlobals();
  });
});
