import { getPool } from '@/server/db/client';
import type { Avatar } from '@/server/config/avatar-options';
import { getCurrentUser } from '@/server/accounts/session';
import { errorResponse, jsonResponse } from '@/server/http/guard';

/**
 * GET /api/me
 *
 * Who is signed in, and the one thing a client needs to route them: whether a
 * character exists yet. A read-only route: no guard on Origin, because a GET does
 * not change anything, and the cookie is not sent cross-site by a form.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type MeResponse = {
  id: string;
  email: string;
  status: 'active' | 'frozen' | 'banned';
  verificationLevel: number;
  ageBand: string | null;
  character: { name: string; avatar: Avatar } | null;
};

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser(request);
  if (!user) return errorResponse('unauthorized');

  const { rows } = await getPool().query<{ name: string; avatar: Avatar }>(
    `select name, avatar from characters where user_id = $1 limit 1`,
    [user.id],
  );
  const character = rows[0] ? { name: rows[0].name, avatar: rows[0].avatar } : null;

  const body: MeResponse = {
    id: user.id,
    email: user.email,
    status: user.status,
    verificationLevel: user.verificationLevel,
    ageBand: user.ageBand,
    character,
  };

  return jsonResponse(body);
}
