'use client';

import { copy } from './copy';

/** Says nothing about what broke. The digest stays in the server log. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <h1>{copy.error.heading}</h1>
      <p>{copy.error.body}</p>
      <button type="button" onClick={reset}>
        {copy.error.retry}
      </button>
    </main>
  );
}
