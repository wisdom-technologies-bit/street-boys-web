import { clearedSessionCookie, revokeSession } from '@/server/accounts/session';
import { NO_STORE, guardMutation } from '@/server/http/guard';

/**
 * POST /api/auth/logout
 *
 * Idempotent: signing out twice is not an error, and an unknown cookie is still
 * a successful sign-out. The cookie is cleared either way, because a client stuck
 * with a dead cookie is a support ticket.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const guard = guardMutation(request);
  if (!guard.ok) return guard.response;

  await revokeSession(request);

  const cookie = clearedSessionCookie();
  const serialised = [
    `${cookie.name}=`,
    'HttpOnly',
    `Path=${cookie.options.path}`,
    'SameSite=Lax',
    'Max-Age=0',
    ...(cookie.options.secure ? ['Secure'] : []),
  ].join('; ');

  // 204 has no body, so this is a bare Response rather than a JSON one.
  return new Response(null, { status: 204, headers: { ...NO_STORE, 'Set-Cookie': serialised } });
}
