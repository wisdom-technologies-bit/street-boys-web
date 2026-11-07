import { z } from 'zod';
import { findSessionUser } from '@/server/accounts/session';
import { errorResponse, guardMutation, jsonResponse } from '@/server/http/guard';
import { serializeAmount } from '@/server/ledger';
import { consumeRateLimit } from '@/server/security/rate-limit';
import {
  listTransfers,
  TRANSFER_LIST_DEFAULT_LIMIT,
  TRANSFER_LIST_MAX_LIMIT,
} from '@/server/transfers/list';
import { sendMoney } from '@/server/transfers/send';
import { transferErrorResponse } from '@/server/transfers/http';

/**
 * POST /api/transfers — send money to another player by name.
 * GET  /api/transfers — the caller's own transfers, newest first.
 *
 * The session decides who is sending; there is no `from` field, so no request can
 * send on somebody else's behalf. Amounts travel as strings of kobo in both
 * directions: JSON numbers lose precision above 2^53, and a wallet is a number a
 * player will notice being wrong.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUESTS_PER_MINUTE = 60;

const bodySchema = z.object({
  toName: z.string().trim().min(1).max(32),
  amountKobo: z.string().regex(/^\d{1,15}$/),
  idempotencyKey: z.uuid(),
});

export async function POST(request: Request): Promise<Response> {
  const guard = guardMutation(request);
  if (!guard.ok) return guard.response;

  const user = await findSessionUser(request);
  if (!user) return errorResponse('unauthorized');
  if (user.status !== 'active') return errorResponse('forbidden');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid_request');
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse('invalid_request');

  try {
    const result = await sendMoney({
      senderUserId: user.id,
      toName: parsed.data.toName,
      amountKobo: BigInt(parsed.data.amountKobo),
      idempotencyKey: parsed.data.idempotencyKey,
    });

    return jsonResponse(
      {
        transfer: {
          id: result.id,
          status: result.status,
          amountKobo: result.amountKobo.toString(),
          taxKobo: result.taxKobo.toString(),
          releaseAt: result.releaseAt ? result.releaseAt.toISOString() : null,
          balanceKobo: result.balanceKobo.toString(),
          replayed: result.replayed,
        },
      },
      201,
    );
  } catch (error) {
    return transferErrorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  const user = await findSessionUser(request);
  if (!user) return errorResponse('unauthorized');
  if (user.status !== 'active') return errorResponse('forbidden');

  const limited = await consumeRateLimit(`transfers:user:${user.id}`, REQUESTS_PER_MINUTE, 60);
  if (!limited.allowed) {
    return errorResponse('rate_limited', { 'Retry-After': String(limited.retryAfterSeconds) });
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const before = url.searchParams.get('before');

  const limit = rawLimit === null ? TRANSFER_LIST_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > TRANSFER_LIST_MAX_LIMIT) {
    return errorResponse('invalid_request');
  }
  if (before !== null && !z.uuid().safeParse(before).success)
    return errorResponse('invalid_request');

  try {
    const page = await listTransfers(user.id, { limit, before });
    return jsonResponse({
      transfers: page.transfers.map((transfer) => ({
        id: transfer.id,
        at: transfer.at.toISOString(),
        toName: transfer.toName,
        amountKobo: transfer.amountKobo.toString(),
        taxKobo: transfer.taxKobo.toString(),
        status: transfer.status,
        releaseAt: transfer.releaseAt ? transfer.releaseAt.toISOString() : null,
      })),
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    return transferErrorResponse(error);
  }
}
