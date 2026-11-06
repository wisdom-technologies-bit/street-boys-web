import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/version';

/**
 * GET /api/health — liveness only.
 *
 * It answers one question: is this process up and serving? It deliberately does
 * NOT touch the database (D-142). A platform that restarts the service because a
 * database is briefly unreachable turns a small outage into a restart loop, and
 * a container health check that needs the database cannot tell the two apart.
 *
 * Readiness, which does check the database, is GET /api/ready.
 */
export const dynamic = 'force-dynamic';

export type HealthResponse = {
  status: 'ok';
  version: string;
};

export function GET(): NextResponse<HealthResponse> {
  return NextResponse.json(
    { status: 'ok', version: APP_VERSION },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
