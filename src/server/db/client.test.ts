import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@/server/config/env';
import { poolConfig, resolveSsl } from './client';

describe('resolveSsl', () => {
  it('follows the URL when DATABASE_SSL is unset, which is how CI connects', () => {
    expect(resolveSsl(parseEnv({}))).toBeUndefined();
  });

  it('forces encryption when DATABASE_SSL=require', () => {
    expect(resolveSsl(parseEnv({ DATABASE_SSL: 'require' }))).toEqual({ rejectUnauthorized: false });
  });

  it('forces plain TCP when DATABASE_SSL=disable', () => {
    expect(resolveSsl(parseEnv({ DATABASE_SSL: 'disable' }))).toBe(false);
  });
});

describe('poolConfig', () => {
  const url = 'postgresql://someone:secret@db.example:5432/app';

  it('takes the pool size from DB_POOL_MAX, not from a hard-coded constant', () => {
    expect(poolConfig(parseEnv({ DATABASE_URL: url, DB_POOL_MAX: '17' })).max).toBe(17);
    expect(poolConfig(parseEnv({ DATABASE_URL: url })).max).toBe(5);
  });

  it('passes the connection string through unchanged', () => {
    expect(poolConfig(parseEnv({ DATABASE_URL: url })).connectionString).toBe(url);
  });

  it('refuses to build a pool with no database URL, and says so without printing one', () => {
    expect(() => poolConfig(parseEnv({}))).toThrow(/DATABASE_URL/);
  });

  it('sets a connection timeout so a dead database fails fast instead of hanging', () => {
    const config = poolConfig(parseEnv({ DATABASE_URL: url }));
    expect(config.connectionTimeoutMillis).toBe(5_000);
    expect(config.idleTimeoutMillis).toBe(10_000);
  });
});

describe('getPool', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reuses one pool per process instead of opening one per call', async () => {
    // A real Pool is constructed but never asked for a connection: `new Pool()`
    // is lazy, so nothing touches db.example. This tests the caching contract
    // itself rather than a mock of it.
    vi.stubEnv('DATABASE_URL', 'postgresql://someone:secret@db.example:5432/app');
    vi.stubEnv('DB_POOL_MAX', '7');

    const { getPool, closeDb, resetDbForTests } = await import('./client');
    resetDbForTests();

    const first = getPool();
    const second = getPool();

    expect(first).toBe(second);
    expect(first.options.max).toBe(7);

    await closeDb();
  });

  it('creates a new pool after the old one is closed', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://someone:secret@db.example:5432/app');

    const { getPool, closeDb, resetDbForTests } = await import('./client');
    resetDbForTests();

    const first = getPool();
    await closeDb();
    const second = getPool();

    expect(second).not.toBe(first);

    await closeDb();
  });
});
