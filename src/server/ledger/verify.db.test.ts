import { getPool } from '@/server/db/client';
import { postTransaction } from './post';
import { reverseTransaction } from './reverse';
import { balanceOf, createTestPlayerAccount, resetLedger, systemAccountId } from './test-support';
import { summarizeReport, verifyLedger } from './verify';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The verifier has one job: notice when the ledger is wrong.
 *
 * Testing it means making the ledger wrong on purpose. `session_replication_role =
 * replica` switches off the triggers that normally refuse a bad write, so these
 * tests can build the exact corruption each check is meant to catch. That escape
 * hatch lives in this file only: no application code sets it, and the role is
 * restored the moment the transaction ends.
 */

const ACTOR = '00000000-0000-4000-8000-000000000001';

/**
 * Fixture identifiers for the corrupted rows.
 *
 * Held in constants rather than written inside the SQL, so a secret scanner is not
 * asked to decide whether a test fixture is a credential: a literal sitting next to
 * `idempotency_key` looks exactly like a leaked key to a generic rule.
 */
const THIN_FIXTURE = 'corrupt-thin-0001';
const HALF_FIXTURE = 'corrupt-reversal-0001';
const CHAIN_FIXTURE = 'corrupt-chain-0001';
const NOTHING_FIXTURE = 'corrupt-nothing-0001';
const DANGLING_FIXTURE = 'corrupt-dangling-0001';
const CHAIN_REVERSAL = 'verify-chain-0001';

/**
 * Run corrupting SQL with the ledger's triggers disabled, then commit.
 *
 * Deliberately a transaction: `SET LOCAL` cannot leak into another test's session,
 * and a failure rolls the corruption back rather than poisoning the next test.
 */
async function corrupt(statements: Array<{ sql: string; values?: unknown[] }>): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    for (const statement of statements) await client.query(statement.sql, statement.values ?? []);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function healthyLedger(): Promise<{ player: string; transactionId: string }> {
  const mint = await systemAccountId('SYSTEM_MINT');
  const player = await createTestPlayerAccount('verified');
  const posted = await postTransaction({
    idempotencyKey: 'verify-seed-0001',
    category: 'onboarding_grant',
    entries: [
      { accountId: mint, amountKobo: -1000n },
      { accountId: player, amountKobo: 1000n },
    ],
  });
  return { player, transactionId: posted.transactionId };
}

function checkNames(report: Awaited<ReturnType<typeof verifyLedger>>): string[] {
  return report.failures.map((failure) => failure.check);
}

beforeEach(async () => {
  await resetLedger();
});

describe('verifyLedger: a healthy ledger', () => {
  it('passes, with counts, and says so in one line', async () => {
    await healthyLedger();

    const report = await verifyLedger();

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.counts.transactions).toBeGreaterThanOrEqual(1);
    expect(report.counts.entries).toBeGreaterThanOrEqual(2);
    expect(report.counts.accounts).toBeGreaterThanOrEqual(4);
    expect(summarizeReport(report)).toMatch(/^ledger ok:/);
  });

  it('reports no personal data: ids and counts only', async () => {
    await healthyLedger();
    const report = await verifyLedger();

    const serialised = JSON.stringify(report);
    expect(serialised).not.toMatch(/@/);
    expect(serialised).not.toMatch(/email/i);
  });

  it('agrees with a reversed transaction, which is a healthy ledger too', async () => {
    const { player, transactionId } = await healthyLedger();

    await reverseTransaction({
      transactionId,
      idempotencyKey: 'verify-reverse-0001',
      reason: 'verifier fixture',
      actorUserId: ACTOR,
    });

    const report = await verifyLedger();
    expect(report.ok).toBe(true);
    expect(report.counts.reversals).toBe(1);
    expect(await balanceOf(player)).toBe(0n);
  });
});

