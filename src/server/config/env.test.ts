import { describe, expect, it, vi } from 'vitest';
import {
  EnvError,
  getEnv,
  parseEnv,
  parseMigrationEnv,
  requireAppOrigin,
  requireDatabaseUrl,
  requireIpHashPepper,
  requireOtpPepper,
  resetEnvCache,
  resolveMigrationConnectionUrl,
  resolveMigrationDatabaseUrl,
} from './env';

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
    vi.stubEnv('IP_HASH_PEPPER', 'x'.repeat(32));
    resetEnvCache();
    const first = getEnv();
    const second = getEnv();
    expect(second).toBe(first);
    resetEnvCache();
    vi.unstubAllEnvs();
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

describe('resolveMigrationDatabaseUrl', () => {
  it('prefers the direct migration URL when it is set', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://app:secret@pooler.example:5432/app',
      DATABASE_URL_MIGRATE: 'postgresql://app:secret@direct.example:5432/app',
    });
    expect(resolveMigrationDatabaseUrl(env)).toBe(
      'postgresql://app:secret@direct.example:5432/app',
    );
  });

  it('falls back to DATABASE_URL when no migration URL is set', () => {
    const env = parseEnv({ DATABASE_URL: 'postgresql://app:secret@pooler.example:5432/app' });
    expect(resolveMigrationDatabaseUrl(env)).toBe(
      'postgresql://app:secret@pooler.example:5432/app',
    );
  });

  it('fails with a message naming the variable when neither is set', () => {
    const env = parseEnv({});
    expect(() => resolveMigrationDatabaseUrl(env)).toThrow(/DATABASE_URL/);
  });

  it('never puts a connection value in the error it throws', () => {
    const env = parseEnv({ DATABASE_URL_MIGRATE: '' });
    try {
      resolveMigrationDatabaseUrl(env);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
});

describe('requireIpHashPepper', () => {
  it('returns the pepper when it is long enough', () => {
    const env = parseEnv({ IP_HASH_PEPPER: 'x'.repeat(32) });
    expect(requireIpHashPepper(env)).toHaveLength(32);
  });

  it('rejects a pepper shorter than 32 characters', () => {
    expect(() => parseEnv({ IP_HASH_PEPPER: 'too-short' })).toThrow(/IP_HASH_PEPPER/);
  });

  it('fails at the point of use when the pepper is missing, without printing anything', () => {
    const env = parseEnv({});
    expect(() => requireIpHashPepper(env)).toThrow(/IP_HASH_PEPPER/);
  });
});

describe('email provider rules', () => {
  it('defaults to console outside production', () => {
    expect(parseEnv({ NODE_ENV: 'development' }).EMAIL_PROVIDER).toBe('console');
    expect(parseEnv({ NODE_ENV: 'test' }).EMAIL_PROVIDER).toBe('console');
  });

  it('refuses to run in production without a provider', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('refuses the console provider in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: 'console' })).toThrow(
      /not allowed in production/,
    );
  });

  it('accepts brevo in production when its key and sender are set', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'test-key-value',
      EMAIL_FROM_ADDRESS: 'noreply@example.com',
      EMAIL_FROM_NAME: 'Street Boys',
    });
    expect(env.EMAIL_PROVIDER).toBe('brevo');
  });

  it('names every missing brevo variable at once', () => {
    let message = '';
    try {
      parseEnv({ EMAIL_PROVIDER: 'brevo' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('BREVO_API_KEY');
    expect(message).toContain('EMAIL_FROM_ADDRESS');
    expect(message).toContain('EMAIL_FROM_NAME');
  });

  it('rejects an unknown provider', () => {
    expect(() => parseEnv({ EMAIL_PROVIDER: 'sendgrid' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('rejects a sender address that is not an email', () => {
    expect(() =>
      parseEnv({
        EMAIL_PROVIDER: 'brevo',
        BREVO_API_KEY: 'k',
        EMAIL_FROM_ADDRESS: 'not-an-address',
        EMAIL_FROM_NAME: 'Street Boys',
      }),
    ).toThrow(/EMAIL_FROM_ADDRESS/);
  });
});

describe('sign-in secrets and origin', () => {
  it('requires OTP_PEPPER to be at least 32 characters', () => {
    expect(() => parseEnv({ OTP_PEPPER: 'short' })).toThrow(/OTP_PEPPER/);
    expect(parseEnv({ OTP_PEPPER: 'y'.repeat(32) }).OTP_PEPPER).toHaveLength(32);
  });

  it('accepts a URL for APP_ORIGIN and rejects anything else', () => {
    expect(parseEnv({ APP_ORIGIN: 'https://streetboys.example' }).APP_ORIGIN).toBe(
      'https://streetboys.example',
    );
    expect(() => parseEnv({ APP_ORIGIN: 'streetboys' })).toThrow(/APP_ORIGIN/);
  });

  it('fails at the point of use when the OTP pepper is missing', () => {
    expect(() => requireOtpPepper(parseEnv({}))).toThrow(/OTP_PEPPER/);
  });

  it('fails at the point of use when the origin is missing', () => {
    expect(() => requireAppOrigin(parseEnv({}))).toThrow(/APP_ORIGIN/);
  });

  it('never prints a provider key in an error', () => {
    let message = '';
    try {
      parseEnv({ EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'super-secret-key-value' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('super-secret-key-value');
  });
});

describe('parseMigrationEnv', () => {
  const url = 'postgresql://user:pass@db.example.com:5432/app';

  it('accepts a database URL and nothing else', () => {
    const env = parseMigrationEnv({ DATABASE_URL: url });
    expect(env).toEqual({ DATABASE_URL: url });
  });

  it('does not require the email, session or pepper variables', () => {
    // These would fail parseEnv in production; a migration needs none of them.
    expect(parseMigrationEnv({ DATABASE_URL: url })).toEqual({ DATABASE_URL: url });
    expect(() => parseEnv({ DATABASE_URL: url, NODE_ENV: 'production' })).toThrow();
  });

  it('treats an empty value as unset, as a dashboard would send it', () => {
    expect(parseMigrationEnv({ DATABASE_URL: url, DATABASE_URL_MIGRATE: '' })).toEqual({
      DATABASE_URL: url,
    });
  });

  it('rejects a value it cannot understand, without quoting it', () => {
    expect(() => parseMigrationEnv({ DATABASE_SSL: 'sometimes' })).toThrow(/DATABASE_SSL/);
    expect(() => parseMigrationEnv({ DATABASE_SSL: 'sometimes' })).not.toThrow(/sometimes/);
  });

  it('prefers DATABASE_URL_MIGRATE and falls back to DATABASE_URL', () => {
    const direct = 'postgresql://user:pass@direct.example.com:5432/app';
    expect(resolveMigrationConnectionUrl({ DATABASE_URL: url, DATABASE_URL_MIGRATE: direct })).toBe(
      direct,
    );
    expect(resolveMigrationConnectionUrl({ DATABASE_URL: url })).toBe(url);
  });

  it('refuses to migrate without any database URL', () => {
    expect(() => resolveMigrationConnectionUrl({})).toThrow(/DATABASE_URL_MIGRATE \/ DATABASE_URL/);
  });
});
