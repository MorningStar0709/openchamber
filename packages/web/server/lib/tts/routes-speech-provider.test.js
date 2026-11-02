import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { registerTtsRoutes } from './routes.js';

describe('speech provider dispatch in routes', () => {
  let dataDir;

  // One directory for the whole file: providers/index.js binds the settings
  // path at module evaluation, which happens on the first request.
  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'oc-speech-provider-'));
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ speechProvider: 'mimo' }));
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dataDir);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const createApp = () => {
    const app = express();
    app.use(express.json());
    registerTtsRoutes(app, {});
    return app;
  };

  it('rejects TTS without a custom base URL when a non-default speech provider is selected', async () => {
    const response = await request(createApp())
      .post('/api/tts/speak')
      .send({ text: '你好', apiKey: 'tp-key', voice: 'mimo_default' });

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("'mimo'");
  });

  it('rejects STT without an API key when a non-default speech provider is selected', async () => {
    const response = await request(createApp())
      .post('/api/stt/transcribe')
      .set('x-base-url', 'https://token-plan-cn.xiaomimimo.com/v1')
      .set('content-type', 'audio/wav')
      .send(Buffer.from('RIFF-fake-wav'));

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("'mimo'");
  });

  it('keeps the default provider path untouched (no provider guard in the way)', async () => {
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ speechProvider: 'openai-audio' }));
    const response = await request(createApp())
      .post('/api/tts/speak')
      .send({ text: '你好', apiKey: 'sk-test' });

    expect(response.status).not.toBe(503);
  });
});

describe('voice passthrough (delta 1)', () => {
  it('lets the mimo provider pick its default voice when the client sends none', async () => {
    process.env.OPENCHAMBER_DATA_DIR = mkdtempSync(join(tmpdir(), 'oc-tts-route-voice-'));
    writeFileSync(join(process.env.OPENCHAMBER_DATA_DIR, 'settings.json'), JSON.stringify({ speechProvider: 'mimo' }));

    const bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from('RIFF-x').toString('base64') } } }],
      }), { status: 200 });
    }));

    const app = express();
    app.use(express.json());
    registerTtsRoutes(app, {});

    const response = await request(app)
      .post('/api/tts/speak')
      .send({ text: '你好', apiKey: 'tp-key', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1' });

    expect(response.status).toBe(200);
    expect(bodies[0].audio.voice).toBe('mimo_default');
    vi.unstubAllGlobals();
    rmSync(process.env.OPENCHAMBER_DATA_DIR, { recursive: true, force: true });
    delete process.env.OPENCHAMBER_DATA_DIR;
  });
});

describe('delta 2 hardening', () => {
  it('names the selected provider in the unavailability message', async () => {
    process.env.OPENCHAMBER_DATA_DIR = mkdtempSync(join(tmpdir(), 'oc-tts-route-503-'));
    writeFileSync(join(process.env.OPENCHAMBER_DATA_DIR, 'settings.json'), JSON.stringify({ speechProvider: 'mimo' }));

    const app = express();
    app.use(express.json());
    registerTtsRoutes(app, {});
    const response = await request(app).post('/api/tts/speak').send({ text: '你好' });

    expect(response.status).toBe(503);
    expect(response.body.error).toContain('mimo');
    rmSync(process.env.OPENCHAMBER_DATA_DIR, { recursive: true, force: true });
    delete process.env.OPENCHAMBER_DATA_DIR;
  });

  it('uses the provider default TTS model when the client sends none', async () => {
    process.env.OPENCHAMBER_DATA_DIR = mkdtempSync(join(tmpdir(), 'oc-tts-route-model-'));
    writeFileSync(join(process.env.OPENCHAMBER_DATA_DIR, 'settings.json'), JSON.stringify({ speechProvider: 'mimo' }));

    const bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from('RIFF-x').toString('base64') } } }],
      }), { status: 200 });
    }));

    const app = express();
    app.use(express.json());
    registerTtsRoutes(app, {});
    const response = await request(app)
      .post('/api/tts/speak')
      .send({ text: '你好', apiKey: 'tp-key', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1' });

    expect(response.status).toBe(200);
    expect(bodies[0].model).toBe('mimo-v2.5-tts');
    vi.unstubAllGlobals();
    rmSync(process.env.OPENCHAMBER_DATA_DIR, { recursive: true, force: true });
    delete process.env.OPENCHAMBER_DATA_DIR;
  });

  it('refuses cloud STT in enterprise mode when a non-default provider is selected', async () => {
    process.env.OPENCHAMBER_DATA_DIR = mkdtempSync(join(tmpdir(), 'oc-stt-route-ent-'));
    writeFileSync(join(process.env.OPENCHAMBER_DATA_DIR, 'settings.json'), JSON.stringify({ speechProvider: 'mimo' }));
    vi.stubEnv('OPENCHAMBER_ENTERPRISE_MODE', '1');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('must not be called'); }));

    const app = express();
    app.use(express.json());
    registerTtsRoutes(app, {});
    const response = await request(app)
      .post('/api/stt/transcribe')
      .set('x-base-url', 'https://token-plan-cn.xiaomimimo.com/v1')
      .set('authorization', 'Bearer tp-key')
      .set('content-type', 'audio/wav')
      .send(Buffer.from('RIFF-fake-wav'));

    expect(response.status).toBe(403);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(process.env.OPENCHAMBER_DATA_DIR, { recursive: true, force: true });
    delete process.env.OPENCHAMBER_DATA_DIR;
  });

  it('refuses cloud TTS in enterprise mode when a non-default provider is selected', async () => {
    process.env.OPENCHAMBER_DATA_DIR = mkdtempSync(join(tmpdir(), 'oc-tts-route-ent-'));
    writeFileSync(join(process.env.OPENCHAMBER_DATA_DIR, 'settings.json'), JSON.stringify({ speechProvider: 'mimo' }));
    vi.stubEnv('OPENCHAMBER_ENTERPRISE_MODE', '1');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('must not be called'); }));

    const app = express();
    app.use(express.json());
    registerTtsRoutes(app, {});
    const response = await request(app)
      .post('/api/tts/speak')
      .send({ text: '你好', apiKey: 'tp-key', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1' });

    expect(response.status).toBe(403);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(process.env.OPENCHAMBER_DATA_DIR, { recursive: true, force: true });
    delete process.env.OPENCHAMBER_DATA_DIR;
  });
});

