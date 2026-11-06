import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import { getEnv, requireDatabaseUrl, type Env } from '@/server/config/env';
import * as schema from './schema';

/**
 * The database client.
 *
 * Driver choice: node-postgres (`pg`). It speaks plain Postgres over TCP, so the
 * same code path serves a local database, the CI service container and Neon's
 * pooled endpoint on Vercel. The Neon HTTP driver would be faster to wake up but
 * is Neon-only, which would give the tests a different driver from production.
 *
 * The pool is created lazily and cached on `globalThis` so that a hot reload in
 * development, or a warm serverless instance, reuses one pool instead of opening
 * a new connection per request.
 */

type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __streetBoysPool?: Pool; __streetBoysDb?: Db };

/**
 * SSL, from `DATABASE_SSL` when it is set, otherwise from the URL.
 *
 * - `require`  → encrypt. The chain is not verified, which is what a hosted
 *                Postgres with a provider-managed certificate needs and what
 *                `sslmode=require` means to every other Postgres client.
 * - `disable`  → plain TCP, for a database on localhost.
 * - unset      → leave it to the URL's `sslmode`, which is how CI connects.
 */
export function resolveSsl(env: Pick<Env, 'DATABASE_SSL'>): PoolConfig['ssl'] {
  if (env.DATABASE_SSL === 'disable') return false;
  if (env.DATABASE_SSL === 'require') return { rejectUnauthorized: false };
  return undefined;
}

/**
 * The pool configuration, built from the validated environment. Exported so a
 * test can assert the pool size and SSL come from configuration rather than
 * from a constant somebody typed here.
 */
export function poolConfig(env: Env = getEnv()): PoolConfig {
  return {
    connectionString: requireDatabaseUrl(env),
    max: env.DB_POOL_MAX,
    ssl: resolveSsl(env),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  };
}

export function getPool(): Pool {
  if (!globalForDb.__streetBoysPool) {
    globalForDb.__streetBoysPool = new Pool(poolConfig());
  }
  return globalForDb.__streetBoysPool;
}

export function getDb(): Db {
  if (!globalForDb.__streetBoysDb) {
    globalForDb.__streetBoysDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__streetBoysDb;
}

/** Drop the cached pool and client. Tests only. */
export function resetDbForTests(): void {
  globalForDb.__streetBoysPool = undefined;
  globalForDb.__streetBoysDb = undefined;
}

export async function closeDb(): Promise<void> {
  if (globalForDb.__streetBoysPool) {
    await globalForDb.__streetBoysPool.end();
    globalForDb.__streetBoysPool = undefined;
    globalForDb.__streetBoysDb = undefined;
  }
}
