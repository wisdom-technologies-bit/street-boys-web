/**
 * `npm run db:migrate` — the pre-deploy migration step.
 *
 * Run by the platform before the new version starts serving traffic (Render
 * `preDeployCommand`, Railway pre-deploy, a Vercel build step or a human at a
 * terminal). Never imported by the app, and never called from a route handler:
 * a migration that runs on request is a migration that runs on every cold start
 * and eventually runs twice at once.
 *
 * It prefers `DATABASE_URL_MIGRATE` (a direct connection) and falls back to
 * `DATABASE_URL`, because a pooled URL can route the lock and the unlock to
 * different backends.
 *
 * Node runs this TypeScript directly for a developer (`node
 * --experimental-strip-types`, default from Node 22.18 / 23.6). In a production
 * image the same file is bundled to plain JavaScript at image build time, so the
 * runtime needs no TypeScript, no bundler and no `dotenv`: see
 * `docs/migrate-in-production.md`.
 */
import { loadLocalEnvFile } from '../src/server/config/load-env-file.ts';
import { parseEnv, resolveMigrationDatabaseUrl } from '../src/server/config/env.ts';
import { resolveSsl } from '../src/server/db/ssl.ts';
import { runMigrations } from '../src/server/db/migrate.ts';

async function main(): Promise<void> {
  // Local development only: in production the platform supplies the environment.
  loadLocalEnvFile();

  const env = parseEnv(process.env);
  // A direct connection: the advisory lock must live on one backend.
  const connectionString = resolveMigrationDatabaseUrl(env);

  const started = Date.now();
  await runMigrations({
    connectionString,
    migrationsFolder: './drizzle',
    ssl: resolveSsl(env),
    lockWaitMs: 60_000,
  });

  // Only the outcome is printed: no URL, no host, no user.
  console.log(`Migrations applied in ${Date.now() - started}ms.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Migration failed: ${message}`);
  process.exitCode = 1;
});
