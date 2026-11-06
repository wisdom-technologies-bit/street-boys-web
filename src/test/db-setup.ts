import { config as loadEnv } from 'dotenv';

/**
 * Runs before every database test file, in the worker that runs it.
 *
 * The application code reads DATABASE_URL, so the test run points DATABASE_URL at
 * the test database. That way the code under test is exactly production code and
 * can never touch a database that matters.
 */
loadEnv({ path: ['.env.test', '.env.local', '.env'], quiet: true });

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error('DATABASE_URL_TEST is not set');
}
process.env.DATABASE_URL = testUrl;
