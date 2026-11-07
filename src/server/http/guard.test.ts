import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/config/env';
import { guardMutation, jsonResponse } from './guard';

const ORIGIN = 'https://streetboys.example';

beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', ORIGIN);
  vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

function request(headers: Record<string, string>): Request {
  return new Request('https://streetboys.example/api/auth/request-code', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

const JSON_TYPE = { 'content-type': 'application/json' };

describe('guardMutation', () => {
  it('accepts the configured origin', () => {
    expect(guardMutation(request({ ...JSON_TYPE, origin: ORIGIN })).ok).toBe(true);
  });

  it('accepts a preview host whose origin matches the Host header', () => {
    expect(
      guardMutation(
        request({
          ...JSON_TYPE,
          origin: 'https://street-boys-git-feat-x.vercel.app',
          host: 'street-boys-git-feat-x.vercel.app',
        }),
      ).ok,
    ).toBe(true);
  });

  it('refuses a missing Origin header', () => {
    expect(guardMutation(request(JSON_TYPE)).ok).toBe(false);
  });

  it('refuses a foreign origin', () => {
    const result = guardMutation(
      request({ ...JSON_TYPE, origin: 'https://evil.example', host: 'streetboys.example' }),
    );
    expect(result.ok).toBe(false);
    expect('response' in result && result.response.status).toBe(403);
  });

  it('refuses a foreign origin whose host is a prefix of ours', () => {
    expect(
      guardMutation(
        request({
          ...JSON_TYPE,
          origin: 'https://streetboys.example.evil.example',
          host: 'streetboys.example',
        }),
      ).ok,
    ).toBe(false);
  });

  it('refuses a form content type, which is what a cross-site form post uses', () => {
    expect(
      guardMutation(
        request({ 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }),
      ).ok,
    ).toBe(false);
  });

  it('refuses a missing content type', () => {
    expect(guardMutation(request({ origin: ORIGIN })).ok).toBe(false);
  });
});

describe('jsonResponse', () => {
  it('always sends no-store', () => {
    const response = jsonResponse({ status: 'sent' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
