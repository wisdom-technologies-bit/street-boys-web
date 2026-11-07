import { getFlowsByCategory, getMoneySupply, windowStart } from './reports';
import { postTransaction } from './post';
import { reverseTransaction } from './reverse';
import { balanceOf, createTestPlayerAccount, resetLedger, systemAccountId } from './test-support';
import { verifyLedger } from './verify';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The reports, checked against arithmetic done by hand.
 *
 * Every expectation below is a small sum a reader can follow, because a report that
 * is only checked against itself proves nothing.
 */

const ACTOR = '00000000-0000-4000-8000-000000000001';

let mint: string;
let burn: string;
let treasury: string;

beforeEach(async () => {
  await resetLedger();
  mint = await systemAccountId('SYSTEM_MINT');
  burn = await systemAccountId('SYSTEM_BURN');
  treasury = await systemAccountId('TREASURY');
});

async function mintTo(accountId: string, amountKobo: bigint, key: string) {
  return postTransaction({
    idempotencyKey: key,
    category: 'onboarding_grant',
    entries: [
      { accountId: mint, amountKobo: -amountKobo },
      { accountId, amountKobo },
    ],
  });
}

describe('getMoneySupply', () => {
  it('reports an empty economy with the three system accounts', async () => {
    const supply = await getMoneySupply();

    expect(supply).toMatchObject({
      circulatingKobo: 0n,
      totalMintedKobo: 0n,
      totalBurnedKobo: 0n,
      treasuryKobo: 0n,
      playersKobo: 0n,
      escrowKobo: 0n,
      accountCounts: { players: 0, system: 2, treasury: 1, escrow: 0 },
    });
  });

  it('counts minted, burned, treasury and circulation, and stays internally consistent', async () => {
    const player = await createTestPlayerAccount('supply');
    const second = await createTestPlayerAccount('supply-2');

    await mintTo(player, 10_000n, 'supply-mint-0001');
    await mintTo(second, 4_000n, 'supply-mint-0002');
    // Burn 3,000: a player paying for food.
    await postTransaction({
      idempotencyKey: 'supply-food-0001',
      category: 'food',
      entries: [
        { accountId: player, amountKobo: -3_000n },
        { accountId: burn, amountKobo: 3_000n },
      ],
    });
    // 2,000 to the treasury as tax.
    await postTransaction({
      idempotencyKey: 'supply-tax-0001',
      category: 'tax',
      entries: [
        { accountId: player, amountKobo: -2_000n },
        { accountId: treasury, amountKobo: 2_000n },
      ],
    });

    const supply = await getMoneySupply();

    expect(supply.playersKobo).toBe(9_000n); // 10,000 - 3,000 - 2,000 + 4,000
    expect(supply.treasuryKobo).toBe(2_000n);
    expect(supply.totalMintedKobo).toBe(14_000n);
    expect(supply.totalBurnedKobo).toBe(3_000n);
    expect(supply.circulatingKobo).toBe(11_000n); // 9,000 players + 2,000 treasury
    expect(supply.circulatingKobo).toBe(supply.totalMintedKobo - supply.totalBurnedKobo);
    expect(supply.accountCounts.players).toBe(2);
    expect((await verifyLedger()).ok).toBe(true);
  });

  it('reduces the supply when a mint is reversed, and stays consistent', async () => {
    const player = await createTestPlayerAccount('supply-reverse');
    const original = await mintTo(player, 5_000n, 'supply-mint-0003');

    await reverseTransaction({
      transactionId: original.transactionId,
      idempotencyKey: 'supply-reverse-0001',
      reason: 'grant issued twice',
      actorUserId: ACTOR,
    });

    const supply = await getMoneySupply();
    expect(supply.totalMintedKobo).toBe(0n);
    expect(supply.playersKobo).toBe(0n);
    expect(supply.circulatingKobo).toBe(0n);
    expect(await balanceOf(mint)).toBe(0n);
  });
});

