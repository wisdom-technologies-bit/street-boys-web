import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/config/env';
import { BREVO_ENDPOINT, createBrevoProvider } from './brevo';
import { EmailSendError } from './types';

const INPUT = { to: 'player@example.com', code: '123456', expiresInMinutes: 10 };

beforeEach(() => {
  vi.stubEnv('EMAIL_PROVIDER', 'brevo');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('BREVO_API_KEY', 'test-brevo-key-value');
  vi.stubEnv('EMAIL_FROM_ADDRESS', 'noreply@example.com');
  vi.stubEnv('EMAIL_FROM_NAME', 'Street Boys');
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({ messageId: 'x' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BrevoProvider', () => {
  it('posts to the documented endpoint with the api-key header and the documented body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201));
    await createBrevoProvider(fetchMock as unknown as typeof fetch).sendOtp(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BREVO_ENDPOINT);
    expect((init.headers as Record<string, string>)['api-key']).toBe('test-brevo-key-value');

    const body = JSON.parse(String(init.body));
    expect(body.sender).toEqual({ email: 'noreply@example.com', name: 'Street Boys' });
    expect(body.to).toEqual([{ email: 'player@example.com' }]);
    expect(body.subject).toBe('Your Street Boys code');
    expect(body.textContent).toContain('123456');
    expect(body.htmlContent).toContain('123456');
  });

  it('does not retry a 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400));

    await expect(
      createBrevoProvider(fetchMock as unknown as typeof fetch).sendOtp(INPUT),
    ).rejects.toBeInstanceOf(EmailSendError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx exactly once, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(201));

    await createBrevoProvider(fetchMock as unknown as typeof fetch).sendOtp(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500));

    await expect(
      createBrevoProvider(fetchMock as unknown as typeof fetch).sendOtp(INPUT),
    ).rejects.toBeInstanceOf(EmailSendError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once after a network error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(jsonResponse(201));

    await createBrevoProvider(fetchMock as unknown as typeof fetch).sendOtp(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a hung request after ten seconds and reports a send failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const promise = createBrevoProvider(fetchMock as unknown as typeof fetch).sendOtp(INPUT);
    const assertion = expect(promise).rejects.toBeInstanceOf(EmailSendError);

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    vi.useRealTimers();
  });

  it('never puts the key, the code or the address in the error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401));

    const error: Error = await createBrevoProvider(fetchMock as unknown as typeof fetch)
      .sendOtp(INPUT)
      .then(
        () => new Error('expected the send to fail'),
        (e: unknown) => e as Error,
      );

    const text = `${error.name}: ${error.message}`;
    expect(text).not.toContain('test-brevo-key-value');
    expect(text).not.toContain('123456');
    expect(text).not.toContain('player@example.com');
    expect(text).toContain('401');
  });

  it('refuses to send when its configuration is missing, naming the variable', async () => {
    vi.stubEnv('BREVO_API_KEY', '');
    resetEnvCache();

    // The environment rules catch it first, which is the point: a missing key
    // fails at startup, not on the first sign-in attempt.
    await expect(
      createBrevoProvider(vi.fn() as unknown as typeof fetch).sendOtp(INPUT),
    ).rejects.toThrow(/BREVO_API_KEY/);
  });
});
