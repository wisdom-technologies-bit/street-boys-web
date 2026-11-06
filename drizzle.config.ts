import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in (names only in the repo).',
  );
}

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
