import Link from 'next/link';
import { copy } from '../copy';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/** Neutral on purpose: a frozen player is not told why, and not told to sign in again. */
export default function AccountUnavailablePage() {
  return (
    <main className="page">
      <h1>{copy.unavailable.heading}</h1>
      <p>{copy.unavailable.body}</p>
      <Link href="/">{copy.unavailable.home}</Link>
    </main>
  );
}
