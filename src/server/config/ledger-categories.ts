/**
 * The categories a ledger transaction may carry.
 *
 * A fixed allowlist, because the category is what a report groups by: a typo or a
 * new name invented at a call site would not fail, it would quietly create a
 * second bucket and a total that does not add up. Adding a category is a code
 * change plus a test, and a decision logged in `street-boys-docs`.
 */
export const LEDGER_CATEGORIES = [
  'onboarding_grant',
  'top_up',
  'job_pay',
  'npc_customer_sale',
  'event_bonus',
  'transfer',
  'transfer_tax',
  'marketplace_fee',
  'rent',
  'food',
  'transport',
  'tax',
  'fine',
  'licence',
  'leakage',
  'escrow_hold',
  'escrow_release',
  'property_purchase',
  'reversal',
  'admin_adjustment',
] as const;

export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

export function isLedgerCategory(value: string): value is LedgerCategory {
  return (LEDGER_CATEGORIES as readonly string[]).includes(value);
}
