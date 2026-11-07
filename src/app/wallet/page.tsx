import { requirePlayer } from '@/server/accounts/require-user';
import { getWalletOverview, toStatementLine } from '@/server/wallet';
import { formatNaira } from '@/shared/money-format';
import { copy } from '../copy';
import { WalletPanel } from './wallet-panel';

/**
 * The wallet: the balance and the whole statement.
 *
 * Gated by the same server-side helper as every other private page, so a signed-out
 * visitor is redirected before anything is read. The first page is rendered on the
 * server; "Load more" is the only thing that needs the API.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Wallet', robots: { index: false, follow: false } };

export default async function WalletPage() {
  const { user } = await requirePlayer();
  const overview = await getWalletOverview(user.id, 20);

  return (
    <main className="page">
      <h1>{copy.wallet.heading}</h1>

      <WalletPanel
        mode="full"
        wallet={
          'setupPending' in overview.wallet
            ? { setupPending: true }
            : {
                balanceKobo: overview.wallet.balanceKobo.toString(),
                formatted: formatNaira(overview.wallet.balanceKobo),
                restricted: overview.wallet.restricted,
              }
        }
        initialEntries={overview.entries.map(toStatementLine)}
        initialCursor={overview.nextCursor}
        limit={20}
      />
    </main>
  );
}
