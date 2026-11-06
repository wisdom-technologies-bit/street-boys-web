import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/version';
import { getDb } from '@/server/db/client';

/**
 * GET /api/health
 *
 * A liveness probe: the app answered, and the database answered a trivial query.
 * It returns no connection string, host, driver detail, error message or stack.
 * A failing database is reported as `db: "down"` and nothing more, because a
 * health endpoint is public and an error message is a gift to an attacker.
 */
export const dynamic = 'force-dynamic';

export type HealthResponse = {
  status: 'ok';
  db: 'ok' | 'down';
  version: string;
};

export async function GET(): Promise<NextResponse<HealthResponse>> {
  let db: HealthResponse['db'] = 'ok';

  try {
    await getDb().execute(sql`select 1`);
  } catch {
    db = 'down';
  }

  return NextResponse.json(
    { status: 'ok', db, version: APP_VERSION },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
