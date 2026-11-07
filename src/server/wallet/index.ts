import { findUserById } from '@/server/accounts/repository';
import { getEconomyParams, type EconomyParams } from '@/server/config/economy-params';
import {
  buildIdempotencyKey,
  listStatement,
  type StatementEntry,
  createPlayerAccount,
  getAccountByCode,
  getBalance,
  getPlayerAccount,
  postTransaction,
  type Kobo,
} from '@/server/ledger';
import { logEvent } from '@/server/security/audit';

/**
 * Every player's wallet: one ledger account and one starting grant.
 *
 * The wallet is not a table. A wallet is what a player has when the ledger holds an
 * account for them with a starting balance in it, and this module is the only place
 * that sets that up. Everything that moves money afterwards goes through the ledger's
 * public API; nothing here writes a balance or computes a stored total.
 *
 * Two properties make it safe to call from anywhere, any number of times:
 *
 * - **One account per user.** `createPlayerAccount` is idempotent (a unique index on
 *   `accounts.owner_user_id` and a resolved insert), so a race produces one account.
 * - **One grant per user.** The grant carries the idempotency key
 *   `onboarding-grant:<userId>`, derived from the action rather than a clock, so a
 *   retry, a concurrent call, or a backfill replays instead of paying twice.
 *
 * That combination is why every caller may simply call `ensureWallet` and not ask
 * whether the wallet already exists.
 */

/** Why a wallet cannot exist. Carries no personal data: a reason and nothing else. */
export class WalletUnavailable extends Error {
  constructor(readonly reason: 'not_found' | 'not_active') {
    super(
      reason === 'not_found'
        ? 'there is no user with that id'
        : 'only an active user may have a wallet',
    );
    this.name = 'WalletUnavailable';
  }
}

export type EnsureWalletResult = {
  accountId: string;
  /** True when the grant had already been posted and this call changed nothing. */
  replayed: boolean;
};

export type WalletSnapshot = { balanceKobo: Kobo; restricted: boolean } | { setupPending: true };

/**
 * Make sure this user has a wallet, and return which account it is.
 *
 * Order matters: the user is checked first, so a banned user never gets an account
 * created on the way to being refused, and the grant is posted only after the account
 * exists, because the entries have to name it.
 *
 * `options.params` exists for tests and for the admin tool that will tune the
 * economy: production callers omit it and get the file of record.
 */
export async function ensureWallet(
  userId: string,
  options: { params?: EconomyParams } = {},
): Promise<EnsureWalletResult> {
  const user = await findUserById(userId);
  if (!user) throw new WalletUnavailable('not_found');
  if (user.status !== 'active') throw new WalletUnavailable('not_active');

  const params = options.params ?? getEconomyParams();

  const before = await getPlayerAccount(userId);
  const account = await createPlayerAccount(userId);

  if (before === null) {
    await logEvent({ eventType: 'wallet.created', metadata: { userId, accountId: account.id } });
  }

  if (params.startingBalanceKobo <= 0n) return { accountId: account.id, replayed: false };

  const mint = await getAccountByCode('SYSTEM_MINT');
  if (!mint) throw new Error('SYSTEM_MINT is missing: run npm run ledger:verify');

  const posted = await postTransaction({
    idempotencyKey: buildIdempotencyKey('onboarding-grant', userId),
    category: 'onboarding_grant',
    metadata: { economyParamsVersion: params.version },
    entries: [
      { accountId: mint.id, amountKobo: -params.startingBalanceKobo },
      { accountId: account.id, amountKobo: params.startingBalanceKobo },
    ],
  });

  return { accountId: account.id, replayed: posted.replayed };
}

/**
 * What a page needs to draw a wallet: the balance and whether it is restricted.
 *
 * **Heal on read.** This calls `ensureWallet` first, so a player whose wallet failed
 * to set up when they created a character gets one now, without anybody running a
 * script. It never throws into a page: a failure becomes `{ setupPending: true }`,
 * which the page renders as "we are setting up your wallet", because a page that
 * crashes because a balance is missing is worse than a page that says "one moment".
 */
export async function getWallet(userId: string): Promise<WalletSnapshot> {
  try {
    const { accountId } = await ensureWallet(userId);
    const [balanceKobo, account] = await Promise.all([
      getBalance(accountId),
      getPlayerAccount(userId),
    ]);

    return { balanceKobo, restricted: account?.frozen === true };
  } catch (error) {
    await logEvent({
      eventType: 'wallet.setup_failed',
      metadata: {
        userId,
        reason: error instanceof WalletUnavailable ? error.reason : 'setup_failed',
      },
    });
    return { setupPending: true };
  }
}

export type WalletOverview = {
  wallet: WalletSnapshot;
  entries: StatementEntry[];
  nextCursor: string | null;
};

/**
 * Everything a money screen needs in one read: the balance and the first page of the
 * statement.
 *
 * A page calls this rather than `getWallet` and `listStatement` separately, so the two
 * cannot disagree about whether the wallet exists, and so a failure produces one
 * "setting up" answer instead of a balance with no statement under it.
 */
export async function getWalletOverview(userId: string, limit = 20): Promise<WalletOverview> {
  try {
    const { accountId } = await ensureWallet(userId);
    const [balanceKobo, account, page] = await Promise.all([
      getBalance(accountId),
      getPlayerAccount(userId),
      listStatement(accountId, { limit }),
    ]);

    return {
      wallet: { balanceKobo, restricted: account?.frozen === true },
      entries: page.entries,
      nextCursor: page.nextCursor,
    };
  } catch {
    return { wallet: { setupPending: true }, entries: [], nextCursor: null };
  }
}

/** A statement entry as the pages and the API hand it to the browser. */
export function toStatementLine(entry: StatementEntry): {
  id: string;
  at: string;
  amountKobo: string;
  balanceAfterKobo: string;
  category: string;
} {
  return {
    id: entry.id.toString(),
    at: entry.createdAt.toISOString(),
    amountKobo: entry.amountKobo.toString(),
    balanceAfterKobo: entry.balanceAfterKobo.toString(),
    category: entry.category,
  };
}
