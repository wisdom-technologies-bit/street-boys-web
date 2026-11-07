import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The pre-deploy entry point, tested as a platform runs it: a separate process,
 * a fresh database, and an environment that contains nothing but the database
 * variables.
 *
 * This is the test that would have caught the Railway failure. The script is
 * spawned as `node --experimental-strip-types scripts/migrate.ts` — the same file
 * the image bundles — so a devDependency, a missing migration folder or a
 * working-directory assumption fails here rather than during a deploy.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = join(REPO_ROOT, 'scripts/migrate.ts');

/** The database the harness points at; each test gets its own copy of it. */
function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  return url;
}

function urlFor(database: string): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdminClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** An empty database, dropped afterwards. Never the harness's own database. */
let database: string;

beforeEach(async () => {
  database = `sb_migrate_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await withAdminClient((client) => client.query(`create database ${database}`));
}, 60_000);

afterEach(async () => {
  await withAdminClient((client) =>
    client.query(`drop database if exists ${database} with (force)`),
  ).catch(() => {});
}, 60_000);

type RunResult = { status: number | null; output: string };

/**
 * The environment a child process gets: PATH and whatever the caller passes. Built
 * by assignment because `NODE_ENV` is a required literal union in Next's typings.
 */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // `NODE_ENV` is a required literal union in Next's typings, so the object is
  // assembled by assignment rather than by a literal.
  const env = {} as NodeJS.ProcessEnv;
  env.PATH = process.env.PATH;
  Object.assign(env, extra);
  return env;
}

/** Run the entry point exactly as a platform would, with a curated environment. */
function runEntry(options: {
  env?: Record<string, string>;
  cwd?: string;
  script?: string;
}): RunResult {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', options.script ?? ENTRY],
    {
      cwd: options.cwd ?? REPO_ROOT,
      // Only what the caller passes plus PATH: the sandbox's own variables must not
      // make a run pass that would fail on a platform.
      env: childEnv(options.env),
      encoding: 'utf8',
      timeout: 60_000,
    },
  );

  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const migrateEnv = (extra: Record<string, string> = {}) => ({
  DATABASE_URL: urlFor(database),
  NODE_ENV: 'production',
  ...extra,
});

async function publicTables(): Promise<string[]> {
  return withAdminClient(async (client) => {
    const url = new URL(urlFor(database));
    const target = new Client({ connectionString: url.toString() });
    await target.connect();
    try {
      const { rows } = await target.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public' order by tablename",
      );
      return rows.map((row) => row.tablename);
    } finally {
      await target.end();
    }
  });
}

describe('scripts/migrate.ts, the pre-deploy entry point', () => {
  it('applies every migration to an empty database, and is safe to run twice', async () => {
    const first = runEntry({ env: migrateEnv() });
    expect(first.status, first.output).toBe(0);

    const second = runEntry({ env: migrateEnv() });
    expect(second.status, second.output).toBe(0);

    expect(await publicTables()).toEqual([
      'account_balances',
      'accounts',
      'app_meta',
      'audit_log',
      'auth_otps',
      'characters',
      'ledger_entries',
      'ledger_transactions',
      'rate_limits',
      'sessions',
      'transfers',
      'users',
    ]);

    const applied = await withAdminClient(async (client) => {
      const target = new Client({ connectionString: urlFor(database) });
      await target.connect();
      try {
        const { rows } = await target.query<{ count: number }>(
          'select count(*)::int as count from drizzle.__drizzle_migrations',
        );
        return rows[0]?.count ?? 0;
      } finally {
        await target.end();
      }
    });

    // Every migration file, once: the second run found nothing pending.
    const migrationFiles = readdirSync(join(REPO_ROOT, 'drizzle')).filter((name) =>
      name.endsWith('.sql'),
    );
    expect(applied).toBe(migrationFiles.length);
    expect(applied).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('needs only the database variables, not the rest of the application environment', async () => {
    // A short pepper and no email provider would fail the application's own
    // validation. A migration touches neither, so it must still run.
    const result = runEntry({
      env: migrateEnv({ IP_HASH_PEPPER: 'short', DATABASE_SSL: 'disable' }),
    });

    expect(result.status, result.output).toBe(0);
    expect(result.output).not.toMatch(/IP_HASH_PEPPER|EMAIL_PROVIDER/);
  }, 60_000);

  it('never loads a .env file in production, and does load one locally', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-migrate-cwd-'));
    writeFileSync(join(dir, '.env'), `DATABASE_URL=${urlFor(database)}\n`);

    try {
      // Production: the file is sitting right there and must be ignored, so with
      // no DATABASE_URL in the environment there is nothing to migrate.
      const production = runEntry({ cwd: dir, env: { NODE_ENV: 'production' } });
      expect(production.status).not.toBe(0);
      expect(production.output).toMatch(/DATABASE_URL/);

      // Development: the same file, in the same directory, is read.
      const development = runEntry({ cwd: dir, env: { NODE_ENV: 'development' } });
      expect(development.status, development.output).toBe(0);

      // And the migrations folder came from the script, not from this directory.
      expect(await publicTables()).toContain('users');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails with a clear message and never prints the connection string', async () => {
    const secretish = 'postgresql://someone:hunter2-should-not-appear@127.0.0.1:59999/nothing';

    const unreachable = runEntry({ env: { DATABASE_URL: secretish, NODE_ENV: 'production' } });
    expect(unreachable.status).not.toBe(0);
    expect(unreachable.output).not.toContain('hunter2-should-not-appear');
    expect(unreachable.output).toMatch(/Migration failed/);

    const missing = runEntry({ env: { NODE_ENV: 'production' } });
    expect(missing.status).not.toBe(0);
    expect(missing.output).toMatch(/DATABASE_URL_MIGRATE \/ DATABASE_URL/);
  }, 60_000);

  it('lets two deploys race: one waits for the lock, both succeed, nothing applies twice', async () => {
    const spawnOnce = () =>
      new Promise<{ status: number | null; output: string }>((resolve) => {
        const child: ChildProcess = spawn(
          process.execPath,
          ['--experimental-strip-types', '--no-warnings', ENTRY],
          {
            cwd: REPO_ROOT,
            env: childEnv(migrateEnv()),
          },
        );
        let output = '';
        child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
        child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
        child.on('close', (status: number | null) => resolve({ status, output }));
      });

    const results = await Promise.all([spawnOnce(), spawnOnce()]);

    for (const result of results) expect(result.status, result.output).toBe(0);

    const tables = await publicTables();
    expect(tables).toContain('users');
    expect(tables.filter((name) => name === 'users')).toHaveLength(1);
  }, 60_000);
});
