import { listActivePlayerUserIds } from '@/server/accounts/repository';
import { getMoneySupply, getPlayerAccounts } from '@/server/ledger';
import { ensureWallet } from './index';

/**
 * The backfill: give a wallet to every active player who has a character.
 *
 * Needed because a wallet can legitimately be missing: the grant failed when the
 * character was created, a player predates the ledger, or the economy parameters were
 * zero at the time. It is safe to run as often as you like, because `ensureWallet` is
 * idempotent on both the account and the grant, so a second run posts nothing.
 *
 * What it prints is **counts only**. A backfill over every player must not put
 * hundreds of ids or email addresses into a log or a terminal buffer that gets
 * pasted into a chat.
 */

export type BackfillSummary = {
  dryRun: boolean;
  /** Active players with a character, which is the whole population this touches. */
  players: number;
  /** How many of them already had an account when the run looked. */
  alreadySetUp: number;
  /** Accounts newly created by this run (a count of the ledger's player accounts). */
  created: number;
  /** Grants posted fresh. Replays are not counted: nothing moved. */
  granted: number;
  /** Players whose setup raised, which leaves them to the next read or run. */
  failed: number;
};

export async function backfillWallets(options: { dryRun?: boolean; pageSize?: number } = {}) {
  const dryRun = options.dryRun === true;
  const summary: BackfillSummary = {
    dryRun,
    players: 0,
    alreadySetUp: 0,
    created: 0,
    granted: 0,
    failed: 0,
  };

  const before = await getMoneySupply();
  let afterId: string | null = null;

  do {
    const page = await listActivePlayerUserIds({ afterId, limit: options.pageSize ?? 200 });
    afterId = page.nextAfterId;
    if (page.ids.length === 0) break;

    summary.players += page.ids.length;

    const existing = await getPlayerAccounts(page.ids);
    summary.alreadySetUp += existing.size;

    if (dryRun) continue;

    for (const userId of page.ids) {
      try {
        const result = await ensureWallet(userId);
        if (!result.replayed) summary.granted += 1;
      } catch {
        // A count only: the reason is in the audit log, tied to the user, where it
        // belongs. Printing it here would leak who is broken into a terminal.
        summary.failed += 1;
      }
    }
  } while (afterId);

  if (!dryRun) {
    const after = await getMoneySupply();
    summary.created = after.accountCounts.players - before.accountCounts.players;
  }

  return summary;
}

/** One line, counts only, for a terminal or a cron log. */
export function formatBackfillSummary(summary: BackfillSummary): string {
  const prefix = summary.dryRun ? 'wallets backfill (dry run)' : 'wallets backfill';
  const parts = [`${summary.players} active players`, `${summary.alreadySetUp} already set up`];
  if (summary.dryRun) {
    parts.push(`${summary.players - summary.alreadySetUp} would be set up`);
  } else {
    parts.push(`${summary.created} accounts created`, `${summary.granted} grants posted`);
    if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  }
  return `${prefix}: ${parts.join(', ')}`;
}
