import { findSessionUser } from '@/server/accounts/session';
import { errorResponse, jsonResponse } from '@/server/http/guard';
import { serializeAmount } from '@/server/ledger';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { getWallet } from '@/server/wallet';
import { formatNaira } from '@/shared/money-format';

/**
 * GET /api/wallet — the caller's own balance, and nothing else.
 *
 * There is no `userId` parameter, on purpose: the account is whichever one belongs to
 * the session, so there is no request shape that could ask for somebody else's money.
 *
 * Two shapes come back:
 *
 * - `{ balanceKobo, formatted, restricted }` — the amount as a string (JSON has no
 *   bigint, and a number would lose precision), the same amount as a player reads it,
 *   and whether the account is restricted;
 * - `{ setupPending: true }` — the wallet is not ready. That is not an error from the
 *   player's point of view, so it is a 200 and the page says "one moment".
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUESTS_PER_MINUTE = 60;

export async function GET(request: Request): Promise<Response> {
  const user = await findSessionUser(request);
  if (!user) return errorResponse('unauthorized');
  if (user.status !== 'active') return errorResponse('forbidden');

  const limited = await consumeRateLimit(`wallet:user:${user.id}`, REQUESTS_PER_MINUTE, 60);
  if (!limited.allowed) {
    return errorResponse('rate_limited', { 'Retry-After': String(limited.retryAfterSeconds) });
  }

  const wallet = await getWallet(user.id);
  if ('setupPending' in wallet) return jsonResponse({ setupPending: true });

  return jsonResponse({
    balanceKobo: serializeAmount(wallet.balanceKobo),
    formatted: formatNaira(wallet.balanceKobo),
    restricted: wallet.restricted,
  });
}
