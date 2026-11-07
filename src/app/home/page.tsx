import { requirePlayer } from '@/server/accounts/require-user';
import { getWalletOverview, toStatementLine } from '@/server/wallet';
import { copy } from '../copy';
import { SignOutButton } from './sign-out';
import { WalletPanel } from '../wallet/wallet-panel';
import { formatNaira } from '@/shared/money-format';

/**
 * The home screen: who you are, what you have, and the last few things that moved.
 *
 * The money block is the same component `/wallet` uses, limited to five lines with a
 * link through to the full statement, so the two screens cannot disagree about a
 * balance. It is loaded on the server: a player sees their money with no JavaScript.
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
  const { user, character } = await requirePlayer();
  const { avatar } = character;
  const overview = await getWalletOverview(user.id, 5);

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

      <WalletPanel
        mode="home"
        wallet={
          'setupPending' in overview.wallet
            ? { setupPending: true }
            : {
                balanceKobo: overview.wallet.balanceKobo.toString(),
                formatted: formatNaira(overview.wallet.balanceKobo),
                restricted: overview.wallet.restricted,
              }
        }
        initialEntries={overview.entries.map(toStatementLine)}
        initialCursor={overview.nextCursor}
        limit={5}
      />

      <SignOutButton />
    </main>
  );
}
