import { createCharacter, createUser } from '@/server/accounts/repository';
import { getMoneySupply, getPlayerAccount, verifyLedger } from '@/server/ledger';
import { seedSystemAccounts } from '@/server/ledger/test-support';
import { truncateAll } from '@/test/db-utils';
import { backfillWallets, formatBackfillSummary } from './backfill';
import { ensureWallet, getWallet } from './index';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The backfill, over a population that is half set up: some players have a wallet,
 * some never got one, and a second run must move no money at all.
 */

const TERMS = '2026-11-01';

async function player(withWallet: boolean): Promise<string> {
  const email = `backfill-${crypto.randomUUID()}@example.com`;
  const { id } = await createUser({
    email,
    emailCanonical: email,
    termsVersion: TERMS,
    emailVerified: true,
  });
  await createCharacter({
    userId: id,
    name: `Backfill ${id.slice(0, 8)}`,
    nameCanonical: `backfill ${id.slice(0, 8)}`,
    avatar: { skinTone: 1, hair: 1, outfit: 1 },
    ipHash: null,
  });
  if (withWallet) await ensureWallet(id);
  return id;
}

beforeEach(async () => {
  await truncateAll();
  await seedSystemAccounts();
});

describe('backfillWallets', () => {
  it('sets up only the players who are missing a wallet, and never pays twice', async () => {
    const done = await player(true);
    const missing = await player(false);

    const first = await backfillWallets();

    expect(first.players).toBe(2);
    expect(first.alreadySetUp).toBe(1);
    expect(first.created).toBe(1);
    expect(first.granted).toBe(1);
    expect(first.failed).toBe(0);

    expect(await getWallet(done)).toEqual({ balanceKobo: 500_000n, restricted: false });
    expect(await getWallet(missing)).toEqual({ balanceKobo: 500_000n, restricted: false });

    const second = await backfillWallets();
    expect(second.created).toBe(0);
    expect(second.granted).toBe(0);
    expect(second.failed).toBe(0);

    // The ledger says one grant each, not the function's own counters.
    expect((await getMoneySupply()).totalMintedKobo).toBe(1_000_000n);
    expect((await verifyLedger()).ok).toBe(true);
  });

  it('a dry run writes nothing and says how many would be set up', async () => {
    await player(true);
    const missing = await player(false);

    const dry = await backfillWallets({ dryRun: true });

    expect(dry).toEqual({
      dryRun: true,
      players: 2,
      alreadySetUp: 1,
      created: 0,
      granted: 0,
      failed: 0,
    });
    expect(await getPlayerAccount(missing)).toBeNull();
    expect((await getMoneySupply()).totalMintedKobo).toBe(500_000n);
    expect(formatBackfillSummary(dry)).toBe(
      'wallets backfill (dry run): 2 active players, 1 already set up, 1 would be set up',
    );
  });

  it('pages through more players than one batch', async () => {
    await Promise.all(Array.from({ length: 5 }, () => player(false)));

    const summary = await backfillWallets({ pageSize: 2 });

    expect(summary.players).toBe(5);
    expect(summary.created).toBe(5);
    expect(summary.failed).toBe(0);
    expect((await verifyLedger()).ok).toBe(true);
  });

  it('counts a player it cannot set up instead of aborting the run', async () => {
    const players = await Promise.all(Array.from({ length: 4 }, () => player(false)));
    const { getPool } = await import('@/server/db/client');
    // Hiding the system account the grant needs makes every grant fail, which is an
    // honest way to break a run without mocking the module under test. The row stays:
    // it is referenced by its own balance row and the ledger is append-only anyway.
    await getPool().query(
      "update accounts set code = 'SYSTEM_MINT_UNREACHABLE' where code = 'SYSTEM_MINT'",
    );

    const summary = await backfillWallets();

    expect(summary.players).toBe(players.length);
    expect(summary.failed).toBe(players.length);
    expect(summary.granted).toBe(0);
  });

  it('prints counts, never players', async () => {
    const id = await player(false);

    const line = formatBackfillSummary(await backfillWallets());

    expect(line).toBe(
      'wallets backfill: 1 active players, 0 already set up, 1 accounts created, 1 grants posted',
    );
    expect(line).not.toContain(id);
    expect(line).not.toContain('@');
  });
});
