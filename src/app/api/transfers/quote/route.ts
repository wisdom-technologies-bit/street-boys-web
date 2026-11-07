import { z } from 'zod';
import { findSessionUser } from '@/server/accounts/session';
import { errorResponse, jsonResponse } from '@/server/http/guard';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { transferErrorResponse } from '@/server/transfers/http';
import { quoteTransfer } from '@/server/transfers/send';

/**
 * POST /api/transfers/quote — what a send would cost, before the player commits.
 *
 * The tax is shown up front because it is charged on top: a player who types
 * 60,000 and sees 60,200 leave is not surprised later.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUESTS_PER_MINUTE = 60;

const bodySchema = z.object({
  toName: z.string().trim().min(1).max(32),
  amountKobo: z.string().regex(/^\d{1,15}$/),
});

export async function POST(request: Request): Promise<Response> {
  const user = await findSessionUser(request);
  if (!user) return errorResponse('unauthorized');
  if (user.status !== 'active') return errorResponse('forbidden');

  const limited = await consumeRateLimit(`transfer-quote:user:${user.id}`, REQUESTS_PER_MINUTE, 60);
  if (!limited.allowed) {
    return errorResponse('rate_limited', { 'Retry-After': String(limited.retryAfterSeconds) });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid_request');
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse('invalid_request');

  try {
    const quote = await quoteTransfer({
      senderUserId: user.id,
      toName: parsed.data.toName,
      amountKobo: BigInt(parsed.data.amountKobo),
    });

    return jsonResponse({
      amountKobo: quote.amountKobo.toString(),
      taxKobo: quote.taxKobo.toString(),
      totalKobo: quote.totalKobo.toString(),
      willBePending: quote.willBePending,
      releaseAt: quote.releaseAt ? quote.releaseAt.toISOString() : null,
      sendRemainingKobo: quote.sendRemainingKobo.toString(),
    });
  } catch (error) {
    return transferErrorResponse(error);
  }
}
