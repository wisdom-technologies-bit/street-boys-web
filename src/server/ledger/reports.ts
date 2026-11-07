import { getPool } from '@/server/db/client';
import { kobo, type Kobo } from './money';

/**
 * Reports: what the economy looks like right now, and where money came from.
 *
 * Both are read-only queries over append-only tables, so they need no lock and no
 * gate. They answer questions the design docs ask: how much money exists, how much
 * has been created and destroyed, and which faucet or sink did it.
 *
 * Two rules make the numbers trustworthy:
 *
 * - **Everything is a bigint kobo.** No floats, no naira: a report that rounds is a
 *   report that disagrees with the ledger.
 * - **A reversal is attributed to what it reverses.** If a mint is reversed, the
 *   mint's own category shows the negative, not a mysterious "reversal" bucket. Net
 *   flows then stay honest, which is the only way a report is useful for balancing
 *   faucets against sinks (docs/03).
 */

export type AccountCounts = {
  players: number;
  system: number;
  treasury: number;
  escrow: number;
};

export type MoneySupply = {
  /** Money held by players, treasury and escrow: everything outside the system accounts. */
  circulatingKobo: Kobo;
  /** Net created out of SYSTEM_MINT. Reversals of a mint reduce it. */
  totalMintedKobo: Kobo;
  /** Net destroyed into SYSTEM_BURN. Reversals of a burn reduce it. */
  totalBurnedKobo: Kobo;
  treasuryKobo: Kobo;
  playersKobo: Kobo;
  escrowKobo: Kobo;
  accountCounts: AccountCounts;
};

/**
 * The money supply.
 *
 * `circulating = totalMinted - totalBurned` always holds, because every balance in
 * the ledger sums to zero: the two system accounts hold the negative of what the
 * world holds. A test asserts it, so a report that stops adding up fails CI rather
 * than quietly misleading an owner.
 */
export async function getMoneySupply(): Promise<MoneySupply> {
  const { rows } = await getPool().query<{
    players: string;
    treasury: string;
    escrow: string;
    mint: string;
    burn: string;
    player_count: string;
    system_count: string;
    treasury_count: string;
    escrow_count: string;
  }>(
    `select
       coalesce((select sum(b.balance_kobo) from account_balances b join accounts a on a.id = b.account_id where a.kind = 'player'), 0)::text as players,
       coalesce((select sum(b.balance_kobo) from account_balances b join accounts a on a.id = b.account_id where a.kind = 'treasury'), 0)::text as treasury,
       coalesce((select sum(b.balance_kobo) from account_balances b join accounts a on a.id = b.account_id where a.kind = 'escrow'), 0)::text as escrow,
       coalesce((select b.balance_kobo from account_balances b join accounts a on a.id = b.account_id where a.code = 'SYSTEM_MINT'), 0)::text as mint,
       coalesce((select b.balance_kobo from account_balances b join accounts a on a.id = b.account_id where a.code = 'SYSTEM_BURN'), 0)::text as burn,
       (select count(*) from accounts where kind = 'player')::text as player_count,
       (select count(*) from accounts where kind = 'system')::text as system_count,
       (select count(*) from accounts where kind = 'treasury')::text as treasury_count,
       (select count(*) from accounts where kind = 'escrow')::text as escrow_count`,
  );

  const row = rows[0];
  const players = BigInt(row?.players ?? '0');
  const treasury = BigInt(row?.treasury ?? '0');
  const escrow = BigInt(row?.escrow ?? '0');
  const mint = BigInt(row?.mint ?? '0');
  const burn = BigInt(row?.burn ?? '0');

  return {
    circulatingKobo: kobo(players + treasury + escrow),
    // MINT holds the money supply as a negative: what left it is minus its balance.
    totalMintedKobo: kobo(-mint),
    totalBurnedKobo: kobo(burn),
    treasuryKobo: kobo(treasury),
    playersKobo: kobo(players),
    escrowKobo: kobo(escrow),
    accountCounts: {
      players: Number(row?.player_count ?? '0'), // count, not money
      system: Number(row?.system_count ?? '0'), // count, not money
      treasury: Number(row?.treasury_count ?? '0'), // count, not money
      escrow: Number(row?.escrow_count ?? '0'), // count, not money
    },
  };
}

export type FlowRow = {
  /** The UTC day the transaction was recorded, as `YYYY-MM-DD`. */
  day: string;
  category: string;
  createdKobo: Kobo;
  destroyedKobo: Kobo;
};

const DAY_MS = 86_400_000;

/** Midnight UTC, `days` ago, as an ISO date: the window a report covers. */
export function windowStart(days: number, now: Date = new Date()): string {
  const bounded = Math.min(Math.max(Math.trunc(days), 1), 90);
  return new Date(now.getTime() - (bounded - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Money created and destroyed per day per category.
 *
 * Only the two system accounts count: a transfer between two players moves money
 * but changes nothing about how much exists, and a report that counted it would
 * make a busy day look like an inflationary one.
 *
 * The figures are **net** for the day: a reversal inside the same day cancels the
 * movement it reverses, so a faucet that paid 2,500 and was reversed that day reads
 * as 0, and the sum of created minus destroyed over a window always equals the
 * money the world holds.
 */
export async function getFlowsByCategory(input: {
  from?: Date | string;
  to?: Date | string;
  bucket?: 'day';
}): Promise<FlowRow[]> {
  const from = input.from ? new Date(input.from) : new Date(Date.now() - 29 * DAY_MS);
  const to = input.to ? new Date(input.to) : new Date();

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('getFlowsByCategory: from and to must be dates');
  }

  const { rows } = await getPool().query<{
    day: string;
    category: string;
    created: string;
    destroyed: string;
  }>(
    `select to_char(date_trunc('day', t.created_at at time zone 'utc'), 'YYYY-MM-DD') as day,
            coalesce(orig.category, t.category) as category,
            -- Net, not gross: a reversal of a mint puts kobo back into MINT, and that
            -- has to show as a negative on the mint's own category, or the day's
            -- faucet total would claim money that no longer exists.
            coalesce(sum(case when e.account_id = $3 then -e.amount_kobo else 0 end), 0)::text as created,
            coalesce(sum(case when e.account_id = $4 then e.amount_kobo else 0 end), 0)::text as destroyed
       from ledger_entries e
       join ledger_transactions t on t.id = e.transaction_id
       left join ledger_transactions orig on orig.id = t.reverses_transaction_id
      where t.created_at >= $1 and t.created_at < $2
        and (e.account_id = $3 or e.account_id = $4)
      group by 1, 2
      order by 1 desc, 2 asc`,
    [from, to, await systemAccountId('SYSTEM_MINT'), await systemAccountId('SYSTEM_BURN')],
  );

  return rows.map((row) => ({
    day: row.day,
    category: row.category,
    createdKobo: kobo(BigInt(row.created)),
    destroyedKobo: kobo(BigInt(row.destroyed)),
  }));
}

async function systemAccountId(code: 'SYSTEM_MINT' | 'SYSTEM_BURN'): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    'select id from accounts where code = $1',
    [code],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`system account ${code} is missing; run npm run ledger:verify`);
  return id;
}
