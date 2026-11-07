import { truncateAll } from '@/test/db-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { consumeRateLimit, deleteExpiredRateLimits } from './rate-limit';

beforeEach(async () => {
  await truncateAll();
});

describe('consumeRateLimit', () => {
  it('allows exactly the limit, then refuses', async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await consumeRateLimit('login:1.2.3.4', 3, 60));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps separate counters per key', async () => {
    await consumeRateLimit('a', 1, 60);
    const other = await consumeRateLimit('b', 1, 60);
    expect(other.allowed).toBe(true);
  });

  it('rolls over into a fresh window', async () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    await consumeRateLimit('k', 1, 60, start);
    const sameWindow = await consumeRateLimit('k', 1, 60, new Date(start.getTime() + 30_000));
    const nextWindow = await consumeRateLimit('k', 1, 60, new Date(start.getTime() + 61_000));

    expect(sameWindow.allowed).toBe(false);
    expect(nextWindow.allowed).toBe(true);
    expect(nextWindow.remaining).toBe(0);
  });

  it('never lets 50 concurrent calls exceed the limit', async () => {
    const limit = 10;
    const calls = Array.from({ length: 50 }, () => consumeRateLimit('burst', limit, 60));
    const results = await Promise.all(calls);

    expect(results.filter((r) => r.allowed)).toHaveLength(limit);
    expect(results.filter((r) => !r.allowed)).toHaveLength(50 - limit);
  });

  it('rejects a nonsensical limit instead of guessing', async () => {
    await expect(consumeRateLimit('k', 0, 60)).rejects.toThrow(/limit/);
    await expect(consumeRateLimit('k', 1, 0)).rejects.toThrow(/windowSeconds/);
  });
});

describe('deleteExpiredRateLimits', () => {
  it('removes windows that ended before the cutoff', async () => {
    await consumeRateLimit('old', 5, 60, new Date('2026-01-01T00:00:00.000Z'));
    await consumeRateLimit('fresh', 5, 60, new Date());

    const removed = await deleteExpiredRateLimits(3600);
    expect(removed).toBe(1);
  });
});
