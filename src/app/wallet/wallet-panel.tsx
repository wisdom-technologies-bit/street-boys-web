'use client';

import { useState } from 'react';
import { copy } from '../copy';
import { formatKoboString, formatSignedKoboString } from '@/shared/money-format';

/**
 * The money block: a balance, and a statement that can load more.
 *
 * One component for both screens. `/home` renders it with five lines and a link to the
 * wallet; `/wallet` renders it with twenty and a "Load more" button. Keeping it in one
 * place means the balance, the signs and the empty state cannot drift between the two.
 *
 * The initial data is passed in by the server component, so a player sees their money
 * before any JavaScript runs. Only "Load more" talks to the network, which is why the
 * first-load bundle does not carry a data layer.
 *
 * Amounts are strings of kobo all the way through and are formatted by the shared
 * formatter: nothing here parses money into a `number`, and every movement carries an
 * explicit `+` or `-` so the direction of the money does not depend on colour.
 */

export type StatementLine = {
  id: string;
  at: string;
  amountKobo: string;
  balanceAfterKobo: string;
  category: string;
};

export type WalletBalance =
  { balanceKobo: string; formatted: string; restricted: boolean } | { setupPending: true };

export type WalletPanelProps = {
  wallet: WalletBalance;
  initialEntries: StatementLine[];
  initialCursor: string | null;
  /** `home` shows the last few lines and a link; `full` shows the statement itself. */
  mode: 'home' | 'full';
  limit?: number;
};

export function WalletPanel({
  wallet,
  initialEntries,
  initialCursor,
  mode,
  limit = 20,
}: WalletPanelProps) {
  const [entries, setEntries] = useState<StatementLine[]>(initialEntries);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(
        `/api/wallet/statement?limit=${limit}&before=${encodeURIComponent(cursor)}`,
        { headers: { accept: 'application/json' } },
      );
      if (!response.ok) throw new Error('statement request failed');
      const body = (await response.json()) as {
        entries: StatementLine[];
        nextCursor: string | null;
        setupPending?: true;
      };
      setEntries((current) => [...current, ...body.entries]);
      setCursor(body.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if ('setupPending' in wallet) {
    return (
      <section className="card" aria-label={copy.wallet.balanceLabel}>
        <p className="muted">{copy.wallet.balanceLabel}</p>
        <p>{copy.wallet.setupPending}</p>
      </section>
    );
  }

  return (
    <>
      <section className="card" aria-label={copy.wallet.balanceLabel}>
        <p className="muted">{copy.wallet.balanceLabel}</p>
        <p data-testid="balance">{wallet.formatted}</p>
        {wallet.restricted ? <p className="hint">{copy.wallet.restricted}</p> : null}
      </section>

      <section className="card" aria-label={copy.wallet.statementHeading}>
        <h2>{mode === 'home' ? copy.home.recentHeading : copy.wallet.statementHeading}</h2>

        {entries.length === 0 ? (
          <p className="hint">{copy.wallet.emptyStatement}</p>
        ) : (
          <ul className="statement">
            {entries.map((entry) => (
              <li key={entry.id} data-testid="statement-line">
                <span className="statement__what">{copy.wallet.categoryLabel(entry.category)}</span>
                <span className="statement__when">{entry.at.slice(0, 10)}</span>
                <span className="statement__amount">
                  {formatSignedKoboString(entry.amountKobo)}
                </span>
                <span className="statement__after">{formatKoboString(entry.balanceAfterKobo)}</span>
              </li>
            ))}
          </ul>
        )}

        {failed ? <p className="hint">{copy.wallet.loadMoreFailed}</p> : null}

        {mode === 'home' ? (
          // A plain anchor on purpose: `next/link` pulls the router's prefetch
          // machinery into this page's client bundle for a single navigation, and
          // this page has a first-load JavaScript budget to respect.
          <a href="/wallet">{copy.wallet.viewStatement}</a>
        ) : cursor ? (
          <button className="button" type="button" onClick={loadMore} disabled={busy}>
            {busy ? copy.wallet.loadingMore : copy.wallet.loadMore}
          </button>
        ) : null}
      </section>
    </>
  );
}
