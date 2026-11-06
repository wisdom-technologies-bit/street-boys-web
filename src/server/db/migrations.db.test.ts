import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, getPool } from '@/server/db/client';
import { appMeta } from '@/server/db/schema';
import { truncateAll } from '@/test/db-utils';

/**
 * Proves the migration pipeline end to end against a real Postgres: the global
 * setup dropped the schema and applied ./drizzle from scratch, so if these pass,
 * an empty database can be built by the migrations alone.
 */
describe('baseline migration', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('created the app_meta table', async () => {
    const { rows } = await getPool().query<{ table: string | null }>(
      "select to_regclass('public.app_meta')::text as table",
    );

    expect(rows[0]?.table).toBe('app_meta');
  });

  it('app_meta has the agreed columns and types', async () => {
    const { rows } = await getPool().query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'app_meta'
        order by ordinal_position`,
    );

    expect(rows.map((row) => row.column_name)).toEqual(['key', 'value', 'updated_at']);
    expect(rows[0]?.data_type).toBe('text');
    expect(rows[0]?.is_nullable).toBe('NO');
    expect(rows[2]?.data_type).toBe('timestamp with time zone');
    expect(rows[2]?.column_default).toContain('now()');
  });

  it('writes, reads and updates a row through Drizzle', async () => {
    const db = getDb();

    await db.insert(appMeta).values({ key: 'schema_version', value: '1' });

    const [inserted] = await db.select().from(appMeta).where(eq(appMeta.key, 'schema_version'));
    expect(inserted?.value).toBe('1');
    expect(inserted?.updatedAt).toBeInstanceOf(Date);

    await db.update(appMeta).set({ value: '2' }).where(eq(appMeta.key, 'schema_version'));

    const [updated] = await db.select().from(appMeta).where(eq(appMeta.key, 'schema_version'));
    expect(updated?.value).toBe('2');
  });

  it('refuses a duplicate key', async () => {
    const db = getDb();

    await db.insert(appMeta).values({ key: 'dup', value: 'a' });

    await expect(db.insert(appMeta).values({ key: 'dup', value: 'b' })).rejects.toThrow();
  });

  it('cleans down to an empty table, so tests start equal', async () => {
    const db = getDb();
    await db.insert(appMeta).values({ key: 'any', value: 'thing' });

    const tables = await truncateAll();

    expect(tables).toContain('app_meta');
    expect(await db.select().from(appMeta)).toHaveLength(0);
  });
});
