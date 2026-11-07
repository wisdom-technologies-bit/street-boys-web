import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A scan of the ledger module for the arithmetic that must not be there.
 *
 * `money.ts` is allowed one division (the display formatter). Everywhere else in
 * the module, a float is a bug: `parseFloat`, `Number(`, `toFixed`, `Math.round`
 * on money, or a `/ 100` outside the formatter all mean an amount left bigint
 * arithmetic. Cheaper than a review comment and it cannot be forgotten.
 */

const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url));
const FORBIDDEN = [
  { pattern: /parseFloat\s*\(/, why: 'parseFloat turns money into a float' },
  { pattern: /parseInt\s*\(/, why: 'parseInt on money loses the fraction silently' },
  { pattern: /\.toFixed\s*\(/, why: 'toFixed formats a float; use formatNaira' },
  { pattern: /\bNumber\s*\(/, why: 'Number() on a bigint loses precision past 2^53' },
  { pattern: /\/\s*100\b/, why: 'only the display formatter may divide by 100' },
  { pattern: /\bMath\.round\s*\(/, why: 'rounding money hides a bug in the amount' },
];

function moduleFiles(): string[] {
  return readdirSync(MODULE_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(MODULE_DIR, name));
}

describe('no float arithmetic in the ledger', () => {
  it('keeps every amount in bigint arithmetic', () => {
    const offenders: string[] = [];

    for (const path of moduleFiles()) {
      const source = readFileSync(path, 'utf8');
      for (const [index, line] of source.split('\n').entries()) {
        // The formatter is the one place a division by 100 is correct, and it uses
        // integer division on bigint, so it does not match these patterns anyway.
        for (const rule of FORBIDDEN) {
          if (rule.pattern.test(line)) {
            offenders.push(`${relative(MODULE_DIR, path)}:${index + 1} ${rule.why}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('reads real files, so a pass means something', () => {
    expect(moduleFiles().length).toBeGreaterThanOrEqual(5);
  });
});
