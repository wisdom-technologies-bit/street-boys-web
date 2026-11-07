import { requireNoCharacter } from '@/server/accounts/require-user';
import { LoginForm } from './form';

/**
 * One sign-in page, three steps inside it. A player who already has a character
 * is sent to /home by the gate, so this page never renders for them.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function LoginPage() {
  await requireNoCharacter();
  return <LoginForm />;
}
