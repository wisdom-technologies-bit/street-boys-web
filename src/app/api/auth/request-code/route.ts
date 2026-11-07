import { z } from 'zod';
import { requestCode } from '@/server/accounts/otp';
import { clientIpFrom, errorResponse, guardMutation, jsonResponse } from '@/server/http/guard';

/**
 * POST /api/auth/request-code
 *
 * The answer is always `{ status: "sent" }` for anything that was accepted, no
 * matter whether an account exists, so this route cannot be used to discover
 * who is registered.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ email: z.string().min(1).max(320) });

export async function POST(request: Request): Promise<Response> {
  const guard = guardMutation(request);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid_request');
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse('invalid_request');

  const result = await requestCode({ email: parsed.data.email, ipHash: clientIpFrom(request) });

  switch (result.status) {
    case 'sent':
      return jsonResponse({ status: 'sent' });
    case 'email_not_supported':
      return errorResponse('email_not_supported');
    case 'rate_limited':
      return errorResponse('rate_limited', { 'Retry-After': String(result.retryAfterSeconds) });
    case 'send_failed':
      return errorResponse('send_failed');
  }
}
