import { z } from 'zod';

/**
 * The environment, validated once.
 *
 * This module is the **only** place in the application that reads `process.env`.
 * Everything else imports `getEnv()`, so a missing or malformed variable fails at
 * one clear point instead of surfacing as `undefined` inside a query three layers
 * deep.
 *
 * Three rules hold here (AGENTS.md section 13):
 *
 * 1. **Never print a value.** Errors name the variable and say what was expected.
 *    They never include what was actually supplied, because a bad value is often
 *    a pasted secret.
 * 2. **Validate lazily.** `next build` collects page data without a database and
 *    often without runtime secrets, so the module must not throw merely because
 *    it was imported during a build.
 * 3. **Default the safe things, require the dangerous ones.** A pool size has a
 *    sane default; a database URL does not, so it is required at the point of use
 *    and not at import.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Postgres connection string. Required wherever the database is actually used.
   * On Vercel this is Neon's **pooled** endpoint; on Railway and Render it is the
   * service's own connection string.
   */
  DATABASE_URL: z.string().min(1).optional(),

  /**
   * A **direct** (non-pooled) connection string, used only by `npm run db:migrate`.
   *
   * Migrations take a session-level advisory lock, and a transaction-mode pooler
   * such as Neon's or PgBouncer's may hand the `pg_advisory_lock` and the
   * `pg_advisory_unlock` to two different backends. Unset means "use
   * DATABASE_URL", which is correct when that URL is already direct.
   */
  DATABASE_URL_MIGRATE: z.string().min(1).optional(),

  /** The disposable database used only by `npm run test:db`. Never a real one. */
  DATABASE_URL_TEST: z.string().min(1).optional(),

  /**
   * SSL for the database connection, when the URL does not already say so.
   * `require` means "encrypt, do not worry about the chain" (what hosted Postgres
   * needs); `disable` means plain TCP, for a local server. Unset means "follow the
   * URL" (`sslmode`), which is what CI uses.
   */
  DATABASE_SSL: z.enum(['require', 'disable']).optional(),

  /**
   * Maximum connections in the pool. Serverless functions are many and short
   * lived, so Vercel wants a small number; a long-running Render or Railway
   * service can afford more.
   */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  /**
   * How many proxy hops in front of the app may be trusted when reading
   * `x-forwarded-for`. 0 means "no proxy, use the socket address". See
   * `src/server/http/client-ip.ts`.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),

  /**
   * Bearer secret the scheduler presents to `POST /api/internal/jobs/run`.
   * Unset means the endpoint refuses everything, which is the safe default.
   */
  CRON_SECRET: z.string().min(16).max(200).optional(),

  /**
   * Pepper for every HMAC in the accounts work: the email hash that identifies a
   * person in the audit log, and the IP hash. At least 32 characters. Changing it
   * invalidates every stored hash, so it is a long-lived secret.
   */
  IP_HASH_PEPPER: z.string().min(32).max(500).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Thrown when the environment does not validate. Never contains a value. */
export class EnvError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `Invalid environment configuration. Fix these variables and restart (values are never shown):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'EnvError';
    this.problems = problems;
  }
}

/**
 * Treat an empty string as "not set". A platform dashboard that shows an empty
 * field, and a `.env` line ending in `=`, both produce `""`, and `""` should mean
 * absence rather than an invalid value.
 */
function withoutEmptyValues(source: Record<string, string | undefined>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Validate a raw environment object. Exported so tests can exercise every branch
 * without touching the real process environment.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(withoutEmptyValues(source));

  if (!result.success) {
    // Deliberately built from the issue path and the message only. Zod's default
    // error text can quote the offending value, so it is never used here.
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(root)';
      return `${name}: ${issue.message}`;
    });
    throw new EnvError(problems);
  }

  return result.data;
}

let cached: Env | undefined;

/** The validated environment, parsed on first use and cached for the process. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Clear the cache. Tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * The database URL, or a clear error. Called where a connection is actually
 * opened, so a build without a database still succeeds.
 */
export function requireDatabaseUrl(env: Env = getEnv()): string {
  if (!env.DATABASE_URL) {
    throw new EnvError([
      'DATABASE_URL: is not set. Copy .env.example to .env.local and fill it in, or set it in the platform dashboard.',
    ]);
  }
  return env.DATABASE_URL;
}

/**
 * The connection string `npm run db:migrate` should use.
 *
 * `DATABASE_URL_MIGRATE` wins when it is set, because the migration lock needs a
 * direct connection and the app's URL may be pooled. Otherwise the normal URL is
 * used, which is what CI and a local database do.
 */
export function resolveMigrationDatabaseUrl(env: Env = getEnv()): string {
  if (env.DATABASE_URL_MIGRATE) return env.DATABASE_URL_MIGRATE;
  return requireDatabaseUrl(env);
}

/**
 * The pepper used for HMACs, required wherever a hash is produced.
 *
 * It is optional in the schema so that `next build` and a health check do not
 * need it; it is required at the point of use, like the database URL.
 */
export function requireIpHashPepper(env: Env = getEnv()): string {
  if (!env.IP_HASH_PEPPER) {
    throw new EnvError([
      'IP_HASH_PEPPER: is not set. Generate 32 or more random characters and set it in the environment.',
    ]);
  }
  return env.IP_HASH_PEPPER;
}
