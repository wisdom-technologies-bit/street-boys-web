import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Runs once per `npm run test:db` run.
 *
 * It starts from an empty database on purpose: dropping the schema and applying
 * every migration from scratch proves the migrations actually build the schema,
 * instead of proving that a database somebody prepared earlier still works.
 */
export default async function setup(): Promise<void> {
  loadEnv({ path: ['.env.test', '.env.local', '.env'], quiet: true });

  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Copy .env.example to .env.local and point it at a disposable database.',
    );
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query('drop schema if exists public cascade');
    await pool.query('create schema public');
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}
