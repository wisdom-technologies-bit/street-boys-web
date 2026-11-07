'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { copy } from '../copy';

/**
 * Signs out through the API and then goes to the landing page. The server has
 * already cleared the cookie by the time the navigation runs, so the landing page
 * renders as signed out.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } finally {
      router.replace('/');
      router.refresh();
    }
  }

  return (
    <button type="button" className="secondary" onClick={signOut} disabled={busy}>
      {copy.auth.signOut}
    </button>
  );
}
