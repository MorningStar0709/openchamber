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

  it('rejects textual OSS bodies instead of passing them off as audio', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => okTts())
      .mockImplementationOnce(async () => new Response('<html>nope</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(bailianProvider.synth({ text: 'x', voice: 'Cherry', apiKey: 'dk-key' }))
      .rejects.toThrow(/non-audio/);
    vi.unstubAllGlobals();
  });

  it('enforces https for the TTS endpoint', async () => {
    await expect(bailianProvider.synth({ text: 'x', voice: 'v', apiKey: 'k', baseURL: 'http://dashscope.aliyuncs.com' }))
      .rejects.toThrow(/https/);
  });

  it('derives the TTS endpoint from the base URL origin, so one setting serves both TTS and STT', async () => {
    const urls = [];
    vi.stubGlobal('fetch', vi.fn(async (u) => {
      const url = String(u);
      urls.push(url);
      if (url.endsWith('.wav')) {
        return new Response(Buffer.from('UklGRgAAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=', 'base64'), { status: 200, headers: { 'content-type': 'audio/wav' } });
      }
      return new Response(JSON.stringify({
        output: { audio: { url: 'https://oss.example/audio.wav' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    await bailianProvider.synth({
      text: 'x',
      voice: 'v',
      apiKey: 'k',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    expect(urls[0]).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
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

describe('delta 2 hardening', () => {
  it('refuses to follow redirects when downloading the audio result', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('multimodal-generation')) {
        return new Response(JSON.stringify({ output: { audio: { url: 'https://oss.example.com/a.wav' } } }), { status: 200 });
      }
      return new Response(Buffer.from('RIFF-x'), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await bailianProvider.synth({ text: 'x', voice: 'voice', apiKey: 'dk-key' });
    // First call is the TTS POST; the second is the OSS download.
    expect(fetchMock.mock.calls[1][1].redirect).toBe('error');
    vi.unstubAllGlobals();
  });

  it('wraps network failures with the provider label', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

    await expect(bailianProvider.synth({ text: 'x', voice: 'voice', apiKey: 'dk-key' }))
      .rejects.toThrow(/Bailian TTS/);
    vi.unstubAllGlobals();
  });

  it('enforces the size limit when content-length is missing', async () => {
    const chunk = new Uint8Array(20 * 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('multimodal-generation')) {
        return new Response(JSON.stringify({ output: { audio: { url: 'https://oss.example.com/a.wav' } } }), { status: 200 });
      }
      // A streamed body carries no content-length header.
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'audio/wav' } });
    }));

    await expect(bailianProvider.synth({ text: 'x', voice: 'voice', apiKey: 'dk-key' }))
      .rejects.toThrow(/size limit/i);
    vi.unstubAllGlobals();
  });

  it('rejects malformed base64 inline audio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output: { audio: { data: 'not!valid!base64!!!' } },
    }), { status: 200 })));

    await expect(bailianProvider.synth({ text: 'x', voice: 'voice', apiKey: 'dk-key' }))
      .rejects.toThrow(/audio/);
    vi.unstubAllGlobals();
  });
});

describe('bailianProvider (delta 3)', () => {
  it('builds the STT data URI from the sanitized audio subtype', async () => {
    let uri;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      uri = JSON.parse(init.body).messages[1].content[0].input_audio.data;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }));
    await bailianProvider.transcribe({
      audioBuffer: Buffer.from('RIFF'),
      mimeType: 'audio/webm;codecs=opus',
      model: 'm',
      apiKey: 'k',
    });
    expect(uri.startsWith('data:audio/webm;base64,')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('labels a missing response body instead of throwing a bare TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(bailianProvider.synth({ text: 'x', voice: 'v', apiKey: 'k' }))
      .rejects.toThrow(/Bailian TTS/);
    vi.unstubAllGlobals();
  });
});
