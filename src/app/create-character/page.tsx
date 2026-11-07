import { requireNoCharacter } from '@/server/accounts/require-user';
import { CharacterForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function CreateCharacterPage() {
  await requireNoCharacter();
  return <CharacterForm />;
}
