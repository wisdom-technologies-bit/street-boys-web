import type { PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalizeName } from '@/server/accounts/character';
import {
  pendingDelayMs,
  TRANSFER_PARAMS,
  type TransferTier,
} from '@/server/config/transfer-params';
import { getPool } from '@/server/db/client';
import { getAccountByCode, getBalance, getPlayerAccount, postTransaction } from '@/server/ledger';
import { InsufficientFunds, IdempotencyConflict } from '@/server/ledger';
import { logEvent } from '@/server/security/audit';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { receiverUnavailable, TransferError } from './errors';
import { rollingTotals, sendRemaining } from './limits';
import { calculateTax, totalDebit } from './tax';
import { resolveTier } from './tiers';

/**
 * Sending money to another player.
 *
 * One database transaction does everything that must agree: the `transfers` row,
 * both users locked in id order, the rolling-24-hour sums, and the ledger postings.
 * The ledger is called with the caller's client (the joined API from step 2), so a
 * failure at any point leaves no transfer row and no money moved.
 *
 * The money story has three shapes:
 *
 * - **instant**: below the tier's pending threshold, `transfer` moves the amount to
 *   the receiver and `transfer_tax` moves the tax to TREASURY;
 * - **pending**: at or above it, one `escrow_hold` moves amount plus tax to
 *   ESCROW_TRANSFERS and nothing else happens until the release job or a cancel;
 * - **refused**: insufficient funds writes no transfer row at all, so a player who is
 *   short sees an error and no history entry to puzzle over.
 */

export type TransferStatus = 'completed' | 'pending' | 'cancelled' | 'held';

export type TransferResult = {
  id: string;
  status: TransferStatus;
  amountKobo: bigint;
  taxKobo: bigint;
  releaseAt: Date | null;
  /** The sender's balance after the transfer, in kobo. */
  balanceKobo: bigint;
  replayed: boolean;
};

export type SendMoneyInput = {
  senderUserId: string;
  toName: string;
  amountKobo: bigint;
  idempotencyKey: string;
};

export type QuoteInput = { senderUserId: string; toName: string; amountKobo: bigint };

export type TransferQuote = {
  amountKobo: bigint;
  taxKobo: bigint;
  totalKobo: bigint;
  willBePending: boolean;
  releaseAt: Date | null;
  sendRemainingKobo: bigint;
};

const inputSchema = z.object({
  senderUserId: z.uuid(),
  toName: z.string().trim().min(1).max(32),
  amountKobo: z.bigint(),
  idempotencyKey: z.uuid(),
});

type SenderRow = {
  id: string;
  status: string;
  created_at: Date;
  verification_level: number;
  account_id: string | null;
  has_character: boolean;
};

type ReceiverRow = {
  id: string;
  status: string;
  created_at: Date;
  verification_level: number;
  account_id: string | null;
  display_name: string;
};

// The wallet is looked up through the ledger's public API, never by naming its tables
// here: the boundary test enforces that (AGENTS.md 3.2).
const SENDER_SQL = `select u.id, u.status, u.created_at, u.verification_level,
                            exists (select 1 from characters c where c.user_id = u.id) as has_character
                       from users u where u.id = $1`;

const RECEIVER_SQL = `select u.id, u.status, u.created_at, u.verification_level,
                             c.name as display_name
                        from users u join characters c on c.user_id = u.id
                       where c.name_canonical = $1`;

const RETRYABLE = new Set(['40P01', '40001']); // deadlock, serialization failure

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A validated send. Everything below assumes a sane sender, amount and key. */
export async function sendMoney(input: SendMoneyInput): Promise<TransferResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new TransferError('invalid_request', 'the transfer is not valid');
  const request = parsed.data;

  if (request.amountKobo <= 0n) {
    throw new TransferError('invalid_request', 'a transfer needs a positive amount');
  }

  await assertRateLimit(request.senderUserId);

  // Three attempts: the first, then two retries. A deadlock here means two players
  // paid each other at the same instant, which is common and must not surface.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await sendOnce(request, attempt === 1);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const retryable = typeof code === 'string' && RETRYABLE.has(code);
      if (!retryable || attempt >= 3) throw asTransferError(error);
      await sleep(Math.floor(Math.random() * 25 * attempt) + 5);
    }
  }
}

function asTransferError(error: unknown): unknown {
  if (error instanceof InsufficientFunds) {
    return new TransferError('insufficient_funds', 'there is not enough money in the wallet');
  }
  if (error instanceof IdempotencyConflict) {
    return new TransferError('idempotency_conflict', 'that request was already used differently');
  }
  return error;
}

