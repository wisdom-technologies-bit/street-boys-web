import { z } from 'zod';
import { verifyCode } from '@/server/accounts/otp';
import { buildSessionCookie } from '@/server/accounts/session';
import { clientIpFrom, errorResponse, guardMutation, jsonResponse } from '@/server/http/guard';

/**
 * POST /api/auth/verify-code
 *
 * Three outcomes: `details_required` (the code was right, but this is a new
 * address and nothing is created yet), `signed_in` with a session cookie, or one
 * generic failure. The cookie is set here and nowhere else.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const detailsSchema = z.object({
  acceptTerms: z.literal(true),
  ageBand: z.enum(['under_18', '18_plus']),
});

const bodySchema = z.object({
  email: z.string().min(1).max(320),
  code: z.string().regex(/^[0-9]{6}$/),
  details: detailsSchema.optional(),
});

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

  const result = await verifyCode({
    email: parsed.data.email,
    code: parsed.data.code,
    details: parsed.data.details,
    ipHash: clientIpFrom(request),
  });

  switch (result.status) {
    case 'signed_in': {
      const cookie = buildSessionCookie(result.token);
      const serialised = [
        `${cookie.name}=${encodeURIComponent(cookie.value)}`,
        'HttpOnly',
        `Path=${cookie.options.path}`,
        `SameSite=Lax`,
        `Max-Age=${cookie.options.maxAge}`,
        ...(cookie.options.secure ? ['Secure'] : []),
      ].join('; ');

      return jsonResponse({ status: 'signed_in', hasCharacter: result.hasCharacter }, 200, {
        'Set-Cookie': serialised,
      });
    }
    case 'details_required':
      return jsonResponse({ status: 'details_required' });
    case 'email_not_supported':
      return errorResponse('email_not_supported');
    case 'rate_limited':
      return errorResponse('rate_limited', { 'Retry-After': String(result.retryAfterSeconds) });
    case 'invalid_or_expired':
      return errorResponse('invalid_or_expired');
  }
}
