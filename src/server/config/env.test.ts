import { describe, expect, it } from 'vitest';
import { EnvError, getEnv, parseEnv, requireDatabaseUrl, resetEnvCache } from './env';

const SECRET_LOOKING = 'postgresql://someone:hunter2@db.example:5432/app';

describe('parseEnv', () => {
  it('applies the documented defaults', () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.DB_POOL_MAX).toBe(5);
    expect(env.TRUSTED_PROXY_HOPS).toBe(1);
    expect(env.DATABASE_SSL).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
  });

  it('coerces numbers from strings, because every platform supplies strings', () => {
    const env = parseEnv({ DB_POOL_MAX: '12', TRUSTED_PROXY_HOPS: '0' });
    expect(env.DB_POOL_MAX).toBe(12);
    expect(env.TRUSTED_PROXY_HOPS).toBe(0);
  });

  it('treats an empty string as "not set" rather than as a value', () => {
    const env = parseEnv({ DATABASE_URL: '', CRON_SECRET: '   ', DB_POOL_MAX: '' });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
    expect(env.DB_POOL_MAX).toBe(5);
  });

  it('rejects an unsupported NODE_ENV', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging' })).toThrow(EnvError);
  });

  it('rejects a pool size of zero and a negative hop count', () => {
    expect(() => parseEnv({ DB_POOL_MAX: '0' })).toThrow(EnvError);
    expect(() => parseEnv({ TRUSTED_PROXY_HOPS: '-1' })).toThrow(EnvError);
  });

  it('rejects a DATABASE_SSL value that is neither require nor disable', () => {
    expect(() => parseEnv({ DATABASE_SSL: 'true' })).toThrow(EnvError);
  });

  it('rejects a CRON_SECRET shorter than 16 characters', () => {
    expect(() => parseEnv({ CRON_SECRET: 'too-short' })).toThrow(EnvError);
  });

  it('names the failing variable but never echoes the value', () => {
    let message = '';
    try {
      parseEnv({ DATABASE_SSL: SECRET_LOOKING, CRON_SECRET: 'short' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('DATABASE_SSL');
    expect(message).toContain('CRON_SECRET');
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('postgresql://');
    expect(message).not.toContain('db.example');
  });

  it('compares a bad numeric value without printing it', () => {
    let message = '';
    try {
      parseEnv({ DB_POOL_MAX: SECRET_LOOKING });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DB_POOL_MAX');
    expect(message).not.toContain('hunter2');
  });
});

describe('getEnv', () => {
  it('caches the parsed environment', () => {
    resetEnvCache();
    const first = getEnv();
    const second = getEnv();
    expect(second).toBe(first);
    resetEnvCache();
  });
});

describe('requireDatabaseUrl', () => {
  it('returns the URL when it is set', () => {
    const env = parseEnv({ DATABASE_URL: SECRET_LOOKING });
    expect(requireDatabaseUrl(env)).toBe(SECRET_LOOKING);
  });

  it('throws a clear error when it is missing, without printing anything', () => {
    const env = parseEnv({});
    expect(() => requireDatabaseUrl(env)).toThrow(/DATABASE_URL/);
    expect(() => requireDatabaseUrl(env)).toThrow(EnvError);
  });
});
