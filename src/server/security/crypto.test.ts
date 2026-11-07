import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  hmacSha256,
  randomSixDigitCode,
  randomToken,
  sha256Hex,
} from './crypto';

const PEPPER = 'test-pepper-not-a-real-secret-0123456789abcdef';

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the known digest of the empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('hmacSha256', () => {
  it('matches RFC 4231 test case 2 (key "Jefe")', () => {
    expect(hmacSha256('what do ya want for nothing?', 'Jefe')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('returns 64 hex characters', () => {
    // RFC vectors with binary keys do not apply here: the pepper is a UTF-8
    // string, which is what a deployment actually provides.
    expect(hmacSha256('value', 'Jefe')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the pepper changes', () => {
    expect(hmacSha256('someone@example.com', PEPPER)).not.toBe(
      hmacSha256('someone@example.com', PEPPER + 'x'),
    );
  });

  it('is stable for the same input and pepper', () => {
    expect(hmacSha256('someone@example.com', PEPPER)).toBe(
      hmacSha256('someone@example.com', PEPPER),
    );
  });

  it('refuses an empty pepper rather than hashing without one', () => {
    expect(() => hmacSha256('value', '')).toThrow(/pepper/);
  });

  it('does not return the plaintext', () => {
    const digest = hmacSha256('someone@example.com', PEPPER);
    expect(digest).not.toContain('someone');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('constantTimeEqual', () => {
  it('is true for identical strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
  });

  it('is false for different strings, including different lengths', () => {
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
  });
});

describe('randomToken', () => {
  it('produces 32 bytes of base64url by default', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('randomSixDigitCode', () => {
  it('is always exactly six digits', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomSixDigitCode()).toMatch(/^[0-9]{6}$/);
    }
  });

  it('produces more than one distinct value', () => {
    const codes = new Set(Array.from({ length: 50 }, () => randomSixDigitCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
