import { describe, expect, it } from 'vitest';

import { assertHttpUrl, audioFormatOf, requireSpeechCredentials } from './validate.js';

describe('assertHttpUrl (delta 2)', () => {
  it('normalizes a trailing slash without corrupting the path', () => {
    expect(assertHttpUrl('https://gw.example.com/v1/', 'base')).toBe('https://gw.example.com/v1');
  });

  it('passes through URLs without a trailing slash', () => {
    expect(assertHttpUrl('https://gw.example.com/v1', 'base')).toBe('https://gw.example.com/v1');
  });

  it('rejects URLs carrying a query string', () => {
    expect(() => assertHttpUrl('https://gw.example.com/v1?target=/', 'base')).toThrow(/query/i);
  });

  it('rejects URLs carrying a fragment', () => {
    expect(() => assertHttpUrl('https://gw.example.com/v1#frag', 'base')).toThrow(/fragment/i);
  });

  it('rejects non-http schemes', () => {
    expect(() => assertHttpUrl('ftp://example.com/v1', 'base')).toThrow(/http/);
  });
});

describe('requireSpeechCredentials (delta 2)', () => {
  it('rejects blank and non-string keys', () => {
    expect(() => requireSpeechCredentials('   ', 'MiMo TTS')).toThrow(/API key/);
    expect(() => requireSpeechCredentials(123, 'MiMo TTS')).toThrow(/API key/);
  });
});

describe('audioFormatOf (delta 2)', () => {
  it('strips codec parameters', () => {
    expect(audioFormatOf('audio/webm;codecs=opus')).toBe('webm');
  });

  it('falls back for malformed subtypes', () => {
    expect(audioFormatOf('audio/../x')).toBe('wav');
  });
});
