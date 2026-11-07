/**
 * `npm run ledger:verify` — the same check the protected route runs, from a terminal.
 *
 * Exit code 1 when anything is wrong, so a cron job, a deploy gate or a human in a
 * hurry gets an answer it cannot misread. It never prints a connection string: the
 * only output is the summary and, on failure, the ids to investigate.
 */

import { verifyLedger } from '@/server/ledger/verify';
import { summarizeReport } from '@/server/ledger/verify';

async function main(): Promise<void> {
  const report = await verifyLedger();

  console.log(summarizeReport(report));

  if (!report.ok) {
    for (const failure of report.failures) {
      const ids =
        failure.sampleIds.length > 0 ? ` sample ids: ${failure.sampleIds.join(', ')}` : '';
      console.error(`- ${failure.check}: ${failure.count}${ids}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  // The message only, never the object: a pg error can carry the connection string.
  console.error(
    `ledger verification could not run: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
