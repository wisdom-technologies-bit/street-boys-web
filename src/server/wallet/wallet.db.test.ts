import { createCharacter, createUser, setUserStatus } from '@/server/accounts/repository';
import { parseEconomyParams } from '@/server/config/economy-params';
import { getBalance, getMoneySupply, getPlayerAccount, verifyLedger } from '@/server/ledger';
import { seedSystemAccounts } from '@/server/ledger/test-support';
import { truncateAll } from '@/test/db-utils';
import { WalletUnavailable, ensureWallet, getWallet } from './index';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The wallet: one account and one starting grant per user, whatever happens.
 *
 * The tests that matter here are the concurrent one (a race must not pay twice) and
 * the "old grants are untouched" one (changing the number must not rewrite history).
 */

const TERMS = '2026-11-01';

let userCounter = 0;

async function newUser(status: 'active' | 'frozen' | 'banned' = 'active'): Promise<string> {
  userCounter += 1;
  const email = `player${userCounter}@example.com`;
  const { id } = await createUser({
    email,
    emailCanonical: email,
    termsVersion: TERMS,
    emailVerified: true,
  });
  if (status !== 'active') await setUserStatus({ userId: id, status, reason: 'test fixture' });
  return id;
}

async function newPlayer(): Promise<string> {
  userCounter += 1;
  const number = userCounter;
  const email = `player${number}@example.com`;
  const { id: userId } = await createUser({
    email,
    emailCanonical: email,
    termsVersion: TERMS,
    emailVerified: true,
  });
  await createCharacter({
    userId,
    name: `Player ${number}`,
    nameCanonical: `player ${number}`,
    avatar: { skinTone: 3, hair: 1, outfit: 1 },
    ipHash: null,
  });
  return userId;
}

beforeEach(async () => {
  await truncateAll();
  await seedSystemAccounts();
});

describe('ensureWallet', () => {
  it('creates one account and one grant, and returns the account', async () => {
    const userId = await newPlayer();

    const first = await ensureWallet(userId);

    expect(first.replayed).toBe(false);
    const account = await getPlayerAccount(userId);
    expect(account?.id).toBe(first.accountId);

    const second = await ensureWallet(userId);
    expect(second.accountId).toBe(first.accountId);
    expect(second.replayed).toBe(true);
  });

  it('pays exactly once when twenty callers race', async () => {
    const userId = await newPlayer();

    const results = await Promise.all(Array.from({ length: 20 }, () => ensureWallet(userId)));

    expect(new Set(results.map((result) => result.accountId)).size).toBe(1);

    const wallet = await getWallet(userId);
    expect(wallet).toEqual({ balanceKobo: 500_000n, restricted: false });

    const report = await verifyLedger();
    expect(report.ok).toBe(true);
    const supply = await getMoneySupply();
    expect(supply.totalMintedKobo).toBe(500_000n);
    expect(supply.playersKobo).toBe(500_000n);
  });

  it('gives nothing to a frozen or banned user, and creates no account for them', async () => {
    const frozen = await newUser('frozen');
    const banned = await newUser('banned');

    await expect(ensureWallet(frozen)).rejects.toBeInstanceOf(WalletUnavailable);
    await expect(ensureWallet(banned)).rejects.toBeInstanceOf(WalletUnavailable);
    await expect(ensureWallet('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      reason: 'not_found',
    });

    expect(await getPlayerAccount(frozen)).toBeNull();
    expect(await getPlayerAccount(banned)).toBeNull();
    expect((await verifyLedger()).ok).toBe(true);
  });

  it('uses the starting balance in force now, and leaves grants that already happened alone', async () => {
    const early = await newPlayer();
    await ensureWallet(early);

    const tuned = parseEconomyParams({ version: 'test-2', startingBalanceKobo: 900_000n });
    const later = await newPlayer();
    const laterWallet = await ensureWallet(later, { params: tuned });

    // Read the balances from the ledger, because page reads deliberately use the
    // parameters in force now rather than whatever a test happened to pass in.
    expect(await getBalance(earlyWalletAccount(await getPlayerAccount(early)))).toBe(500_000n);
    expect(await getBalance(laterWallet.accountId)).toBe(900_000n);
    expect(await getWallet(early)).toEqual({ balanceKobo: 500_000n, restricted: false });
  });

  it('creates the account with no grant when the starting balance is zero', async () => {
    const userId = await newPlayer();
    const zero = parseEconomyParams({ version: 'test-zero', startingBalanceKobo: 0n });

    const result = await ensureWallet(userId, { params: zero });

    expect(await getPlayerAccount(userId)).not.toBeNull();
    expect(await getBalance(result.accountId)).toBe(0n);

    // A later call with the real parameters pays the grant once, because the account
    // existing never stood in for the grant having been paid.
    await ensureWallet(userId);
    expect(await getWallet(userId)).toEqual({ balanceKobo: 500_000n, restricted: false });
  });

  it('keeps the ledger correct and the supply exact across many players', async () => {
    const players = await Promise.all(Array.from({ length: 12 }, () => newPlayer()));

    await Promise.all(players.map((userId) => ensureWallet(userId)));

    const report = await verifyLedger();
    expect(report.ok).toBe(true);

    const supply = await getMoneySupply();
    expect(supply.playersKobo).toBe(BigInt(players.length) * 500_000n);
    expect(supply.totalMintedKobo).toBe(supply.circulatingKobo);
    expect(supply.accountCounts.players).toBe(players.length);
  });
});

describe('getWallet', () => {
  it('heals a player who has a character but no account yet', async () => {
    const userId = await newPlayer();
    expect(await getPlayerAccount(userId)).toBeNull();

    const wallet = await getWallet(userId);

    expect(wallet).toEqual({ balanceKobo: 500_000n, restricted: false });
    expect(await getPlayerAccount(userId)).not.toBeNull();
  });

  it('reports a frozen account as restricted, and still shows the balance', async () => {
    const userId = await newPlayer();
    await ensureWallet(userId);

    const account = await getPlayerAccount(userId);
    await getPoolFreeze(account?.id as string);

    const wallet = await getWallet(userId);
    expect(wallet).toEqual({ balanceKobo: 500_000n, restricted: true });
  });

  it('never throws into the page: a user that cannot have a wallet reads as pending', async () => {
    const banned = await newUser('banned');

    await expect(getWallet(banned)).resolves.toEqual({ setupPending: true });
    await expect(getWallet('00000000-0000-4000-8000-000000000000')).resolves.toEqual({
      setupPending: true,
    });
  });
});

/** The id of a player's account, for a test that already knows it exists. */
function earlyWalletAccount(account: { id: string } | null): string {
  if (!account) throw new Error('the player should already have an account');
  return account.id;
}

/** Freeze an account through the ledger, which is the only module allowed to. */
async function getPoolFreeze(accountId: string): Promise<void> {
  const { setAccountFrozen } = await import('@/server/ledger');
  await setAccountFrozen(accountId, true);
}
