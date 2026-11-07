import { resetEnvCache } from '@/server/config/env';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The five transfer routes, wired but not wired to a database.
 *
 * What a route owns is the order of the guards, the shape of the answer and the
 * status code; the money itself is tested against Postgres. So the session, the
 * limiter and the services are mocked and the tests read the responses.
 */

const user = { id: '2f1d3a9e-0000-4000-8000-000000000001', status: 'active' as const };

vi.mock('@/server/accounts/session', () => ({ findSessionUser: vi.fn(async () => user) }));
vi.mock('@/server/security/rate-limit', () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock('@/server/transfers/send', () => ({
  sendMoney: vi.fn(),
  quoteTransfer: vi.fn(),
  getSendLimits: vi.fn(),
}));
vi.mock('@/server/transfers/list', () => ({
  TRANSFER_LIST_DEFAULT_LIMIT: 20,
  TRANSFER_LIST_MAX_LIMIT: 50,
  listTransfers: vi.fn(),
}));
vi.mock('@/server/transfers/cancel', () => ({ cancelTransfer: vi.fn() }));

const { findSessionUser } = await import('@/server/accounts/session');
const { consumeRateLimit } = await import('@/server/security/rate-limit');
const { sendMoney, quoteTransfer, getSendLimits } = await import('@/server/transfers/send');
const { listTransfers } = await import('@/server/transfers/list');
const { cancelTransfer } = await import('@/server/transfers/cancel');
const { TransferError } = await import('@/server/transfers/errors');

const transfers = await import('./route');
const quote = await import('./quote/route');
const limits = await import('./limits/route');
const cancel = await import('./[id]/cancel/route');

const ORIGIN = 'https://streetboys.example';

function post(path: string, body?: unknown): Request {
  return new Request(`https://streetboys.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, host: 'streetboys.example' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`https://streetboys.example${path}`);
}

const ID = '9a7f0000-0000-4000-8000-000000000042';
const KEY = '1b2c0000-0000-4000-8000-000000000099';

beforeEach(() => {
  // The request guard reads the configured origin; these tests are not about config.
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('EMAIL_PROVIDER', 'console');
  vi.stubEnv('APP_ORIGIN', ORIGIN);
  vi.stubEnv('OTP_PEPPER', 'test-otp-pepper-0123456789abcdefghij');
  vi.stubEnv('IP_HASH_PEPPER', 'test-pepper-not-a-real-secret-0123456789abcdef');
  resetEnvCache();

  vi.clearAllMocks();
  vi.mocked(findSessionUser).mockResolvedValue(user as never);
  vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 } as never);
});

describe('POST /api/transfers', () => {
  it('answers 201 with every amount as a string', async () => {
    vi.mocked(sendMoney).mockResolvedValue({
      id: ID,
      status: 'pending',
      amountKobo: 15_000_000n,
      taxKobo: 200_000n,
      releaseAt: new Date('2026-11-08T10:00:00Z'),
      balanceKobo: 246_000_000n,
      replayed: false,
    });

    const response = await transfers.POST(
      post('/api/transfers', { toName: 'Ada Obi', amountKobo: '15000000', idempotencyKey: KEY }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      transfer: {
        id: ID,
        status: 'pending',
        amountKobo: '15000000',
        taxKobo: '200000',
        releaseAt: '2026-11-08T10:00:00.000Z',
        balanceKobo: '246000000',
        replayed: false,
      },
    });
    expect(sendMoney).toHaveBeenCalledWith({
      senderUserId: user.id,
      toName: 'Ada Obi',
      amountKobo: 15_000_000n,
      idempotencyKey: KEY,
    });
  });

  it('is 401 when signed out and 403 when the account is not active', async () => {
    vi.mocked(findSessionUser).mockResolvedValueOnce(null);
    const signedOut = await transfers.POST(
      post('/api/transfers', { toName: 'Ada', amountKobo: '1', idempotencyKey: KEY }),
    );
    expect(signedOut.status).toBe(401);

    vi.mocked(findSessionUser).mockResolvedValueOnce({ id: user.id, status: 'frozen' } as never);
    const frozen = await transfers.POST(
      post('/api/transfers', { toName: 'Ada', amountKobo: '1', idempotencyKey: KEY }),
    );
    expect(frozen.status).toBe(403);
    expect(sendMoney).not.toHaveBeenCalled();
  });

  it('refuses a body that is not an amount in kobo', async () => {
    const response = await transfers.POST(
      post('/api/transfers', { toName: 'Ada', amountKobo: 1000, idempotencyKey: KEY }),
    );
    expect(response.status).toBe(400);
  });

  it('maps a refusal and a rate limit', async () => {
    vi.mocked(sendMoney).mockRejectedValueOnce(new TransferError('insufficient_funds', 'no'));
    const refused = await transfers.POST(
      post('/api/transfers', { toName: 'Ada', amountKobo: '1000', idempotencyKey: KEY }),
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'insufficient_funds' });

    vi.mocked(sendMoney).mockRejectedValueOnce(new TransferError('rate_limited', 'slow down', 12));
    const limited = await transfers.POST(
      post('/api/transfers', { toName: 'Ada', amountKobo: '1000', idempotencyKey: KEY }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('12');
  });

  it('answers a receiver problem without revealing which one', async () => {
    vi.mocked(sendMoney).mockRejectedValueOnce(new TransferError('receiver_unavailable', 'no'));
    const response = await transfers.POST(
      post('/api/transfers', { toName: 'ghost', amountKobo: '1000', idempotencyKey: KEY }),
    );
    expect(await response.json()).toEqual({ error: 'receiver_unavailable' });
  });
});

describe('GET /api/transfers', () => {
  it('lists only what the service returned, with ISO dates and string amounts', async () => {
    vi.mocked(listTransfers).mockResolvedValue({
      transfers: [
        {
          id: ID,
          at: new Date('2026-11-07T09:00:00Z'),
          amountKobo: 100_000n,
          taxKobo: 0n,
          status: 'completed',
          releaseAt: null,
          toName: 'Ada Obi',
        },
      ],
      nextCursor: null,
    });

    const response = await transfers.GET(get('/api/transfers'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transfers: [
        {
          id: ID,
          at: '2026-11-07T09:00:00.000Z',
          toName: 'Ada Obi',
          amountKobo: '100000',
          taxKobo: '0',
          status: 'completed',
          releaseAt: null,
        },
      ],
      nextCursor: null,
    });
    expect(listTransfers).toHaveBeenCalledWith(user.id, { limit: 20, before: null });
  });

  it('bounds the limit and validates the cursor', async () => {
    expect((await transfers.GET(get('/api/transfers?limit=0'))).status).toBe(400);
    expect((await transfers.GET(get('/api/transfers?limit=51'))).status).toBe(400);
    expect((await transfers.GET(get('/api/transfers?before=not-a-uuid'))).status).toBe(400);
  });

  it('is 429 with Retry-After when the limiter refuses', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 30,
    } as never);
    const response = await transfers.GET(get('/api/transfers'));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
  });
});

