import { copy } from '../copy';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default function PrivacyPage() {
  return (
    <main className="page">
      <h1>{copy.privacy.heading}</h1>
      <p className="error">{copy.privacy.draft}</p>
      <p>{copy.privacy.body}</p>
    </main>
  );
}
