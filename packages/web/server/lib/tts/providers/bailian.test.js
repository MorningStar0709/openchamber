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

describe('bailian provider hardening (delta 1)', () => {
  const okTts = () => new Response(JSON.stringify({
    output: { audio: { url: 'https://oss.example.com/audio.wav?sig=1' } },
  }), { status: 200 });

  it('honors a custom base URL for the TTS endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: { audio: { data: Buffer.from('RIFF-b').toString('base64') } },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await bailianProvider.synth({
      text: 'x',
      voice: 'Cherry',
      apiKey: 'dk-key',
      baseURL: 'https://dashscope-intl.example.com',
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://dashscope-intl.example.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    vi.unstubAllGlobals();
  });

  it('refuses non-https audio URLs from the API response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: { audio: { url: 'http://169.254.169.254/latest/meta-data/' } },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(bailianProvider.synth({
      text: 'x',
      voice: 'Cherry',
      apiKey: 'dk-key',
    })).rejects.toThrow(/https/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('caps the OSS audio download size', async () => {
    const fetchMock = vi.fn(async () => okTts());
    vi.stubGlobal('fetch', fetchMock);
    // Second call is the OSS download: huge content-length.
    fetchMock.mockImplementationOnce(async () => okTts());
    fetchMock.mockImplementationOnce(async () => new Response('x', {
      status: 200,
      headers: { 'content-length': String(40 * 1024 * 1024) },
    }));

    await expect(bailianProvider.synth({
      text: 'x',
      voice: 'Cherry',
      apiKey: 'dk-key',
    })).rejects.toThrow(/size/i);
    vi.unstubAllGlobals();
  });

  it('serves only audio content types from the OSS download', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => okTts())
      .mockImplementationOnce(async () => new Response('<html>nope</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await bailianProvider.synth({ text: 'x', voice: 'Cherry', apiKey: 'dk-key' });
    expect(result.contentType).toBe('audio/wav');
    vi.unstubAllGlobals();
  });

  it('normalizes array-shaped STT content to a string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: 'text', text: '你好世界' }] } }],
    }), { status: 200 })));

    const text = await bailianProvider.transcribe({
      audioBuffer: Buffer.from('fake'),
      apiKey: 'dk-key',
    });
    expect(text).toBe('你好世界');
    vi.unstubAllGlobals();
  });

  it('throws when the STT response carries no usable text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '' } }],
    }), { status: 200 })));

    await expect(bailianProvider.transcribe({
      audioBuffer: Buffer.from('fake'),
      apiKey: 'dk-key',
    })).rejects.toThrow(/transcri/i);
    vi.unstubAllGlobals();
  });

  it('rejects a missing audio buffer with a clear message', async () => {
    await expect(bailianProvider.transcribe({ apiKey: 'dk-key' })).rejects.toThrow('audio');
  });
});
