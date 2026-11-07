import { postTransaction } from './post';
import { listStatement, STATEMENT_MAX_LIMIT } from './read';
import { balanceOf, createTestPlayerAccount, resetLedger, systemAccountId } from './test-support';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The statement: one account's own history, newest first, with the balance each
 * entry left behind. The running balance is the part that must be right, because a
 * player reads it as "what I had at that moment".
 */

let mint: string;
let burn: string;

beforeEach(async () => {
  await resetLedger();
  mint = await systemAccountId('SYSTEM_MINT');
  burn = await systemAccountId('SYSTEM_BURN');
});

async function grant(player: string, kobo: bigint, key: string) {
  return postTransaction({
    idempotencyKey: key,
    category: 'onboarding_grant',
    entries: [
      { accountId: mint, amountKobo: -kobo },
      { accountId: player, amountKobo: kobo },
    ],
  });
}

async function spend(player: string, kobo: bigint, key: string) {
  return postTransaction({
    idempotencyKey: key,
    category: 'food',
    entries: [
      { accountId: player, amountKobo: -kobo },
      { accountId: burn, amountKobo: kobo },
    ],
  });
}

describe('listStatement', () => {
  it('returns an empty page for an account with no entries', async () => {
    const player = await createTestPlayerAccount('empty');

    const page = await listStatement(player);

    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('lists entries newest first with the balance after each, matching the ledger', async () => {
    const player = await createTestPlayerAccount('statement');
    await grant(player, 500_000n, 'stmt-grant-0001');
    await spend(player, 115_000n, 'stmt-food-0001');
    await grant(player, 20_000n, 'stmt-grant-0002');

    const page = await listStatement(player);

    // Newest first: the last 20,000 grant, then the 1,150 spend, then the 5,000 grant.
    expect(page.entries.map((entry) => entry.amountKobo)).toEqual([20_000n, -115_000n, 500_000n]);
    // And the balance each one left behind: 5,200.00, 3,850.00, 5,000.00 naira... in kobo.
    expect(page.entries.map((entry) => entry.balanceAfterKobo)).toEqual([
      405_000n,
      385_000n,
      500_000n,
    ]);
    expect(page.entries.map((entry) => entry.category)).toEqual([
      'onboarding_grant',
      'food',
      'onboarding_grant',
    ]);
    expect(page.nextCursor).toBeNull();

    // The newest line's running balance is the account's balance now: the whole point.
    expect(page.entries[0]?.balanceAfterKobo).toBe(await balanceOf(player));
  });

  it('orders by id as a number, not as text, once ids pass ten', async () => {
    const player = await createTestPlayerAccount('numeric-order');
    for (let index = 0; index < 6; index += 1) {
      await grant(player, 1_000n, `stmt-order-${index}-0001`);
    }

    const page = await listStatement(player);
    const ids = page.entries.map((entry) => entry.id);

    // The newest entry is the largest id, even when its text form sorts before "9".
    expect(ids).toEqual([...ids].sort((left, right) => (left < right ? 1 : -1)));
    expect(page.entries[0]?.balanceAfterKobo).toBe(6_000n);
    expect(page.entries.at(-1)?.balanceAfterKobo).toBe(1_000n);
  });

  it('pages by cursor without repeating or skipping a line', async () => {
    const player = await createTestPlayerAccount('paging');
    await grant(player, 100_000n, 'stmt-page-0001');
    for (let index = 0; index < 5; index += 1) {
      await spend(player, 1_000n, `stmt-page-spend-${index}-0001`);
    }

    const first = await listStatement(player, { limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listStatement(player, { limit: 2, beforeEntryId: first.nextCursor });
    const third = await listStatement(player, { limit: 2, beforeEntryId: second.nextCursor });

    const seen = [...first.entries, ...second.entries, ...third.entries].map((entry) => entry.id);
    expect(new Set(seen).size).toBe(6);
    expect(seen).toEqual([...seen].sort((left, right) => (left > right ? -1 : 1)));
    expect(third.nextCursor).toBeNull();
    // The balance on the oldest line is what that first grant left behind.
    expect(third.entries.at(-1)?.balanceAfterKobo).toBe(100_000n);
  });

  it("never returns another account's entries", async () => {
    const mine = await createTestPlayerAccount('mine');
    const theirs = await createTestPlayerAccount('theirs');
    await grant(mine, 500_000n, 'stmt-mine-0001');
    await grant(theirs, 700_000n, 'stmt-theirs-0001');
    await grant(mine, 10_000n, 'stmt-mine-0002');

    const page = await listStatement(mine, { limit: STATEMENT_MAX_LIMIT });

    expect(page.entries).toHaveLength(2);
    expect(page.entries.reduce((total, entry) => total + entry.amountKobo, 0n)).toBe(510_000n);
    for (const entry of page.entries) expect(entry.balanceAfterKobo).toBeLessThanOrEqual(510_000n);
  });

  it('keeps the balance honest when the page starts mid-history', async () => {
    const player = await createTestPlayerAccount('mid-history');
    await grant(player, 500_000n, 'stmt-mid-0001');
    await spend(player, 200_000n, 'stmt-mid-0002');
    await spend(player, 100_000n, 'stmt-mid-0003');

    // A page of the two most recent entries must still show 3,000.00 and 2,000.00,
    // not a running total that starts from zero inside the page.
    const page = await listStatement(player, { limit: 2 });
    expect(page.entries.map((entry) => entry.balanceAfterKobo)).toEqual([200_000n, 300_000n]);
  });

  it('refuses a limit outside 1..50 and a cursor that is not an entry id', async () => {
    const player = await createTestPlayerAccount('validation');

    for (const limit of [0, -1, 51, 1.5]) {
      await expect(listStatement(player, { limit }), String(limit)).rejects.toThrow(/limit/);
    }
    for (const beforeEntryId of ['abc', '1; drop table ledger_entries', '-1', '']) {
      await expect(listStatement(player, { beforeEntryId }), beforeEntryId).rejects.toThrow(
        /beforeEntryId/,
      );
    }
  });
});
