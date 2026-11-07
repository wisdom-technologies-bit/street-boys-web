import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/client';

/**
 * GET /api/ready — readiness only.
 *
 * The database answered a trivial query, so this instance can serve traffic:
 * 200 `{ status: "ready" }`. If it did not: 503 `{ status: "not_ready" }`.
 *
 * The failure body is one word on purpose. No connection string, host, driver,
 * error code or stack ever leaves this route — a readiness probe is reachable by
 * anyone who can reach the service (D-142).
 */
export const dynamic = 'force-dynamic';

export type ReadyResponse = { status: 'ready' } | { status: 'not_ready' };

export async function GET(): Promise<NextResponse<ReadyResponse>> {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json(
      { status: 'ready' as const },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { status: 'not_ready' as const },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
