/**
 * Fixed values for tests.
 *
 * A pepper is a secret in production and a constant here: the tests need to
 * reproduce a known answer, and a random pepper would make an HMAC test
 * unverifiable. It is deliberately obvious, and it is never a real value.
 */
export const TEST_IP_HASH_PEPPER = 'test-pepper-not-a-real-secret-0123456789abcdef';

/**
 * Apply the test environment. Called from the unit setup and the database setup,
 * so no test depends on what happens to be in the developer's shell.
 */
export function applyTestEnv(): void {
  process.env.IP_HASH_PEPPER = TEST_IP_HASH_PEPPER;
}
