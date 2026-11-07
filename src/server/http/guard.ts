import { NextResponse } from 'next/server';
import { getEnv, requireAppOrigin } from '@/server/config/env';
import { resolveClientIp } from './client-ip';

/**
 * The request guard for the sign-in routes.
 *
 * Every state-changing auth route is guarded twice, because a cookie alone is not
 * enough against a cross-site request:
 *
 * - **Content-Type must be `application/json`.** A plain HTML form cannot set it,
 *   so a cross-site form post is refused before the body is read.
 * - **Origin must be ours.** An `Origin` header equal to `APP_ORIGIN`, or one whose
 *   host matches this request's `Host`, is accepted: the second rule is what makes
 *   a Vercel preview deployment work, where the origin is real but unknown until
 *   the branch builds.
 *
 * A missing `Origin` is a refusal, not a pass. A browser always sends one on a
 * cross-site POST, and a request from something that is not a browser has no
 * business driving a sign-in.
 */

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function jsonResponse<T>(body: T, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export type AuthErrorCode =
  | 'invalid_request'
  | 'email_not_supported'
  | 'invalid_or_expired'
  | 'rate_limited'
  | 'send_failed'
  | 'unauthorized'
  | 'forbidden';

const ERROR_STATUS: Record<AuthErrorCode, number> = {
  invalid_request: 400,
  email_not_supported: 400,
  invalid_or_expired: 400,
  rate_limited: 429,
  send_failed: 503,
  unauthorized: 401,
  forbidden: 403,
};

export function errorResponse(
  error: AuthErrorCode,
  headers: Record<string, string> = {},
): NextResponse {
  return jsonResponse({ error }, ERROR_STATUS[error], headers);
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export type GuardResult = { ok: true } | { ok: false; response: NextResponse };

/** Content-Type and Origin, for every state-changing auth route. */
export function guardMutation(request: Request): GuardResult {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { ok: false, response: errorResponse('forbidden') };
  }

  const origin = request.headers.get('origin');
  if (!origin) return { ok: false, response: errorResponse('forbidden') };

  const expected = requireAppOrigin();
  const host = request.headers.get('host');

  const sameOrigin = origin === expected;
  const sameHost = host !== null && hostOf(origin) === host;

  if (!sameOrigin && !sameHost) return { ok: false, response: errorResponse('forbidden') };
  return { ok: true };
}

/**
 * The client IP for rate limiting.
 *
 * A Next route handler has no socket address, so the forwarded chain and the
 * platform's `x-real-ip` are the only inputs. `resolveClientIp` is the single
 * place that decides which hop to trust, using `TRUSTED_PROXY_HOPS`.
 */
export function clientIpFrom(request: Request): string | null {
  const env = getEnv();
  return resolveClientIp({
    forwardedFor: request.headers.get('x-forwarded-for'),
    remoteAddress: request.headers.get('x-real-ip'),
    trustedProxyHops: env.TRUSTED_PROXY_HOPS,
  });
}
