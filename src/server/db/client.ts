import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
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

function readDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  return url;
}

export function getPool(): Pool {
  if (!globalForDb.__streetBoysPool) {
    globalForDb.__streetBoysPool = new Pool({
      connectionString: readDatabaseUrl(),
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalForDb.__streetBoysPool;
}

export function getDb(): Db {
  if (!globalForDb.__streetBoysDb) {
    globalForDb.__streetBoysDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__streetBoysDb;
}

export async function closeDb(): Promise<void> {
  if (globalForDb.__streetBoysPool) {
    await globalForDb.__streetBoysPool.end();
    globalForDb.__streetBoysPool = undefined;
    globalForDb.__streetBoysDb = undefined;
  }
}
