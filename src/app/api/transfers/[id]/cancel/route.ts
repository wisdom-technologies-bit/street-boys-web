import { z } from 'zod';
import { findSessionUser } from '@/server/accounts/session';
import { errorResponse, guardMutation, jsonResponse } from '@/server/http/guard';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { cancelTransfer } from '@/server/transfers/cancel';
import { transferErrorResponse } from '@/server/transfers/http';

/**
 * POST /api/transfers/{id}/cancel — take back a pending transfer.
 *
 * Only the sender can, and only while the money is in escrow. Somebody else's id
 * answers 404 with the same body as an id that does not exist.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUESTS_PER_MINUTE = 30;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = guardMutation(request);
  if (!guard.ok) return guard.response;

  const user = await findSessionUser(request);
  if (!user) return errorResponse('unauthorized');
  if (user.status !== 'active') return errorResponse('forbidden');

  const limited = await consumeRateLimit(
    `transfer-cancel:user:${user.id}`,
    REQUESTS_PER_MINUTE,
    60,
  );
  if (!limited.allowed) {
    return errorResponse('rate_limited', { 'Retry-After': String(limited.retryAfterSeconds) });
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return errorResponse('invalid_request');

  try {
    const result = await cancelTransfer({ senderUserId: user.id, transferId: id });
    return jsonResponse({
      transfer: { id: result.id, status: result.status, replayed: result.replayed },
    });
  } catch (error) {
    return transferErrorResponse(error);
  }
}
