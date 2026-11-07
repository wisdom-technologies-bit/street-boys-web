import { requirePlayer } from '@/server/accounts/require-user';
import { copy } from '../copy';
import { SignOutButton } from './sign-out';

/**
 * The home screen: who you are, and nothing you can spend yet. The balance line
 * is deliberately "coming soon" because there is no ledger in this application.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const SKIN: Record<number, string> = {
  1: '#3b2620',
  2: '#5a3a2b',
  3: '#7b4f34',
  4: '#9c6b45',
  5: '#bd8a5f',
  6: '#dcae86',
};
const HAIR: Record<number, string> = {
  1: '#151515',
  2: '#241a15',
  3: '#3d2a1c',
  4: '#5b3a22',
  5: '#7a4a2b',
  6: '#d8b24a',
  7: '#8a3b2f',
  8: '#2f3f6b',
};
const OUTFIT: Record<number, string> = {
  1: '#2b5d8a',
  2: '#2f6b4f',
  3: '#7a2f4f',
  4: '#8a5a2b',
  5: '#4a4a4a',
  6: '#a33b32',
  7: '#3f5b8a',
  8: '#6b4a8a',
};

export default async function HomePage() {
  const { character } = await requirePlayer();
  const { avatar } = character;

  return (
    <main className="page">
      <h1>{copy.home.greeting(character.name)}</h1>

      <section className="card" aria-label={copy.home.avatarLabel}>
        <div className="avatar" aria-hidden="true">
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <div className="avatar__hair" style={{ background: HAIR[avatar.hair] ?? HAIR[1] }} />
            <div
              className="avatar__head"
              style={{ background: SKIN[avatar.skinTone] ?? SKIN[3] }}
            />
          </div>
          <div
            className="avatar__body"
            style={{ background: OUTFIT[avatar.outfit] ?? OUTFIT[1] }}
          />
        </div>
        <p className="hint">
          {copy.character.previewSummary(avatar.skinTone, avatar.hair, avatar.outfit)}
        </p>
      </section>

      <section className="card">
        <p className="muted">{copy.home.balanceLabel}</p>
        <p>{copy.home.balanceComingSoon}</p>
      </section>

      <SignOutButton />
    </main>
  );
}
