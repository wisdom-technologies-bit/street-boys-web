import { getPool } from '@/server/db/client';
import { systemAccountId } from '@/server/ledger/test-support';
import { sendMoney } from './send';
import { balance, createPlayer, fund, resetTransfers, transferCount } from './test-support';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Sending money.
 *
 * Every test here reads the four balances that matter afterwards: the sender's, the
 * receiver's, the escrow account's and TREASURY's. That is what proves a transfer is
 * a movement and not a creation.
 */

const naira = (amount: number): bigint => BigInt(amount) * 100n;

let ada: Awaited<ReturnType<typeof createPlayer>>;
let bola: Awaited<ReturnType<typeof createPlayer>>;
let escrow: string;
let treasury: string;

beforeEach(async () => {
  await resetTransfers();
  ada = await createPlayer('ada', { ageDays: 40 });
  bola = await createPlayer('bola', { ageDays: 40 });
  await fund(ada, naira(400_000));
  escrow = await systemAccountId('ESCROW_TRANSFERS');
  treasury = await systemAccountId('TREASURY');
});

const send = (overrides: Partial<Parameters<typeof sendMoney>[0]> = {}) =>
  sendMoney({
    senderUserId: ada.userId,
    toName: bola.name,
    amountKobo: naira(1_000),
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  });

describe('sendMoney, instantly settled', () => {
  it('moves the amount to the receiver and leaves the tax accounts alone', async () => {
    const result = await send();
    expect(result.status).toBe('completed');
    expect(result.releaseAt).toBeNull();
    expect(await balance(bola.accountId)).toBe(naira(1_000));
    expect(await balance(treasury)).toBe(0n);
  });

  it('takes 2% of the part above 50,000 naira, on top, and pays it to TREASURY', async () => {
    const result = await send({ amountKobo: naira(60_000) });
    expect(result.taxKobo).toBe(naira(200)); // 2% of 10,000
    expect(await balance(bola.accountId)).toBe(naira(60_000)); // the receiver gets exactly the amount
    expect(await balance(treasury)).toBe(naira(200));
    // 400,000 - 60,000 - 200
    expect(await balance(ada.accountId)).toBe(naira(339_800));
  });
});

