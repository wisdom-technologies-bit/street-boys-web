import { NextResponse } from 'next/server';
import { getEnv } from '@/server/config/env';
import { isCronRequestAuthorized } from '@/server/http/cron-auth';
import { runDueJobs, type JobOutcome } from '@/server/jobs/registry';

/**
 * POST /api/internal/jobs/run — the one door a scheduler knocks on.
 *
 * Vercel Cron, a Render cron job, a Railway cron service and a GitHub Actions
 * schedule all reach the same endpoint with the same bearer secret, so no job
 * depends on one platform's scheduler (D-139).
 *
 * Protected by CRON_SECRET in `Authorization: Bearer <secret>`, compared in
 * constant time. If the secret is unset the route refuses every call.
 *
 * The body names every job and what it did, so a scheduler's log is a report rather
 * than a heartbeat: `{ ran, jobs: [{ name, ok, released }] }`. When another instance
 * holds the run lock the answer is `{ skipped: true }` and nothing ran.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type JobsRunResponse =
  | { ran: number; skipped: boolean; jobs: JobOutcome[] }
  | { error: 'not_configured' | 'unauthorized' };

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: Request): Promise<NextResponse<JobsRunResponse>> {
  const { CRON_SECRET } = getEnv();

  if (!CRON_SECRET) {
    return NextResponse.json(
      { error: 'not_configured' as const },
      { status: 503, headers: NO_STORE },
    );
  }

  if (!isCronRequestAuthorized(request.headers.get('authorization'), CRON_SECRET)) {
    return NextResponse.json(
      { error: 'unauthorized' as const },
      { status: 401, headers: NO_STORE },
    );
  }

  const run = await runDueJobs();

  return NextResponse.json(
    { ran: run.jobs.length, skipped: run.skipped, jobs: run.jobs },
    { status: 200, headers: NO_STORE },
  );
}
