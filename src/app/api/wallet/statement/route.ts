import { findSessionUser } from '@/server/accounts/session';
import { errorResponse, jsonResponse } from '@/server/http/guard';
import {
  listStatement,
  serializeAmount,
  STATEMENT_DEFAULT_LIMIT,
  STATEMENT_MAX_LIMIT,
} from '@/server/ledger';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { ensureWallet } from '@/server/wallet';

/**
 * GET /api/wallet/statement — the caller's own entries, newest first.
 *
 * Each line carries what the ledger recorded: when, how much (signed), the balance it
 * left, and a category. No counterparty, no metadata and no other account's id,
 * because a statement is the player's record of their own money and a way to learn
 * who else is playing would be a way to target them.
 *
 * Paging is by cursor (`before=<entry id>`), not offset: the ledger only appends, so
 * an id cursor cannot skip or repeat a line while the player is reading.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUESTS_PER_MINUTE = 30;

export async function GET(request: Request): Promise<Response> {
  const user = await findSessionUser(request);
  if (!user) return errorResponse('unauthorized');
  if (user.status !== 'active') return errorResponse('forbidden');

  const limited = await consumeRateLimit(
    `wallet-statement:user:${user.id}`,
    REQUESTS_PER_MINUTE,
    60,
  );
  if (!limited.allowed) {
    return errorResponse('rate_limited', { 'Retry-After': String(limited.retryAfterSeconds) });
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const before = url.searchParams.get('before');

  const limit = rawLimit === null ? STATEMENT_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > STATEMENT_MAX_LIMIT) {
    return errorResponse('invalid_request');
  }
  if (before !== null && !/^\d+$/.test(before)) return errorResponse('invalid_request');

  let accountId: string;
  try {
    accountId = (await ensureWallet(user.id)).accountId;
  } catch {
    // The page reads the wallet first and shows its own "one moment" message; this
    // route answers in the same vocabulary rather than a 500 nobody can act on.
    return jsonResponse({ entries: [], nextCursor: null, setupPending: true });
  }

  const page = await listStatement(accountId, { limit, beforeEntryId: before });

  return jsonResponse({
    entries: page.entries.map((entry) => ({
      id: entry.id.toString(),
      at: entry.createdAt.toISOString(),
      amountKobo: serializeAmount(entry.amountKobo),
      balanceAfterKobo: serializeAmount(entry.balanceAfterKobo),
      category: entry.category,
    })),
    nextCursor: page.nextCursor,
  });
}