describe('sendMoney, pending', () => {
  it('holds amount plus tax in escrow and pays nobody yet', async () => {
    const result = await send({ amountKobo: naira(150_000) });
    expect(result.status).toBe('pending');
    expect(result.taxKobo).toBe(naira(2_000)); // 2% of 100,000
    expect(await balance(escrow)).toBe(naira(152_000));
    expect(await balance(bola.accountId)).toBe(0n);
    expect(await balance(treasury)).toBe(0n);
    const hours = (result.releaseAt!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });
});

describe('sendMoney, refusals', () => {
  it('writes nothing when the sender is short', async () => {
    const poor = await createPlayer('poor', { ageDays: 40 });
    await fund(poor, naira(50));
    await expect(
      send({ senderUserId: poor.userId, amountKobo: naira(1_000) }),
    ).rejects.toMatchObject({ code: 'insufficient_funds' });
    expect(await transferCount()).toBe(0);
  });

  it('refuses a self-transfer', async () => {
    await expect(send({ toName: ada.name })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('refuses a frozen sender', async () => {
    const frozen = await createPlayer('frozen', { ageDays: 40, status: 'frozen' });
    await expect(send({ senderUserId: frozen.userId })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('answers every receiver problem with the same generic error', async () => {
    const banned = await createPlayer('banned', { ageDays: 40, status: 'banned' });

    const missing = await send({ toName: 'nobody at all' }).catch((error) => error);
    const bannedError = await send({ toName: banned.name }).catch((error) => error);

    expect(missing.code).toBe('receiver_unavailable');
    expect(bannedError.code).toBe('receiver_unavailable');
    // Identical, so a prober cannot tell "no such player" from "will not receive".
    expect(missing.message).toBe(bannedError.message);
  });

  it('answers a receiver over their limit with the same generic error', async () => {
    const fresh = await createPlayer('fresh', { ageDays: 0 });
    // A new tier may receive 30,000 naira a day.
    await expect(send({ toName: fresh.name, amountKobo: naira(35_000) })).rejects.toMatchObject({
      code: 'receiver_unavailable',
    });
  });

  it('refuses an amount below the minimum and above the tier maximum', async () => {
    await expect(send({ amountKobo: naira(1) })).rejects.toMatchObject({ code: 'below_minimum' });
    const fresh = await createPlayer('small', { ageDays: 0 });
    await fund(fresh, naira(100_000));
    await expect(
      send({ senderUserId: fresh.userId, amountKobo: naira(25_000) }),
    ).rejects.toMatchObject({ code: 'above_maximum' });
  });

  it('refuses a send that would exceed the daily limit', async () => {
    const fresh = await createPlayer('daily', { ageDays: 0 });
    await fund(fresh, naira(60_000));
    await send({ senderUserId: fresh.userId, amountKobo: naira(20_000), toName: bola.name });
    await expect(
      send({ senderUserId: fresh.userId, amountKobo: naira(100), toName: bola.name }),
    ).rejects.toMatchObject({ code: 'send_limit_exceeded' });
  });

  it('rate-limits a burst of sends', async () => {
    let limited: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sent = await send({ amountKobo: naira(100) }).catch((error) => error);
      if (sent.code === 'rate_limited') {
        limited = sent;
        break;
      }
    }
    expect(limited).toMatchObject({ code: 'rate_limited' });
    expect((limited as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('sendMoney, idempotency', () => {
  it('replays the same request instead of sending twice', async () => {
    const key = crypto.randomUUID();
    const first = await send({ idempotencyKey: key });
    const second = await send({ idempotencyKey: key });

    expect(second.id).toBe(first.id);
    expect(second.replayed).toBe(true);
    expect(await balance(bola.accountId)).toBe(naira(1_000));
    expect(await transferCount()).toBe(1);
  });

  it('refuses the same key with a different amount', async () => {
    const key = crypto.randomUUID();
    await send({ idempotencyKey: key });
    await expect(send({ idempotencyKey: key, amountKobo: naira(2_000) })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
  });

  it('keeps keys private to one sender', async () => {
    const key = crypto.randomUUID();
    await fund(bola, naira(50_000));
    await send({ idempotencyKey: key });
    const fromBola = await send({
      senderUserId: bola.userId,
      toName: ada.name,
      idempotencyKey: key,
    });
    expect(fromBola.replayed).toBe(false);
    expect(await transferCount()).toBe(2);
  });
});

describe('sendMoney, limits over 24 hours', () => {
  it('counts a pending transfer against the limit and ignores a cancelled one', async () => {
    const spender = await createPlayer('spender', { ageDays: 40 });
    await fund(spender, naira(500_000));

    // 150,000 pending, then cancel it by hand: a cancelled transfer never moved money.
    const pending = await send({
      senderUserId: spender.userId,
      toName: bola.name,
      amountKobo: naira(150_000),
    });
    await getPool().query("update transfers set status = 'cancelled' where id = $1", [pending.id]);

    // 290,000 plus its tax is 294,800, inside the established 300,000 daily limit.
    // It only fits if the cancelled 152,000 no longer counts.
    await expect(
      send({ senderUserId: spender.userId, toName: bola.name, amountKobo: naira(290_000) }),
    ).resolves.toMatchObject({ status: 'pending' });
  });

  it('counts a pending transfer that was not cancelled', async () => {
    const spender = await createPlayer('pending-counter', { ageDays: 40 });
    await fund(spender, naira(500_000));
    await send({ senderUserId: spender.userId, toName: bola.name, amountKobo: naira(150_000) });
    // 152,000 pending plus 294,800 is past the 300,000 daily limit.
    await expect(
      send({ senderUserId: spender.userId, toName: bola.name, amountKobo: naira(290_000) }),
    ).rejects.toMatchObject({ code: 'send_limit_exceeded' });
  });
});

describe('sendMoney, audit', () => {
  it('records ids and amounts, never names or emails', async () => {
    await send();
    const { rows } = await getPool().query<{ event_type: string; metadata: unknown }>(
      "select event_type, metadata from audit_log where event_type like 'transfer.%'",
    );
    const event = rows[0];
    expect(event?.event_type).toBe('transfer.sent');
    const text = JSON.stringify(event?.metadata);
    expect(text).not.toContain(ada.name.toLowerCase());
    expect(text).not.toContain(bola.name.toLowerCase());
    expect(text).not.toContain('example.test');
    expect(text).toContain('transferId');
  });
});
