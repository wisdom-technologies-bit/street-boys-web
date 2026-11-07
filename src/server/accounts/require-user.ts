import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { findCharacterByUserId } from '@/server/accounts/repository';
import { findSessionUser, type CurrentUser } from '@/server/accounts/session';
import type { Avatar } from '@/shared/avatar-options';

/**
 * Access gating for pages, in a server component.
 *
 * No middleware and no Edge runtime, because the app has to run on any Node host
 * (D-139). A page calls one of the helpers below, which asks the database who is
 * signed in and redirects before rendering anything private.
 *
 * The decision itself is a pure function, `decidePageAccess`, so every redirect
 * case is a unit test rather than a browser test.
 */

export type PagePath = '/login' | '/create-character' | '/home' | '/';

export type AccessDecision = { action: 'allow' } | { action: 'redirect'; to: string };

export type AccessInput = {
  /** `null` when there is no valid session, including a frozen or banned account. */
  signedIn: boolean;
  hasCharacter: boolean;
  path: PagePath;
};

/**
 * The one place the page rules are written down.
 *
 * - Signed out, and the page needs a player: to /login.
 * - Signed in without a character, on /home: to /create-character.
 * - Signed in with a character, on /login or /create-character: to /home.
 * - Everything else is allowed.
 */
export function decidePageAccess({ signedIn, hasCharacter, path }: AccessInput): AccessDecision {
  if (!signedIn) {
    return path === '/login' || path === '/'
      ? { action: 'allow' }
      : { action: 'redirect', to: '/login' };
  }

  if (!hasCharacter) {
    return path === '/create-character'
      ? { action: 'allow' }
      : { action: 'redirect', to: '/create-character' };
  }

  if (path === '/login' || path === '/create-character') {
    return { action: 'redirect', to: '/home' };
  }

  return { action: 'allow' };
}

/** The frozen and banned landing page. Neutral: it says nothing about why. */
export const ACCOUNT_UNAVAILABLE_PATH = '/account-unavailable';

/**
 * The user for this request, or null. A frozen or banned account is sent to the
 * neutral page rather than treated as signed out, so a player is never told to
 * sign in again for a reason signing in cannot fix.
 */
export async function getPageUser(): Promise<CurrentUser | null> {
  const user = await findSessionUser(await requestFromHeaders());
  if (!user) return null;
  if (user.status !== 'active') redirect(ACCOUNT_UNAVAILABLE_PATH);
  return user;
}

export type PageUser = { user: CurrentUser; character: { name: string; avatar: Avatar } | null };

/** A signed-in player with a character, or a redirect. */
export async function requirePlayer(): Promise<
  PageUser & { character: { name: string; avatar: Avatar } }
> {
  const user = await getPageUser();
  if (!user) redirect('/login');

  const character = await findCharacterByUserId(user.id);
  if (!character) redirect('/create-character');

  return { user, character };
}

/** Login and character creation: a player who already has a character goes home. */
export async function requireNoCharacter(): Promise<{ user: CurrentUser | null }> {
  const user = await getPageUser();
  if (!user) return { user: null };

  const character = await findCharacterByUserId(user.id);
  if (character) redirect('/home');

  return { user };
}

/**
 * A `Request` built from the incoming headers, so the session module can read the
 * cookie without this module knowing how a cookie is represented. `headers()` is
 * a dynamic API, which is also what marks these pages as uncached.
 */
async function requestFromHeaders(): Promise<Request> {
  const incoming = await headers();
  return new Request('http://localhost/', { headers: incoming });
}
