import { NextResponse } from 'next/server';
import { getEnv } from '@/server/config/env';
import { isCronRequestAuthorized } from '@/server/http/cron-auth';

/**
 * POST /api/internal/jobs/run — the one door a scheduler knocks on.
 *
 * Vercel Cron, a Render cron job, a Railway cron service and a GitHub Actions
 * schedule all reach the same endpoint with the same bearer secret, so no job
 * depends on one platform's scheduler (D-139).
 *
 * Protected by CRON_SECRET in `Authorization: Bearer <secret>`, compared in
 * constant time. If the secret is unset the route refuses every call. No jobs
 * exist yet: it reports that it ran zero of them.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type JobsRunResponse =
  | { ran: number }
  | { error: 'not_configured' | 'unauthorized' };

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: Request): Promise<NextResponse<JobsRunResponse>> {
  const { CRON_SECRET } = getEnv();

  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'not_configured' as const }, { status: 503, headers: NO_STORE });
  }

  if (!isCronRequestAuthorized(request.headers.get('authorization'), CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' as const }, { status: 401, headers: NO_STORE });
  }

  // Jobs arrive in a later prompt. Nothing to run yet.
  return NextResponse.json({ ran: 0 }, { status: 200, headers: NO_STORE });
}
