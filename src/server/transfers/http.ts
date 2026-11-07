import { jsonResponse } from '@/server/http/guard';
import { TransferError, type TransferErrorCode } from './errors';

/**
 * How a transfer refusal becomes an HTTP answer.
 *
 * The mapping lives here, once, so five routes cannot disagree about it, and so the
 * generic receiver answer stays generic. Refusals never carry a stack, a constraint
 * name or another account: `{ error: code }` and, for a rate limit, `Retry-After`.
 */
const STATUS: Record<TransferErrorCode, number> = {
  invalid_request: 400,
  below_minimum: 400,
  above_maximum: 400,
  receiver_unavailable: 404,
  not_found: 404,
  idempotency_conflict: 409,
  insufficient_funds: 409,
  send_limit_exceeded: 409,
  not_cancellable: 409,
  forbidden: 403,
  rate_limited: 429,
};

export function transferErrorResponse(error: unknown): Response {
  if (!(error instanceof TransferError)) {
    // Anything unexpected is a server problem; the caller is told nothing useful.
    return jsonResponse({ error: 'invalid_request' }, 500);
  }

  const headers: Record<string, string> =
    error.code === 'rate_limited' && error.retryAfterSeconds
      ? { 'Retry-After': String(error.retryAfterSeconds) }
      : {};

  return jsonResponse({ error: error.code }, STATUS[error.code], headers);
}
