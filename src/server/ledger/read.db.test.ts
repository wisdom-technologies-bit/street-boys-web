import { describe, expect, it, beforeEach } from 'vitest';
import { AccountNotFound } from './errors';
import {
  createPlayerAccount,
  getAccountByCode,
  getBalance,
  getPlayerAccount,
  getTransaction,
  listEntries,
  setAccountFrozen,
} from './read';
import { postTransaction } from './post';
import { resetLedger, systemAccountId } from './test-support';

beforeEach(async () => {
  await resetLedger();
});

describe('reading accounts and balances', () => {
  it('finds a fixed account by code and says nothing rather than throwing for an unknown one', async () => {
    const mint = await getAccountByCode('SYSTEM_MINT');
    expect(mint?.kind).toBe('system');
    expect(mint?.allowNegative).toBe(true);
    expect(mint?.frozen).toBe(false);

    expect(await getAccountByCode('NOT_A_REAL_CODE')).toBeNull();
  });

  it('returns a balance as a bigint and a typed error for an account that does not exist', async () => {
    const burn = await systemAccountId('SYSTEM_BURN');
    expect(await getBalance(burn)).toBe(0n);

    await expect(getBalance(crypto.randomUUID())).rejects.toThrow(AccountNotFound);
  });

  it('creates one account per player, however many times it is asked, even at the same time', async () => {
    const userId = crypto.randomUUID();

    const first = await createPlayerAccount(userId);
    const second = await createPlayerAccount(userId);
    expect(second.id).toBe(first.id);

    const raced = await Promise.all([createPlayerAccount(userId), createPlayerAccount(userId)]);
    expect(new Set(raced.map((account) => account.id))).toEqual(new Set([first.id]));

    expect(await getPlayerAccount(userId)).toMatchObject({ id: first.id, kind: 'player' });
    expect(await getBalance(first.id)).toBe(0n);
  });

  it('freezes and unfreezes an account', async () => {
    const account = await createPlayerAccount(crypto.randomUUID());

    await setAccountFrozen(account.id, true);
    expect(await getPlayerAccount(account.ownerUserId as string)).toMatchObject({ frozen: true });

    await setAccountFrozen(account.id, false);
    expect(await getPlayerAccount(account.ownerUserId as string)).toMatchObject({ frozen: false });
  });
});

describe('reading transactions and entries', () => {
  it('returns a transaction with its entries, and null for an unknown one', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const account = await createPlayerAccount(crypto.randomUUID());

    const posted = await postTransaction({
      idempotencyKey: 'read-1',
      category: 'onboarding_grant',
      entries: [
        { accountId: mint, amountKobo: -2500n },
        { accountId: account.id, amountKobo: 2500n },
      ],
    });

    const transaction = await getTransaction(posted.transactionId);
    expect(transaction?.category).toBe('onboarding_grant');
    expect(transaction?.entries).toHaveLength(2);
    expect(transaction?.entries.map((entry) => entry.amountKobo).sort()).toEqual(
      [-2500n, 2500n].sort(),
    );

    expect(await getTransaction(crypto.randomUUID())).toBeNull();
  });

  it('pages an account history newest first with a keyset cursor', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const account = await createPlayerAccount(crypto.randomUUID());

    for (let index = 0; index < 3; index += 1) {
      await postTransaction({
        idempotencyKey: `page-${index}`,
        category: 'onboarding_grant',
        entries: [
          { accountId: mint, amountKobo: -1000n },
          { accountId: account.id, amountKobo: 1000n },
        ],
      });
    }

    const firstPage = await listEntries(account.id, { limit: 2 });
    expect(firstPage).toHaveLength(2);
    expect(firstPage[0]?.amountKobo).toBe(1000n);
    expect(firstPage[0]!.id).toBeGreaterThan(firstPage[1]!.id);

    const secondPage = await listEntries(account.id, { limit: 2, afterEntryId: firstPage[1]!.id });
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]!.id).toBeLessThan(firstPage[1]!.id);

    expect(await listEntries(account.id, { limit: 0 })).toHaveLength(1);
  });
});
