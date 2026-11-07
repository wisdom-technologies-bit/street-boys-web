import Link from 'next/link';
import { copy } from './copy';

/** No detail about what was looked for, and no stack trace. */
export default function NotFound() {
  return (
    <main className="page">
      <h1>{copy.notFound.heading}</h1>
      <p>{copy.notFound.body}</p>
      <Link href="/">{copy.notFound.home}</Link>
    </main>
  );
}
