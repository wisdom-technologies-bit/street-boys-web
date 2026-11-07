import { describe, expect, it } from 'vitest';
import { MAX_EMAIL_LENGTH, canonicalizeEmail, checkEmail } from './email';

describe('checkEmail — normalising', () => {
  it('trims and lowercases', () => {
    const result = checkEmail('  Someone@Example.COM  ');
    expect(result).toMatchObject({ ok: true, email: 'someone@example.com' });
  });

  it('keeps a plus tag on an ordinary domain', () => {
    const result = checkEmail('someone+news@example.com');
    expect(result).toMatchObject({ ok: true, canonical: 'someone+news@example.com' });
  });
});

describe('checkEmail — rejections', () => {
  it('rejects an empty value', () => {
    expect(checkEmail('   ')).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('rejects an address longer than 254 characters', () => {
    const local = 'a'.repeat(MAX_EMAIL_LENGTH);
    expect(checkEmail(`${local}@example.com`)).toMatchObject({ ok: false, reason: 'too_long' });
  });

  it('accepts an address exactly 254 characters long', () => {
    const domain = '@example.com';
    const local = 'a'.repeat(MAX_EMAIL_LENGTH - domain.length);
    expect(checkEmail(`${local}${domain}`)).toMatchObject({ ok: true });
  });

  it('rejects non-ASCII characters', () => {
    expect(checkEmail('mọ́níkẹ́@example.com')).toMatchObject({ ok: false, reason: 'non_ascii' });
  });

  it('rejects a missing @, a missing domain and stray spaces', () => {
    for (const bad of ['someone', 'someone@', '@example.com', 'some one@example.com', 'a@@b.com']) {
      expect(checkEmail(bad)).toMatchObject({ ok: false, reason: 'invalid_format' });
    }
  });

  it('rejects a disposable domain', () => {
    expect(checkEmail('someone@mailinator.com')).toMatchObject({
      ok: false,
      reason: 'disposable_domain',
    });
  });

  it('rejects a disposable domain whatever its case', () => {
    expect(checkEmail('someone@YOPMAIL.com')).toMatchObject({ ok: false, reason: 'disposable_domain' });
  });
});

describe('canonicalizeEmail — gmail', () => {
  it('removes dots from the local part', () => {
    expect(canonicalizeEmail('some.one@gmail.com')).toBe('someone@gmail.com');
  });

  it('removes the +tag', () => {
    expect(canonicalizeEmail('someone+news@gmail.com')).toBe('someone@gmail.com');
  });

  it('removes both, in any order', () => {
    expect(canonicalizeEmail('so.me.one+a.b@gmail.com')).toBe('someone@gmail.com');
  });

  it('maps googlemail.com to gmail.com', () => {
    expect(canonicalizeEmail('some.one+tag@googlemail.com')).toBe('someone@gmail.com');
  });

  it('treats the dotted and tagged forms as the same account', () => {
    const variants = [
      'some.one@gmail.com',
      'someone+tag@gmail.com',
      'Some.One+Tag@GoogleMail.com',
    ];
    const canonicals = new Set(variants.map((v) => canonicalizeEmail(v)));
    expect(canonicals.size).toBe(1);
  });
});

describe('canonicalizeEmail — other providers', () => {
  it('removes only the +tag on outlook', () => {
    expect(canonicalizeEmail('some.one+tag@outlook.com')).toBe('some.one@outlook.com');
  });

  it('keeps dots on a provider that does not ignore them', () => {
    expect(canonicalizeEmail('some.one@example.com')).toBe('some.one@example.com');
  });

  it('removes only the +tag on protonmail and fastmail', () => {
    expect(canonicalizeEmail('a+b@protonmail.com')).toBe('a@protonmail.com');
    expect(canonicalizeEmail('a+b@fastmail.com')).toBe('a@fastmail.com');
  });

  it('leaves an address without a tag or dot alone', () => {
    expect(canonicalizeEmail('someone@icloud.com')).toBe('someone@icloud.com');
  });

  it('does not touch a plus sign in the domain', () => {
    expect(canonicalizeEmail('someone@example.com')).toBe('someone@example.com');
  });
});