describe('POST /api/transfers/quote and GET /api/transfers/limits', () => {
  it('quotes the tax and the remainder of the day', async () => {
    vi.mocked(quoteTransfer).mockResolvedValue({
      amountKobo: 6_000_000n,
      taxKobo: 20_000n,
      totalKobo: 6_020_000n,
      willBePending: false,
      releaseAt: null,
      sendRemainingKobo: 24_000_000n,
    });

    const response = await quote.POST(
      post('/api/transfers/quote', { toName: 'Ada', amountKobo: '6000000' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      amountKobo: '6000000',
      taxKobo: '20000',
      totalKobo: '6020000',
      willBePending: false,
      releaseAt: null,
      sendRemainingKobo: '24000000',
    });
  });

  it('reports the tier limits without leaking another player', async () => {
    vi.mocked(getSendLimits).mockResolvedValue({
      tier: 'established',
      minTransferKobo: 10_000n,
      maxPerTransferKobo: 30_000_000n,
      maxSendPer24hKobo: 30_000_000n,
      sendRemainingKobo: 24_000_000n,
      pendingThresholdKobo: 10_000_000n,
      taxFreeBandKobo: 5_000_000n,
      taxRateBps: 200,
    });

    const response = await limits.GET(get('/api/transfers/limits'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe('established');
    expect(body.sendRemainingKobo).toBe('24000000');
    expect(JSON.stringify(body)).not.toContain(user.id);
  });
});

describe('POST /api/transfers/{id}/cancel', () => {
  it("cancels the caller's own pending transfer", async () => {
    vi.mocked(cancelTransfer).mockResolvedValue({ id: ID, status: 'cancelled', replayed: false });

    const response = await cancel.POST(post(`/api/transfers/${ID}/cancel`), {
      params: Promise.resolve({ id: ID }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transfer: { id: ID, status: 'cancelled', replayed: false },
    });
    expect(cancelTransfer).toHaveBeenCalledWith({ senderUserId: user.id, transferId: ID });
  });

  it("refuses an id that is not a uuid, and maps somebody else's to 404", async () => {
    const bad = await cancel.POST(post('/api/transfers/nope/cancel'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(bad.status).toBe(400);

    vi.mocked(cancelTransfer).mockRejectedValueOnce(new TransferError('not_found', 'no'));
    const notFound = await cancel.POST(post(`/api/transfers/${ID}/cancel`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(notFound.status).toBe(404);
  });

  it('sets no-store on every answer', async () => {
    vi.mocked(cancelTransfer).mockResolvedValue({ id: ID, status: 'cancelled', replayed: true });
    const response = await cancel.POST(post(`/api/transfers/${ID}/cancel`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
