/**
 * `npm run db:migrate` — the pre-deploy migration step.
 *
 * Run by the platform before the new version starts serving traffic (Render
 * `preDeployCommand`, Railway pre-deploy, a Vercel build step or a human at a
 * terminal). Never imported by the app, and never called from a route handler:
 * a migration that runs on request is a migration that runs on every cold start
 * and eventually runs twice at once.
 *
 * Two ways to run this one file, and they must behave identically:
 *
 * - **A developer**, with `npm run db:migrate`, which runs this TypeScript
 *   directly through Node's type stripping.
 * - **A production image**, with `node dist/migrate.mjs`, a bundle built at image
 *   build time (`npm run build:migrate`). The image installs production
 *   dependencies only, so this file and everything it imports must survive
 *   without `dotenv`, `tsx`, `drizzle-kit` or TypeScript. See
 *   `docs/migrate-in-production.md`.
 *
 * It reads `DATABASE_URL_MIGRATE` and falls back to `DATABASE_URL`, because a
 * pooled URL can route the advisory lock and the unlock to different backends.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMigrationEnv, resolveMigrationConnectionUrl } from '../src/server/config/env.ts';
import { loadLocalEnvFile } from '../src/server/config/load-env-file.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { resolveSsl } from '../src/server/db/ssl.ts';

/**
 * The migrations folder, **relative to this file** and not to the current
 * directory.
 *
 * A platform runs the pre-deploy command from wherever it likes, and the script
 * itself sits one level under the repository root in both shapes: `scripts/` for
 * a developer, `dist/` for the bundle. Resolving from `process.cwd()` worked by
 * luck locally and would have applied nothing, or failed obscurely, in an image.
 */
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** Never let a connection string reach a log, whatever a driver puts in an error. */
export function redactConnectionStrings(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database URL redacted]');
}

async function main(): Promise<void> {
  // Local development only: in production the platform supplies the environment.
  loadLocalEnvFile();

  const env = parseMigrationEnv(process.env);
  const connectionString = resolveMigrationConnectionUrl(env);

  if (!existsSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'))) {
    throw new Error(
      `No migrations found at ${MIGRATIONS_FOLDER}. The image must copy the drizzle folder next to this script.`,
    );
  }

  const started = Date.now();
  await runMigrations({
    connectionString,
    migrationsFolder: MIGRATIONS_FOLDER,
    ssl: resolveSsl(env),
    lockWaitMs: 60_000,
  });

  // Only the outcome is printed: no URL, no host, no user.
  console.log(`Migrations applied in ${Date.now() - started}ms.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Migration failed: ${redactConnectionStrings(message)}`);
  process.exitCode = 1;
});
