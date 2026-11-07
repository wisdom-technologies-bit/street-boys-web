import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalletPanel, type StatementLine } from './wallet-panel';

/**
 * The money block, in both of its homes.
 *
 * What these check is what a player relies on: the balance is shown as money, an empty
 * statement says so instead of looking broken, "Load more" appends rather than
 * replaces, and a wallet that is not ready or restricted never turns into an error page.
 */

const LINE: StatementLine = {
  id: '2',
  at: '2026-11-07T08:00:00.000Z',
  amountKobo: '500000',
  balanceAfterKobo: '500000',
  category: 'onboarding_grant',
};

const SPEND: StatementLine = {
  id: '3',
  at: '2026-11-07T09:00:00.000Z',
  amountKobo: '-115000',
  balanceAfterKobo: '385000',
  category: 'food',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('on /home', () => {
  it('shows the balance as money, with the last few lines and a link', () => {
    render(
      <WalletPanel
        mode="home"
        wallet={{ balanceKobo: '500000', formatted: '₦5,000.00', restricted: false }}
        initialEntries={[LINE]}
        initialCursor={null}
        limit={5}
      />,
    );

    expect(screen.getByTestId('balance').textContent).toBe('₦5,000.00');
    // The sign is printed, not implied by colour: a credit reads as a plus.
    expect(screen.getByText('+₦5,000.00')).toBeTruthy();
    expect(screen.getByText('Starting money')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /see all money in and out/i }).getAttribute('href'),
    ).toBe('/wallet');
    // The home view never grows: no load-more button even with a cursor.
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('says the wallet is being set up instead of showing a zero', () => {
    render(
      <WalletPanel
        mode="home"
        wallet={{ setupPending: true }}
        initialEntries={[]}
        initialCursor={null}
      />,
    );

    expect(screen.getByText(/setting up your wallet/i)).toBeTruthy();
    expect(screen.queryByTestId('balance')).toBeNull();
  });
});

describe('on /wallet', () => {
  it('shows an empty statement as a sentence, with no load-more button', () => {
    render(
      <WalletPanel
        mode="full"
        wallet={{ balanceKobo: '0', formatted: '₦0.00', restricted: false }}
        initialEntries={[]}
        initialCursor={null}
      />,
    );

    expect(screen.getByText(/nothing has moved yet/i)).toBeTruthy();
    expect(screen.queryAllByTestId('statement-line')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('writes a debit with a minus and an unknown category as Other', () => {
    render(
      <WalletPanel
        mode="full"
        wallet={{ balanceKobo: '385000', formatted: '₦3,850.00', restricted: false }}
        initialEntries={[{ ...SPEND, category: 'job_pay_v2' }]}
        initialCursor={null}
      />,
    );

    expect(screen.getByText('-₦1,150.00')).toBeTruthy();
    // The balance after the line is 3,850 too, which is the balance shown above.
    expect(screen.getAllByText('₦3,850.00')).toHaveLength(2);
    expect(screen.getByText('Other')).toBeTruthy();
    expect(screen.queryByText('job_pay_v2')).toBeNull();
  });

  it('appends the next page when Load more is pressed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entries: [SPEND], nextCursor: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <WalletPanel
        mode="full"
        wallet={{ balanceKobo: '500000', formatted: '₦5,000.00', restricted: false }}
        initialEntries={[LINE]}
        initialCursor={LINE.id}
        limit={1}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getAllByTestId('statement-line')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/wallet/statement?limit=1&before=${LINE.id}`,
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
    // Both lines are there, the first one included: a page appends, it does not replace.
    expect(screen.getByText('+₦5,000.00')).toBeTruthy();
    expect(screen.getByText('-₦1,150.00')).toBeTruthy();
    // And with no cursor left, the button is gone.
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('keeps the lines it has when a page fails, and says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    render(
      <WalletPanel
        mode="full"
        wallet={{ balanceKobo: '500000', formatted: '₦5,000.00', restricted: false }}
        initialEntries={[LINE]}
        initialCursor={LINE.id}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getByText(/did not load/i)).toBeTruthy());
    expect(screen.getAllByTestId('statement-line')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /load more/i }).hasAttribute('disabled')).toBe(false);
  });

  it('shows a restricted wallet as a neutral sentence and no detail', () => {
    render(
      <WalletPanel
        mode="full"
        wallet={{ balanceKobo: '500000', formatted: '₦5,000.00', restricted: true }}
        initialEntries={[LINE]}
        initialCursor={null}
      />,
    );

    expect(screen.getByText(/some actions are temporarily unavailable/i)).toBeTruthy();
    // The balance is still shown: being restricted is not being hidden from yourself.
    expect(screen.getByTestId('balance').textContent).toBe('₦5,000.00');
    expect(screen.queryByText(/frozen|banned|suspended/i)).toBeNull();
  });
});
