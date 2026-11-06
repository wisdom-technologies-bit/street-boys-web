import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolConfig } from 'pg';

/**
 * Migrations, as a **pre-deploy step** and never at app start.
 *
 * Two deploys can start at the same moment: a platform retry, a rollback, or two
 * engineers merging within a minute of each other. Two `migrate()` runs racing on
 * the same database can each see the same migration as pending, and the loser
 * fails halfway through a schema change. A Postgres advisory lock fixes that with
 * no extra infrastructure: the second run waits for the first, then finds nothing
 * left to do.
 *
 * The lock is held on one dedicated connection for exactly as long as the
 * migration takes, and is released in a `finally` — including the case where the
 * migration throws, so a failed deploy does not wedge every later one. The lock
 * also disappears by itself if the process is killed, because a session-scoped
 * advisory lock dies with its connection.
 *
 * `statement_timeout` bounds the wait: a deploy that cannot get the lock within
 * `lockWaitMs` fails loudly instead of hanging until the platform kills it with a
 * message nobody can read.
 */

/**
 * A fixed, arbitrary key. It must never change: a different number would mean two
 * deploys take two different locks and both migrate at once. It is visible in
 * `pg_locks`, which is how the tests find it.
 */
export const ADVISORY_LOCK_KEY = 764_1201;

export type RunMigrationsOptions = {
  connectionString: string;
  /** Folder holding the generated SQL and `meta/_journal.json`. */
  migrationsFolder?: string;
  /** How long to wait for another deploy's lock before giving up. */
  lockWaitMs?: number;
  /** SSL for the migration connection; the app's own setting is reused. */
  ssl?: PoolConfig['ssl'];
};

export class MigrationLockTimeoutError extends Error {
  constructor(lockWaitMs: number) {
    super(
      `Could not take the migration lock within ${lockWaitMs}ms. Another deploy is probably migrating this database right now. Wait for it to finish and deploy again.`,
    );
    this.name = 'MigrationLockTimeoutError';
  }
}

/**
 * Apply every pending migration under an advisory lock.
 *
 * Idempotent: running it twice applies nothing the second time and throws nothing.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const { connectionString, migrationsFolder = './drizzle', lockWaitMs = 30_000, ssl } = options;

  const pool = new Pool({ connectionString, max: 1, ssl });
  const client = await pool.connect();

  let locked = false;
  try {
    // Integer only: statement_timeout takes no parameters, so the value is
    // validated and rounded here rather than interpolated as-is.
    const timeoutMs = Math.max(1, Math.trunc(lockWaitMs));
    await client.query(`set statement_timeout = ${timeoutMs}`);

    try {
      await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
      locked = true;
    } catch {
      throw new MigrationLockTimeoutError(timeoutMs);
    }

    // Migrations themselves must not inherit the short lock timeout.
    await client.query('reset statement_timeout');

    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    if (locked) {
      // Best effort: if this fails the connection is closed below, which releases
      // the lock anyway.
      await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    }
    client.release();
    await pool.end();
  }
}
