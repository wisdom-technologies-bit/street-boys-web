import Link from 'next/link';
import { copy } from './copy';
import { findCharacterByUserId } from '@/server/accounts/repository';
import { getPageUser } from '@/server/accounts/require-user';

/**
 * The landing page. Indexable, and the only page that does not require a session:
 * it says what the game is and sends a player into the flow they need.
 */
export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const user = await getPageUser();
  const character = user ? await findCharacterByUserId(user.id) : null;
  const destination = character ? '/home' : '/login';

  return (
    <main className="page">
      <h1>{copy.appName}</h1>
      <p>{copy.tagline}</p>
      <Link href={destination} className="button">
        <button type="button">
          {character ? copy.landing.continuePlaying : copy.landing.play}
        </button>
      </Link>
      <p className="muted">{copy.landing.comingSoon}</p>
    </main>
  );
}
