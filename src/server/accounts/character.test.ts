import { describe, expect, it } from 'vitest';
import { canonicalizeName, checkAvatar, checkCharacterName } from './character';

describe('checkCharacterName — accepted', () => {
  it('accepts a plain name', () => {
    expect(checkCharacterName('Tunde')).toMatchObject({ ok: true, name: 'Tunde' });
  });

  it('accepts digits, single spaces and underscores', () => {
    for (const name of ['Tunde 99', 'Big_Man', 'a b c']) {
      expect(checkCharacterName(name)).toMatchObject({ ok: true });
    }
  });

  it('accepts exactly 3 and exactly 20 characters', () => {
    expect(checkCharacterName('abc')).toMatchObject({ ok: true });
    expect(checkCharacterName('a'.repeat(20))).toMatchObject({ ok: true });
  });

  it('keeps the display form but canonicalises separately', () => {
    const result = checkCharacterName('Big Man_99');
    expect(result).toMatchObject({ ok: true, name: 'Big Man_99', canonical: 'bigman99' });
  });
});

describe('checkCharacterName — rejected', () => {
  it('rejects an empty or whitespace-only name', () => {
    expect(checkCharacterName('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(checkCharacterName('   ')).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('rejects fewer than 3 and more than 20 characters', () => {
    expect(checkCharacterName('ab')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(checkCharacterName('a'.repeat(21))).toMatchObject({ ok: false, reason: 'too_long' });
  });

  it('rejects leading and trailing spaces', () => {
    expect(checkCharacterName(' Tunde')).toMatchObject({
      ok: false,
      reason: 'leading_or_trailing_space',
    });
    expect(checkCharacterName('Tunde ')).toMatchObject({
      ok: false,
      reason: 'leading_or_trailing_space',
    });
  });

  it('rejects double spaces', () => {
    expect(checkCharacterName('Big  Man')).toMatchObject({ ok: false, reason: 'double_space' });
  });

  it('rejects punctuation, emoji and non-ASCII letters', () => {
    for (const bad of ['Tunde!', 'Tunde-1', 'Tundé', 'Tunde😀', 'a.b']) {
      expect(checkCharacterName(bad)).toMatchObject({ ok: false, reason: 'invalid_characters' });
    }
  });

  it('rejects "Sys_tem" because its canonical form is reserved', () => {
    expect(checkCharacterName('Sys_tem')).toMatchObject({ ok: false, reason: 'reserved' });
  });

  it('rejects every spelling of a reserved name', () => {
    for (const bad of ['System', 'SYSTEM', 'sys tem', 'Admin', 'str_eet boys', 'Street Boys']) {
      expect(checkCharacterName(bad)).toMatchObject({ ok: false, reason: 'reserved' });
    }
  });

  it('rejects a blocked word hidden by separators', () => {
    expect(checkCharacterName('place_holderone')).toMatchObject({
      ok: false,
      reason: 'blocked_word',
    });
  });
});

describe('canonicalizeName', () => {
  it('lowercases and strips spaces and underscores', () => {
    expect(canonicalizeName('Big  Man_99')).toBe('bigman99');
  });

  it('gives the same canonical form for the same name written differently', () => {
    const forms = ['SysTem', 'sys tem', 'SYS_TEM'];
    expect(new Set(forms.map(canonicalizeName)).size).toBe(1);
  });
});

describe('checkAvatar', () => {
  it('accepts the first, last and a middle option', () => {
    expect(checkAvatar({ skinTone: 1, hair: 1, outfit: 1 })).toMatchObject({ ok: true });
    expect(checkAvatar({ skinTone: 6, hair: 8, outfit: 8 })).toMatchObject({ ok: true });
    expect(checkAvatar({ skinTone: 3, hair: 4, outfit: 5 })).toMatchObject({ ok: true });
  });

  it('rejects an id outside the options', () => {
    expect(checkAvatar({ skinTone: 7, hair: 1, outfit: 1 })).toMatchObject({ ok: false });
    expect(checkAvatar({ skinTone: 1, hair: 9, outfit: 1 })).toMatchObject({ ok: false });
    expect(checkAvatar({ skinTone: 0, hair: 1, outfit: 1 })).toMatchObject({ ok: false });
  });

  it('rejects strings, missing fields and extra data', () => {
    expect(checkAvatar({ skinTone: '1', hair: 1, outfit: 1 })).toMatchObject({ ok: false });
    expect(checkAvatar({ skinTone: 1, hair: 1 })).toMatchObject({ ok: false });
    expect(checkAvatar(null)).toMatchObject({ ok: false });
    expect(
      checkAvatar({ skinTone: 1, hair: 1, outfit: 1, imageUrl: 'https://evil.example/x.png' }),
    ).toMatchObject({ ok: true });
  });
});
