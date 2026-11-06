import type { PoolConfig } from 'pg';

/**
 * SSL for a database connection, from `DATABASE_SSL` when it is set, otherwise
 * from the URL.
 *
 * - `require`  → encrypt. The chain is not verified, which is what a hosted
 *                Postgres with a provider-managed certificate needs, and what
 *                `sslmode=require` means to every other Postgres client.
 * - `disable`  → plain TCP, for a database on localhost.
 * - unset      → leave it to the URL's `sslmode`, which is how CI connects.
 *
 * It lives in its own module, with no imports but a type, so the pre-deploy
 * migration script can use the same rule as the app without pulling in the app's
 * path aliases — Node runs that script directly, and `@/...` does not exist there.
 */
export type SslSetting = { DATABASE_SSL?: 'require' | 'disable' };

export function resolveSsl(env: SslSetting): PoolConfig['ssl'] {
  if (env.DATABASE_SSL === 'disable') return false;
  if (env.DATABASE_SSL === 'require') return { rejectUnauthorized: false };
  return undefined;
}
