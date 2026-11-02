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

describe('mimo provider hardening (delta 1)', () => {
  it('defaults the voice to mimo_default when the client sends none', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { audio: { data: Buffer.from('RIFF-x').toString('base64') } } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await mimoProvider.synth({
      text: 'x',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.audio.voice).toBe('mimo_default');
    vi.unstubAllGlobals();
  });

  it('declares the audio format matching the incoming mimeType', async () => {
    const audio = Buffer.from('fake-webm-bytes');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await mimoProvider.transcribe({
      audioBuffer: audio,
      mimeType: 'audio/webm;codecs=opus',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content[0].input_audio.format).toBe('webm');
    vi.unstubAllGlobals();
  });

  it('rejects a missing audio buffer with a clear message', async () => {
    await expect(mimoProvider.transcribe({
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    })).rejects.toThrow('audio');
  });

  it('rejects non-http(s) base URLs before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(mimoProvider.synth({
      text: 'x',
      apiKey: 'tp-key',
      baseURL: 'ftp://example.com/v1',
    })).rejects.toThrow(/https?/);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('includes an upstream snippet when the gateway answers non-JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));

    await expect(mimoProvider.synth({
      text: 'x',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    })).rejects.toThrow(/HTTP 502/);
    vi.unstubAllGlobals();
  });
});

describe('delta 2 hardening', () => {
  it('wraps network failures with the provider label', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

    await expect(mimoProvider.synth({
      text: 'x',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    })).rejects.toThrow(/MiMo TTS/);
    vi.unstubAllGlobals();
  });

  it('fails clearly when a success response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));

    await expect(mimoProvider.synth({
      text: 'x',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    })).rejects.toThrow(/MiMo TTS.*(JSON|json|parse)/);
    vi.unstubAllGlobals();
  });

  it('keeps the HTTP status when the gateway returns a JSON error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'boom' } }),
      { status: 502 },
    )));

    await expect(mimoProvider.synth({
      text: 'x',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    })).rejects.toThrow(/502/);
    vi.unstubAllGlobals();
  });

  it('rejects malformed base64 audio payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { audio: { data: 'not!valid!base64!!!' } } }],
    }), { status: 200 })));

    await expect(mimoProvider.synth({
      text: 'x',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    })).rejects.toThrow(/audio/);
    vi.unstubAllGlobals();
  });

  it('honors the audio format reported by the gateway', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { audio: { data: Buffer.from('ID3-x').toString('base64'), format: 'mp3' } } }],
    }), { status: 200 })));

    const result = await mimoProvider.synth({
      text: 'x',
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    });
    expect(result.contentType).toBe('audio/mp3');
    vi.unstubAllGlobals();
  });

  it('normalizes array-shaped STT content to text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: 'text', text: '你好' }] } }],
    }), { status: 200 })));

    const text = await mimoProvider.transcribe({
      audioBuffer: Buffer.from('fake'),
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    });
    expect(text).toBe('你好');
    vi.unstubAllGlobals();
  });

  it('throws when the STT response carries no usable text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '' } }],
    }), { status: 200 })));

    await expect(mimoProvider.transcribe({
      audioBuffer: Buffer.from('fake'),
      apiKey: 'tp-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    })).rejects.toThrow(/transcri/i);
    vi.unstubAllGlobals();
  });
});

