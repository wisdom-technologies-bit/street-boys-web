import { copy } from '../copy';

export const dynamic = 'force-dynamic';

/** A placeholder, and it says so. No invented legal text. */
export const metadata = { robots: { index: false, follow: false } };

export default function TermsPage() {
  return (
    <main className="page">
      <h1>{copy.terms.heading}</h1>
      <p className="error">{copy.terms.draft}</p>
      <p>{copy.terms.body}</p>
    </main>
  );
}
