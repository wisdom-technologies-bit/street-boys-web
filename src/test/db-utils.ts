import { getPool } from '@/server/db/client';

/**
 * Clean between tests.
 *
 * Every table in the public schema is truncated, discovered at runtime so that a
 * table added later is cleaned without anyone remembering to update a list. The
 * migration bookkeeping tables are left alone.
 */
export async function truncateAll(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );

  const tables = rows.map((row) => row.tablename).filter((name) => !name.startsWith('__drizzle'));

  if (tables.length > 0) {
    const list = tables.map((name) => `"${name}"`).join(', ');
    await pool.query(`truncate table ${list} restart identity cascade`);
  }

  return tables;
}