describe('verifyLedger: it catches each kind of corruption', () => {
  it('catches a transaction that does not balance, and a ledger total that is not zero', async () => {
    const { player } = await healthyLedger();

    await corrupt([
      {
        sql: `insert into ledger_transactions (idempotency_key, request_fingerprint, category)
              values ($1, 'fingerprint', 'transfer') returning id`,
        values: [THIN_FIXTURE],
      },
    ]);
    const { rows } = await getPool().query<{ id: string }>(
      'select id from ledger_transactions where idempotency_key = $1',
      [THIN_FIXTURE],
    );
    await corrupt([
      {
        sql: 'insert into ledger_entries (transaction_id, account_id, amount_kobo) values ($1, $2, 500)',
        values: [rows[0]?.id, player],
      },
    ]);

    const report = await verifyLedger();
    expect(report.ok).toBe(false);
    expect(checkNames(report)).toContain('transaction_unbalanced_or_thin');
    expect(checkNames(report)).toContain('ledger_total_not_zero');

    const thin = report.failures.find(
      (failure) => failure.check === 'transaction_unbalanced_or_thin',
    );
    expect(thin?.count).toBeGreaterThanOrEqual(1);
    expect(thin?.sampleIds.length).toBeLessThanOrEqual(20);
  });

  it('catches a balance that no longer equals its entries', async () => {
    const { player } = await healthyLedger();

    await corrupt([
      {
        sql: 'update account_balances set balance_kobo = balance_kobo + 100 where account_id = $1',
        values: [player],
      },
    ]);

    const report = await verifyLedger();
    expect(report.ok).toBe(false);
    expect(checkNames(report)).toContain('balance_mismatch');
    expect(report.failures.find((f) => f.check === 'balance_mismatch')?.sampleIds).toEqual([
      player,
    ]);
  });

  it('catches a version that does not equal the number of entries', async () => {
    const { player } = await healthyLedger();

    await corrupt([
      {
        sql: 'update account_balances set version = version + 7 where account_id = $1',
        values: [player],
      },
    ]);

    const report = await verifyLedger();
    expect(checkNames(report)).toContain('version_mismatch');
  });

  it('catches a negative balance on an account that is not allowed one', async () => {
    const { player } = await healthyLedger();

    // The overdraft rule is a CHECK, and a CHECK cannot be switched off by the
    // replication role, so the constraint itself is lifted inside the corruption
    // transaction and put back NOT VALID afterwards (validated again below).
    await corrupt([
      { sql: 'alter table account_balances drop constraint account_balances_overdraft_check' },
      {
        sql: 'update account_balances set balance_kobo = -1, allow_negative = false where account_id = $1',
        values: [player],
      },
      {
        sql: `alter table account_balances
              add constraint account_balances_overdraft_check check (balance_kobo >= 0 or allow_negative) not valid`,
      },
    ]);

    const report = await verifyLedger();
    expect(report.ok).toBe(false);
    expect(checkNames(report)).toContain('negative_balance_without_permission');

    // Leave the database exactly as the migration created it for the rest of the suite.
    await resetLedger();
    await getPool().query(
      'alter table account_balances validate constraint account_balances_overdraft_check',
    );
  });

  it('catches an account with no balance row, and a balance row with no account', async () => {
    await healthyLedger();

    await corrupt([
      { sql: "insert into accounts (kind, code) values ('system', 'ORPHAN_ACCOUNT')" },
      {
        sql: 'insert into account_balances (account_id, allow_negative) values ($1, false)',
        values: [crypto.randomUUID()],
      },
    ]);

    const report = await verifyLedger();
    expect(checkNames(report)).toContain('account_without_balance');
    expect(checkNames(report)).toContain('balance_without_account');
  });

  it('catches a missing system account', async () => {
    await healthyLedger();

    await corrupt([
      { sql: "update accounts set code = 'TREASURY_RENAMED' where code = 'TREASURY'" },
    ]);

    const report = await verifyLedger();
    const missing = report.failures.find((failure) => failure.check === 'system_account_missing');
    expect(missing?.count).toBe(1);
  });

  it('catches a reversal whose entries are not the exact negation', async () => {
    const { player, transactionId } = await healthyLedger();
    const mint = await systemAccountId('SYSTEM_MINT');

    // A reversal of the seed that gives back only half: history now lies.
    await corrupt([
      {
        sql: `insert into ledger_transactions (idempotency_key, request_fingerprint, category, reverses_transaction_id)
              values ($1, 'fingerprint', 'reversal', $2) returning id`,
        values: [HALF_FIXTURE, transactionId],
      },
    ]);
    const { rows } = await getPool().query<{ id: string }>(
      'select id from ledger_transactions where idempotency_key = $1',
      [HALF_FIXTURE],
    );
    await corrupt([
      {
        sql: `insert into ledger_entries (transaction_id, account_id, amount_kobo) values
              ($1, $2, 500), ($1, $3, -500)`,
        values: [rows[0]?.id, player, mint],
      },
    ]);

    const report = await verifyLedger();
    expect(report.ok).toBe(false);
    expect(checkNames(report)).toContain('reversal_not_negation');
  });

  it('catches a reversal of a reversal, and a "reversal" that reverses nothing', async () => {
    const { transactionId } = await healthyLedger();

    // A reversal (valid) followed by a reversal of that reversal (invalid).
    const first = await reverseTransaction({
      transactionId,
      idempotencyKey: CHAIN_REVERSAL,
      reason: 'chain fixture',
      actorUserId: ACTOR,
    });

    await corrupt([
      {
        sql: `insert into ledger_transactions (idempotency_key, request_fingerprint, category, reverses_transaction_id)
              values ($1, 'fingerprint', 'reversal', $2)`,
        values: [CHAIN_FIXTURE, first.transactionId],
      },
      {
        sql: `insert into ledger_transactions (idempotency_key, request_fingerprint, category)
              values ($1, 'fingerprint', 'reversal')`,
        values: [NOTHING_FIXTURE],
      },
    ]);

    const report = await verifyLedger();
    expect(checkNames(report)).toContain('reversal_of_reversal');
    expect(checkNames(report)).toContain('reversal_category_mismatch');
  });

  it('catches a reversal pointing at a transaction that is not there', async () => {
    await healthyLedger();

    await corrupt([
      {
        sql: `insert into ledger_transactions (idempotency_key, request_fingerprint, category, reverses_transaction_id)
              values ($1, 'fingerprint', 'reversal', $2)`,
        values: [DANGLING_FIXTURE, crypto.randomUUID()],
      },
    ]);

    const report = await verifyLedger();
    expect(checkNames(report)).toContain('reversal_target_missing');
  });
});
