'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import {
  AVATAR_HAIR_COLOURS,
  AVATAR_HAIR_STYLES,
  AVATAR_OUTFIT_COLOURS,
  AVATAR_OUTFITS,
  AVATAR_SKIN_COLOURS,
  AVATAR_SKIN_TONES,
  DEFAULT_AVATAR,
  type Avatar,
  type AvatarHairStyle,
  type AvatarOutfit,
  type AvatarSkinTone,
} from '@/shared/avatar-options';
import { copy } from '../copy';

/**
 * Character creation.
 *
 * The pickers are radio groups of colour swatches with the option number as the
 * label: no images, no icon font, and every option reachable from a keyboard. The
 * preview is three coloured divs, which is what the game will draw later.
 *
 * The client imports the option ids from `src/shared` and nothing from the server,
 * so the picker and the API cannot disagree about which ids are valid.
 */

type Field = 'name' | 'avatar' | 'form';

function messageFor(code: string): { field: Field; text: string } {
  switch (code) {
    case 'name_not_allowed':
      return { field: 'name', text: copy.errors.name_not_allowed };
    case 'name_taken':
      return { field: 'name', text: copy.errors.name_taken };
    case 'avatar_invalid':
      return { field: 'avatar', text: copy.errors.avatar_invalid };
    case 'already_has_character':
      return { field: 'form', text: copy.errors.already_has_character };
    case 'rate_limited':
      return { field: 'form', text: copy.errors.rate_limited(0) };
    case 'unauthorized':
      return { field: 'form', text: copy.errors.unauthorized };
    case 'forbidden':
      return { field: 'form', text: copy.errors.forbidden };
    case 'invalid_request':
      return { field: 'form', text: copy.errors.invalid_request };
    default:
      return { field: 'form', text: copy.errors.unknown };
  }
}

export function CharacterForm() {
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<Avatar>(DEFAULT_AVATAR);
  const [error, setError] = useState<{ field: Field; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/character', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, avatar }),
      });

      if (response.status === 201) {
        router.replace('/home');
        router.refresh();
        return;
      }

      let code = '';
      try {
        const body = (await response.json()) as { error?: string };
        code = String(body.error ?? '');
      } catch {
        code = '';
      }
      setError(messageFor(code));
    } catch {
      setError({ field: 'form', text: copy.errors.network });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page--wide">
      <h1>{copy.character.heading}</h1>
      <p className="muted">{copy.character.intro}</p>

      <p role="alert" aria-live="polite" className="error">
        {error?.field === 'form' ? error.text : ''}
      </p>

      <form className="card" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor={nameId}>{copy.character.nameLabel}</label>
          <input
            id={nameId}
            type="text"
            name="name"
            autoComplete="nickname"
            required
            minLength={3}
            maxLength={20}
            placeholder={copy.character.namePlaceholder}
            value={name}
            aria-describedby={`${nameId}-rules`}
            aria-invalid={error?.field === 'name'}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="hint" id={`${nameId}-rules`}>
            {copy.character.nameRules}
          </p>
        </div>
        <p role="alert" aria-live="polite" className="error">
          {error?.field === 'name' ? error.text : ''}
        </p>

        <fieldset className="choices">
          <legend>{copy.character.skinTone}</legend>
          {AVATAR_SKIN_TONES.map((tone) => (
            <div className="choice" key={tone}>
              <input
                id={`skin-${tone}`}
                type="radio"
                name="skinTone"
                value={tone}
                checked={avatar.skinTone === tone}
                onChange={() => setAvatar({ ...avatar, skinTone: tone as AvatarSkinTone })}
              />
              <label htmlFor={`skin-${tone}`}>
                <span
                  className="swatch"
                  style={{ background: AVATAR_SKIN_COLOURS[tone] }}
                  aria-hidden="true"
                />
                <span className="hint">{copy.character.option('', tone).trim()}</span>
              </label>
            </div>
          ))}
        </fieldset>

        <fieldset className="choices">
          <legend>{copy.character.hair}</legend>
          {AVATAR_HAIR_STYLES.map((style) => (
            <div className="choice" key={style}>
              <input
                id={`hair-${style}`}
                type="radio"
                name="hair"
                value={style}
                checked={avatar.hair === style}
                onChange={() => setAvatar({ ...avatar, hair: style as AvatarHairStyle })}
              />
              <label htmlFor={`hair-${style}`}>
                <span
                  className="swatch"
                  style={{ background: AVATAR_HAIR_COLOURS[style] }}
                  aria-hidden="true"
                />
                <span className="hint">{copy.character.option('', style).trim()}</span>
              </label>
            </div>
          ))}
        </fieldset>

        <fieldset className="choices">
          <legend>{copy.character.outfit}</legend>
          {AVATAR_OUTFITS.map((outfit) => (
            <div className="choice" key={outfit}>
              <input
                id={`outfit-${outfit}`}
                type="radio"
                name="outfit"
                value={outfit}
                checked={avatar.outfit === outfit}
                onChange={() => setAvatar({ ...avatar, outfit: outfit as AvatarOutfit })}
              />
              <label htmlFor={`outfit-${outfit}`}>
                <span
                  className="swatch"
                  style={{ background: AVATAR_OUTFIT_COLOURS[outfit] }}
                  aria-hidden="true"
                />
                <span className="hint">{copy.character.option('', outfit).trim()}</span>
              </label>
            </div>
          ))}
        </fieldset>
        <p role="alert" aria-live="polite" className="error">
          {error?.field === 'avatar' ? error.text : ''}
        </p>

        <section aria-label={copy.character.preview} className="card">
          <div className="avatar" aria-hidden="true">
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <div
                className="avatar__hair"
                style={{ background: AVATAR_HAIR_COLOURS[avatar.hair] }}
              />
              <div
                className="avatar__head"
                style={{ background: AVATAR_SKIN_COLOURS[avatar.skinTone] }}
              />
            </div>
            <div
              className="avatar__body"
              style={{ background: AVATAR_OUTFIT_COLOURS[avatar.outfit] }}
            />
          </div>
          <p className="hint">
            {copy.character.previewSummary(avatar.skinTone, avatar.hair, avatar.outfit)}
          </p>
        </section>

        <button type="submit" disabled={busy}>
          {busy ? copy.character.submitting : copy.character.submit}
        </button>
      </form>
    </main>
  );
}
