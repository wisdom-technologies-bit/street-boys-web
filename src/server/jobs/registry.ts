import { getPool } from '@/server/db/client';
import { releaseDueTransfers } from '@/server/transfers/release';

/**
 * The job registry.
 *
 * One endpoint, one list of jobs, one advisory lock: a scheduler may call the route
 * as often as it likes and two instances may call it at the same moment, without a
 * job running twice. The lock is a transaction-scoped advisory lock, so it is
 * released by the database even if the process dies mid-run (D-139).
 *
 * Jobs must be idempotent anyway; the lock lowers the odds, and the ledger's
 * idempotency keys make a duplicate harmless.
 */

/** Any fixed number; this one is "SBJ" in hex and its low digits are 1. */
const JOBS_LOCK_KEY = 5_221_001;

export type JobOutcome = {
  name: string;
  ok: boolean;
  /** Whatever the job reports about its work, for the response body. */
  released?: number;
  error?: string;
};

export type JobsRun = { skipped: boolean; jobs: JobOutcome[] };

export async function runDueJobs(now: Date = new Date()): Promise<JobsRun> {
  const client = await getPool().connect();

  try {
    await client.query('begin');
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_xact_lock($1) as locked',
      [JOBS_LOCK_KEY],
    );

    if (!rows[0]?.locked) {
      await client.query('rollback');
      return { skipped: true, jobs: [] };
    }

    const jobs: JobOutcome[] = [];

    try {
      const { released } = await releaseDueTransfers({ now });
      jobs.push({ name: 'transfers.release', ok: true, released });
    } catch (error) {
      // One failing job must not stop the others, and the response must say which.
      jobs.push({ name: 'transfers.release', ok: false, error: 'failed' });
      void error;
    }

    await client.query('commit');
    return { skipped: false, jobs };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
