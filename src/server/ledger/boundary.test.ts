import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The module boundary, enforced by a test.
 *
 * AGENTS.md 3.2 says the ledger is the only code allowed to create entries or
 * change a balance. A comment cannot enforce that and a reviewer can miss it, so
 * this test reads the source: outside `src/server/ledger`, the schema file and
 * migrations, nothing may name the ledger's tables or reach into its internals.
 *
 * If this test fails, the fix is almost never to add an exemption. It is to call
 * the public API (`@/server/ledger`) instead.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ALLOWED_TABLE_FILES = ['src/server/db/schema.ts', 'src/server/db/ledger-schema.db.test.ts'];
const TABLE_NAMES = ['ledger_entries', 'ledger_transactions', 'account_balances'];
// `index` is the public API and `test-support` is fixtures; everything else is internal.
const INTERNAL_IMPORT = /from\s+['"]@\/server\/ledger\/(?!index['"]|test-support['"])[^'"]+['"]/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist' || entry.startsWith('.'))
      return [];
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('the ledger module boundary', () => {
  it('is named nowhere outside the module, the schema and the migrations', () => {
    const files = sourceFiles(join(ROOT, 'src')).map((path) => relative(ROOT, path));

    const offenders = files.filter((file) => {
      if (file.startsWith('src/server/ledger/')) return false;
      if (ALLOWED_TABLE_FILES.includes(file)) return false;
      const source = readFileSync(join(ROOT, file), 'utf8');
      return TABLE_NAMES.some((table) => source.includes(table));
    });

    expect(offenders).toEqual([]);
  });

  it('is imported through its public API, never from an internal file', () => {
    const files = sourceFiles(join(ROOT, 'src')).map((path) => relative(ROOT, path));

    const offenders = files.filter((file) => {
      if (file.startsWith('src/server/ledger/')) return false;
      const source = readFileSync(join(ROOT, file), 'utf8');
      return INTERNAL_IMPORT.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('really does read the source, so a passing result means something', () => {
    const files = sourceFiles(join(ROOT, 'src')).map((path) => relative(ROOT, path));
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain('src/server/ledger/index.ts');
  });
});
