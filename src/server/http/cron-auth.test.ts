import { describe, expect, it } from 'vitest';
import { isCronRequestAuthorized } from './cron-auth';

describe('isCronRequestAuthorized', () => {
  const secret = 'a-long-enough-cron-secret-value';

  it('accepts the correct bearer token', () => {
    expect(isCronRequestAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(isCronRequestAuthorized('Bearer not-the-secret-at-all', secret)).toBe(false);
  });

  it('rejects a token that is a prefix of the secret', () => {
    expect(isCronRequestAuthorized(`Bearer ${secret.slice(0, 10)}`, secret)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isCronRequestAuthorized(null, secret)).toBe(false);
  });

  it('rejects a header without the Bearer prefix', () => {
    expect(isCronRequestAuthorized(secret, secret)).toBe(false);
  });

  it('rejects basic auth', () => {
    expect(isCronRequestAuthorized(`Basic ${secret}`, secret)).toBe(false);
  });

  it('refuses everything when the secret is unset', () => {
    expect(isCronRequestAuthorized('Bearer anything', undefined)).toBe(false);
    expect(isCronRequestAuthorized('Bearer ', '')).toBe(false);
  });
});