async function assertRateLimit(userId: string): Promise<void> {
  const { sendsPerMinute, sendsPerHour } = TRANSFER_PARAMS.rateLimits;

  const minute = await consumeRateLimit(`transfer:send:minute:${userId}`, sendsPerMinute, 60);
  if (!minute.allowed) {
    throw new TransferError('rate_limited', 'too many transfers at once', minute.retryAfterSeconds);
  }
  const hour = await consumeRateLimit(`transfer:send:hour:${userId}`, sendsPerHour, 3_600);
  if (!hour.allowed) {
    throw new TransferError('rate_limited', 'too many transfers this hour', hour.retryAfterSeconds);
  }
}

async function sendOnce(
  request: z.infer<typeof inputSchema>,
  audit: boolean,
): Promise<TransferResult> {
  const client = await getPool().connect();
  try {
    await client.query('begin');

    const sender = await loadSender(client, request.senderUserId);
    const receiver = await loadReceiver(client, request.toName);

    if (sender.id === receiver.id) {
      throw new TransferError('invalid_request', 'you cannot send money to yourself');
    }

    // Both users locked in id order: A to B and B to A at the same time queue
    // instead of deadlocking, the same rule the ledger uses for balances.
    await client.query('select id from users where id = any($1::uuid[]) order by id for update', [
      [sender.id, receiver.id],
    ]);

    const replay = await findReplay(client, request, receiver);
    if (replay) {
      await client.query('commit');
      return replay;
    }

    const { tier } = resolveTier(
      { createdAt: sender.created_at, verificationLevel: sender.verification_level },
      new Date(),
    );

    if (request.amountKobo < TRANSFER_PARAMS.minTransferKobo) {
      throw new TransferError('below_minimum', 'that amount is below the smallest transfer');
    }
    if (request.amountKobo > tier.maxPerTransferKobo) {
      throw new TransferError('above_maximum', 'that amount is above what your tier may send');
    }

    const taxKobo = calculateTax(request.amountKobo);
    const debitKobo = request.amountKobo + taxKobo;

    const senderTotals = await rollingTotals(client, sender.id);
    if (senderTotals.sentKobo + debitKobo > tier.maxSendPer24hKobo) {
      throw new TransferError('send_limit_exceeded', 'that would go over your daily limit');
    }

    // The receiver's limit is checked, but never described: any receiver-side
    // refusal is the same generic error (D-164).
    const { tier: receiverTier } = resolveTier({
      createdAt: receiver.created_at,
      verificationLevel: receiver.verification_level,
    });
    const receiverTotals = await rollingTotals(client, receiver.id);
    if (receiverTotals.receivedKobo + request.amountKobo > receiverTier.maxReceivePer24hKobo) {
      throw receiverUnavailable();
    }

    const pending = request.amountKobo >= tier.pendingThresholdKobo;
    const now = new Date();
    const releaseAt = pending ? new Date(now.getTime() + pendingDelayMs(tier)) : null;

    const { rows } = await client.query<{ id: string }>(
      `insert into transfers
         (sender_user_id, receiver_user_id, amount_kobo, tax_kobo, status, idempotency_key,
          created_at, release_at, resolved_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        sender.id,
        receiver.id,
        request.amountKobo.toString(),
        taxKobo.toString(),
        pending ? 'pending' : 'completed',
        request.idempotencyKey,
        now,
        releaseAt,
        pending ? null : now,
      ],
    );
    const transferId = rows[0]?.id;
    if (!transferId) throw new Error('transfer insert returned no row');

    const balanceKobo = pending
      ? await hold(client, transferId, sender, receiver, request.amountKobo, taxKobo)
      : await settleInstantly(client, transferId, sender, receiver, request.amountKobo, taxKobo);

    await client.query('commit');

    if (audit) {
      // Ids and amounts only. Never a name, never an email (AGENTS.md 5).
      await logEvent({
        eventType: pending ? 'transfer.pending' : 'transfer.sent',
        actorUserId: sender.id,
        metadata: {
          transferId,
          amountKobo: request.amountKobo.toString(),
          taxKobo: taxKobo.toString(),
        },
      }).catch(() => {
        // The transfer happened; a failed audit write is a monitoring problem, not a
        // reason to tell the sender it did not.
      });
    }

    return {
      id: transferId,
      status: pending ? 'pending' : 'completed',
      amountKobo: request.amountKobo,
      taxKobo,
      releaseAt,
      balanceKobo,
      replayed: false,
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function loadSender(client: PoolClient, userId: string): Promise<SenderRow> {
  const { rows } = await client.query<SenderRow>(SENDER_SQL, [userId]);
  const sender = rows[0];
  if (!sender) throw new TransferError('forbidden', 'there is no account to send from');

  if (sender.status === 'banned') throw new TransferError('forbidden', 'this account is banned');
  if (sender.status === 'frozen') throw new TransferError('forbidden', 'this account is frozen');
  const wallet = await getPlayerAccount(sender.id);
  if (!sender.has_character || !wallet) {
    throw new TransferError('invalid_request', 'this account cannot send money yet');
  }
  return { ...sender, account_id: wallet.id };
}

async function loadReceiver(client: PoolClient, toName: string): Promise<ReceiverRow> {
  const { rows } = await client.query<ReceiverRow>(RECEIVER_SQL, [canonicalizeName(toName)]);
  const receiver = rows[0];
  if (!receiver || receiver.status !== 'active') throw receiverUnavailable();
  const wallet = await getPlayerAccount(receiver.id);
  // Not found, banned, frozen and wallet-less are one answer on purpose.
  if (!wallet) throw receiverUnavailable();
  return { ...receiver, account_id: wallet.id };
}

/**
 * The original transfer for this key, if the sender already made one.
 *
 * Same key and same payload is the retry the client is entitled to; same key with a
 * different amount or receiver is a bug at the call site.
 */
async function findReplay(
  client: PoolClient,
  request: z.infer<typeof inputSchema>,
  receiver: ReceiverRow,
): Promise<TransferResult | null> {
  const { rows } = await client.query<{
    id: string;
    status: TransferStatus;
    amount_kobo: string;
    tax_kobo: string;
    release_at: Date | null;
    receiver_user_id: string;
  }>(
    `select id, status, amount_kobo, tax_kobo, release_at, receiver_user_id
       from transfers where sender_user_id = $1 and idempotency_key = $2`,
    [request.senderUserId, request.idempotencyKey],
  );

  const existing = rows[0];
  if (!existing) return null;

  if (
    BigInt(existing.amount_kobo) !== request.amountKobo ||
    existing.receiver_user_id !== receiver.id
  ) {
    throw new TransferError('idempotency_conflict', 'that request was already used differently');
  }

  const sender = await loadSender(client, request.senderUserId);
  const currentBalance = await getBalance(sender.account_id as string);

  return {
    id: existing.id,
    status: existing.status,
    amountKobo: BigInt(existing.amount_kobo),
    taxKobo: BigInt(existing.tax_kobo),
    releaseAt: existing.release_at,
    balanceKobo: currentBalance,
    replayed: true,
  };
}

/** Below the pending threshold: the receiver is paid and the tax goes to TREASURY. */
async function settleInstantly(
  client: PoolClient,
  transferId: string,
  sender: SenderRow,
  receiver: ReceiverRow,
  amountKobo: bigint,
  taxKobo: bigint,
): Promise<bigint> {
  const senderAccount = sender.account_id as string;
  const receiverAccount = receiver.account_id as string;

  const posted = await postTransaction({
    client,
    idempotencyKey: `transfer:${transferId}:main`,
    category: 'transfer',
    actorUserId: sender.id,
    metadata: { transferId },
    entries: [
      { accountId: senderAccount, amountKobo: -amountKobo },
      { accountId: receiverAccount, amountKobo },
    ],
  });

  if (taxKobo > 0n) {
    const treasury = await getAccountByCode('TREASURY');
    if (!treasury) throw new Error('TREASURY is missing; did the migration run?');
    await postTransaction({
      client,
      idempotencyKey: `transfer:${transferId}:tax`,
      category: 'transfer_tax',
      actorUserId: sender.id,
      metadata: { transferId },
      entries: [
        { accountId: senderAccount, amountKobo: -taxKobo },
        { accountId: treasury.id, amountKobo: taxKobo },
      ],
    });
  }

  return posted.balances.find((entry) => entry.accountId === senderAccount)?.balanceKobo ?? 0n;
}

/**
 * At or above the threshold: one hold into escrow.
 *
 * The tax is held with the amount, because the sender has paid it either way. It is
 * split on release, which is the only moment the money could still go back.
 */
async function hold(
  client: PoolClient,
  transferId: string,
  sender: SenderRow,
  receiver: ReceiverRow,
  amountKobo: bigint,
  taxKobo: bigint,
): Promise<bigint> {
  const senderAccount = sender.account_id as string;
  const escrow = await getAccountByCode('ESCROW_TRANSFERS');
  if (!escrow) throw new Error('ESCROW_TRANSFERS is missing; did the migration run?');

  void receiver;
  const posted = await postTransaction({
    client,
    idempotencyKey: `transfer:${transferId}:hold`,
    category: 'escrow_hold',
    actorUserId: sender.id,
    metadata: { transferId },
    entries: [
      { accountId: senderAccount, amountKobo: -(amountKobo + taxKobo) },
      { accountId: escrow.id, amountKobo: amountKobo + taxKobo },
    ],
  });

  return posted.balances.find((entry) => entry.accountId === senderAccount)?.balanceKobo ?? 0n;
}

/** What a transfer would cost, without moving anything. */
export async function quoteTransfer(input: QuoteInput): Promise<TransferQuote> {
  const sender = await loadSenderFromPool(input.senderUserId);
  const { tier } = resolveTier({
    createdAt: sender.created_at,
    verificationLevel: sender.verification_level,
  });

  const amountKobo = input.amountKobo;
  if (amountKobo <= 0n) throw new TransferError('invalid_request', 'the amount must be positive');
  if (amountKobo < TRANSFER_PARAMS.minTransferKobo) {
    throw new TransferError('below_minimum', 'that amount is below the smallest transfer');
  }
  if (amountKobo > tier.maxPerTransferKobo) {
    throw new TransferError('above_maximum', 'that amount is above what your tier may send');
  }

  const receiver = await loadReceiverFromPool(input.toName);
  void receiver;

  const taxKobo = calculateTax(amountKobo);
  const totals = await rollingTotals(getPool(), sender.id);
  const pending = amountKobo >= tier.pendingThresholdKobo;

  return {
    amountKobo,
    taxKobo,
    totalKobo: totalDebit(amountKobo),
    willBePending: pending,
    releaseAt: pending ? new Date(Date.now() + pendingDelayMs(tier)) : null,
    sendRemainingKobo: sendRemaining(tier, totals),
  };
}

async function loadSenderFromPool(userId: string): Promise<SenderRow> {
  const { rows } = await getPool().query<SenderRow>(SENDER_SQL, [userId]);
  const sender = rows[0];
  if (!sender) throw new TransferError('forbidden', 'there is no account to send from');
  if (sender.status !== 'active') throw new TransferError('forbidden', 'this account cannot send');
  const wallet = await getPlayerAccount(sender.id);
  return { ...sender, account_id: wallet?.id ?? null };
}

async function loadReceiverFromPool(toName: string): Promise<ReceiverRow> {
  const { rows } = await getPool().query<ReceiverRow>(RECEIVER_SQL, [canonicalizeName(toName)]);
  const receiver = rows[0];
  if (!receiver || receiver.status !== 'active') throw receiverUnavailable();
  const wallet = await getPlayerAccount(receiver.id);
  if (!wallet) throw receiverUnavailable();
  return { ...receiver, account_id: wallet.id };
}

export type SendLimits = {
  tier: string;
  minTransferKobo: bigint;
  maxPerTransferKobo: bigint;
  maxSendPer24hKobo: bigint;
  sendRemainingKobo: bigint;
  pendingThresholdKobo: bigint;
  taxFreeBandKobo: bigint;
  taxRateBps: number;
};

/** What this player may send right now, for the send page's own guard rails. */
export async function getSendLimits(userId: string): Promise<SendLimits> {
  const sender = await loadSenderFromPool(userId);
  const { tier } = resolveTier({
    createdAt: sender.created_at,
    verificationLevel: sender.verification_level,
  });
  const totals = await rollingTotals(getPool(), sender.id);

  return {
    tier: tier.name,
    minTransferKobo: TRANSFER_PARAMS.minTransferKobo,
    maxPerTransferKobo: tier.maxPerTransferKobo,
    maxSendPer24hKobo: tier.maxSendPer24hKobo,
    sendRemainingKobo: sendRemaining(tier, totals),
    pendingThresholdKobo: tier.pendingThresholdKobo,
    taxFreeBandKobo: TRANSFER_PARAMS.taxBands[0]?.upToKobo ?? 0n,
    taxRateBps: TRANSFER_PARAMS.taxBands[1]?.rateBps ?? 0,
  };
}

export type { TransferTier };
