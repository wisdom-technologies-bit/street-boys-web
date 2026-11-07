import { verifyTransfers } from '../src/server/transfers/verify';

/**
 * `npm run transfers:verify` — the reconciliation in a form a deploy or a cron can
 * call. Exits 1 when anything disagrees, and prints counts and ids only.
 */
const result = await verifyTransfers();

for (const check of result.checks) {
  const state = check.count === 0 ? 'ok  ' : 'FAIL';
  console.log(`${state} ${check.check}: ${check.count}`);
  if (check.sample.length > 0) console.log(`     sample ids: ${check.sample.join(', ')}`);
}

if (!result.ok) {
  console.error('transfers do not reconcile with the ledger');
  process.exit(1);
}

console.log('transfers reconcile with the ledger');
