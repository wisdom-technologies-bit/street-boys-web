/**
 * `npm run wallets:backfill [--dry-run]` — give every active player a wallet.
 *
 * Counts only, never a list of players: this runs over the whole population and its
 * output ends up in a cron log, a terminal, or a chat message.
 */

import { backfillWallets, formatBackfillSummary } from '@/server/wallet/backfill';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const summary = await backfillWallets({ dryRun });
  console.log(formatBackfillSummary(summary));
  if (!dryRun && summary.failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // The message only, never the object: a pg error can carry the connection string.
  console.error(
    `wallet backfill could not run: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
