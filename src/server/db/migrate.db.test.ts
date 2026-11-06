import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ADVISORY_LOCK_KEY, MigrationLockTimeoutError, runMigrations } from './migrate';

const connectionString = (): string => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  return url;
};

/** Advisory locks currently held on this database, by any connection. */
async function heldAdvisoryLocks(): Promise<number> {
  const pool = new Pool({ connectionString: connectionString(), max: 1 });
  try {
    const { rows } = await pool.query<{ held: number }>(
      `select count(*)::int as held
         from pg_locks
        where locktype = 'advisory'
          and database = (select oid from pg_database where datname = current_database())`,
    );
    return rows[0]?.held ?? 0;
  } finally {
    await pool.end();
  }
}

describe('runMigrations', () => {
  afterAll(async () => {
    // Leave nothing behind that could make a later test wait.
    const pool = new Pool({ connectionString: connectionString(), max: 1 });
    await pool.query('select pg_advisory_unlock_all()').catch(() => {});
    await pool.end();
  });

  it('is harmless to run twice: the second run applies nothing and throws nothing', async () => {
    await runMigrations({ connectionString: connectionString() });
    await runMigrations({ connectionString: connectionString() });

    const pool = new Pool({ connectionString: connectionString(), max: 1 });
    try {
      const { rows } = await pool.query<{ present: boolean }>(
        "select to_regclass('public.app_meta') is not null as present",
      );
      expect(rows[0]?.present).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('takes the advisory lock and releases it before returning', async () => {
    const before = await heldAdvisoryLocks();

    await runMigrations({ connectionString: connectionString() });

    const after = await heldAdvisoryLocks();
    expect(after).toBe(before);
  });

  it('releases the lock when the migration itself fails', async () => {
    const before = await heldAdvisoryLocks();

    await expect(
      // A folder that does not exist makes the migrator throw after the lock is held.
      runMigrations({ connectionString: connectionString(), migrationsFolder: './drizzle/does-not-exist' }),
    ).rejects.toBeTruthy();

    expect(await heldAdvisoryLocks()).toBe(before);
  });

  it('waits for a lock held elsewhere, then gives up with a clear message', async () => {
    const blocker = new Pool({ connectionString: connectionString(), max: 1 });
    const blockerClient = await blocker.connect();
    await blockerClient.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    try {
      await expect(
        runMigrations({ connectionString: connectionString(), lockWaitMs: 250 }),
      ).rejects.toBeInstanceOf(MigrationLockTimeoutError);
    } finally {
      await blockerClient.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      blockerClient.release();
      await blocker.end();
    }
  });

  it('proceeds once the other holder releases the lock', async () => {
    const blocker = new Pool({ connectionString: connectionString(), max: 1 });
    const blockerClient = await blocker.connect();
    await blockerClient.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    const release = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await blockerClient.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    })();

    await expect(
      runMigrations({ connectionString: connectionString(), lockWaitMs: 10_000 }),
    ).resolves.toBeUndefined();

    await release;
    blockerClient.release();
    await blocker.end();
  });
});
