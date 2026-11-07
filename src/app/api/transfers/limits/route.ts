import { findSessionUser } from '@/server/accounts/session';
import { errorResponse, jsonResponse } from '@/server/http/guard';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { transferErrorResponse } from '@/server/transfers/http';
import { getSendLimits } from '@/server/transfers/send';

/**
 * GET /api/transfers/limits — what this player may send right now.
 *
 * The `available` figure is computed from the same rolling window the send path
 * enforces, so the page cannot promise an amount the server will refuse.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUESTS_PER_MINUTE = 60;

export async function GET(request: Request): Promise<Response> {
  const user = await findSessionUser(request);
  if (!user) return errorResponse('unauthorized');
  if (user.status !== 'active') return errorResponse('forbidden');

  const limited = await consumeRateLimit(
    `transfer-limits:user:${user.id}`,
    REQUESTS_PER_MINUTE,
    60,
  );
  if (!limited.allowed) {
    return errorResponse('rate_limited', { 'Retry-After': String(limited.retryAfterSeconds) });
  }

  try {
    const limits = await getSendLimits(user.id);
    return jsonResponse({
      tier: limits.tier,
      minTransferKobo: limits.minTransferKobo.toString(),
      maxPerTransferKobo: limits.maxPerTransferKobo.toString(),
      maxSendPer24hKobo: limits.maxSendPer24hKobo.toString(),
      sendRemainingKobo: limits.sendRemainingKobo.toString(),
      pendingThresholdKobo: limits.pendingThresholdKobo.toString(),
      taxFreeBandKobo: limits.taxFreeBandKobo.toString(),
      taxRateBps: limits.taxRateBps,
    });
  } catch (error) {
    return transferErrorResponse(error);
  }
}
