/**
 * The transfer vocabulary.
 *
 * These are the reasons a player can be told about, and the route layer maps each
 * one to a status code. A player-facing refusal never carries a database detail and
 * never names another account: the receiver's problems all collapse into one code
 * (D-164), because "no such player" and "that player may not receive" must not be
 * distinguishable from outside.
 */
export type TransferErrorCode =
  | 'invalid_request'
  | 'receiver_unavailable'
  | 'idempotency_conflict'
  | 'not_cancellable'
  | 'insufficient_funds'
  | 'send_limit_exceeded'
  | 'below_minimum'
  | 'above_maximum'
  | 'rate_limited'
  | 'forbidden'
  | 'not_found';

export class TransferError extends Error {
  constructor(
    readonly code: TransferErrorCode,
    message: string,
    /** Set for `rate_limited`: how long the caller should wait. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TransferError';
  }
}

/** One generic refusal for every receiver-side problem. */
export function receiverUnavailable(): TransferError {
  return new TransferError('receiver_unavailable', 'that player cannot receive money right now');
}
