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
 * Node runs this TypeScript directly (`node --experimental-strip-types`, default
 * from Node 22.18 / 23.6), so there is no build step for a deploy script and no
 * extra dependency in the runtime image.
 */
import { config as loadEnv } from 'dotenv';
import { parseEnv, resolveMigrationDatabaseUrl } from '../src/server/config/env.ts';
import { resolveSsl } from '../src/server/db/ssl.ts';
import { runMigrations } from '../src/server/db/migrate.ts';

async function main(): Promise<void> {
  loadEnv({ path: ['.env.local', '.env'], quiet: true });

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