describe('getFlowsByCategory', () => {
  it('attributes created and destroyed money to the right category, and moves nothing else', async () => {
    const player = await createTestPlayerAccount('flows');
    const other = await createTestPlayerAccount('flows-other');

    await mintTo(player, 6_000n, 'flows-mint-0001');
    await postTransaction({
      idempotencyKey: 'flows-food-0001',
      category: 'food',
      entries: [
        { accountId: player, amountKobo: -1_500n },
        { accountId: burn, amountKobo: 1_500n },
      ],
    });
    // A plain transfer creates and destroys nothing: it must not appear at all.
    await postTransaction({
      idempotencyKey: 'flows-transfer-0001',
      category: 'transfer',
      entries: [
        { accountId: player, amountKobo: -500n },
        { accountId: other, amountKobo: 500n },
      ],
    });
    // Money into the treasury is not created or destroyed either.
    await postTransaction({
      idempotencyKey: 'flows-tax-0001',
      category: 'tax',
      entries: [
        { accountId: player, amountKobo: -300n },
        { accountId: treasury, amountKobo: 300n },
      ],
    });

    const flows = await getFlowsByCategory({
      from: new Date(Date.now() - 86_400_000),
      to: new Date(),
    });

    const byCategory = new Map(flows.map((row) => [row.category, row]));
    expect(byCategory.get('onboarding_grant')).toMatchObject({
      createdKobo: 6_000n,
      destroyedKobo: 0n,
    });
    expect(byCategory.get('food')).toMatchObject({ createdKobo: 0n, destroyedKobo: 1_500n });
    expect(byCategory.has('transfer')).toBe(false);
    expect(byCategory.has('tax')).toBe(false);

    // The faucet minus the sink equals what the world holds.
    const supply = await getMoneySupply();
    const created = flows.reduce((total, row) => total + row.createdKobo, 0n);
    const destroyed = flows.reduce((total, row) => total + row.destroyedKobo, 0n);
    expect(created - destroyed).toBe(supply.circulatingKobo);
  });

  it('books a reversed mint against the mint category, so the day nets to zero', async () => {
    const player = await createTestPlayerAccount('flows-reverse-mint');
    const original = await mintTo(player, 2_500n, 'flows-mint-0002');

    await reverseTransaction({
      transactionId: original.transactionId,
      idempotencyKey: 'flows-reverse-0002',
      reason: 'wrong amount',
      actorUserId: ACTOR,
    });

    const flows = await getFlowsByCategory({
      from: new Date(Date.now() - 86_400_000),
      to: new Date(),
    });

    // Two rows would be wrong here; both entries belong to the mint's own category.
    expect(flows.filter((row) => row.category === 'reversal')).toEqual([]);
    const mintRow = flows.find((row) => row.category === 'onboarding_grant');
    expect(mintRow).toMatchObject({ createdKobo: 0n, destroyedKobo: 0n });
  });

  it('books a reversed burn against the burn category, so the day nets to zero', async () => {
    const player = await createTestPlayerAccount('flows-reverse-burn');
    await mintTo(player, 4_000n, 'flows-mint-0003');

    const spend = await postTransaction({
      idempotencyKey: 'flows-food-0002',
      category: 'food',
      entries: [
        { accountId: player, amountKobo: -1_000n },
        { accountId: burn, amountKobo: 1_000n },
      ],
    });

    await reverseTransaction({
      transactionId: spend.transactionId,
      idempotencyKey: 'flows-reverse-0003',
      reason: 'order cancelled',
      actorUserId: ACTOR,
    });

    const flows = await getFlowsByCategory({
      from: new Date(Date.now() - 86_400_000),
      to: new Date(),
    });
    const foodRow = flows.find((row) => row.category === 'food');

    expect(foodRow).toMatchObject({ createdKobo: 0n, destroyedKobo: 0n });
    expect(flows.filter((row) => row.category === 'reversal')).toEqual([]);
    expect((await getMoneySupply()).totalBurnedKobo).toBe(0n);
  });

  it('respects the window it is given', async () => {
    const player = await createTestPlayerAccount('flows-window');
    await mintTo(player, 1_000n, 'flows-mint-0004');

    const future = await getFlowsByCategory({
      from: new Date(Date.now() + 86_400_000),
      to: new Date(Date.now() + 2 * 86_400_000),
    });
    expect(future).toEqual([]);
  });
});

describe('windowStart', () => {
  it('covers the requested number of days, bounded to 1..90', () => {
    const now = new Date('2026-11-07T12:00:00.000Z');
    expect(windowStart(1, now)).toBe('2026-11-07');
    expect(windowStart(30, now)).toBe('2026-10-09');
    expect(windowStart(0, now)).toBe('2026-11-07');
    expect(windowStart(1000, now)).toBe(windowStart(90, now));
  });
});
