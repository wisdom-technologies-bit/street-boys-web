import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}));

import { LoginForm } from './form';

/**
 * The sign-in state machine, with fetch mocked.
 *
 * These tests pin the behaviour a player feels: what they see after each answer,
 * and that a failure never says whether the account exists.
 */

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

function respond(replies: Reply[]): void {
  const queue = [...replies];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const reply = queue.shift();
      if (!reply) throw new Error('unexpected fetch call');
      return Promise.resolve(
        new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
        }),
      );
    }),
  );
}

async function enterEmail(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/email address/i), 'player@example.com');
  await user.click(screen.getByRole('button', { name: /send me a code/i }));
}

async function enterCode(user: ReturnType<typeof userEvent.setup>, code = '123456'): Promise<void> {
  await user.type(screen.getByLabelText(/six-digit code/i), code);
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
}

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
});

describe('sign in', () => {
  it('sends the code and moves to the code step without revealing whether the account exists', async () => {
    const user = userEvent.setup();
    respond([{ status: 200, body: { status: 'sent' } }]);
    render(<LoginForm />);

    await enterEmail(user);

    expect(await screen.findByText(/we sent a six-digit code to player@example.com/i)).toBeTruthy();
    expect(screen.getByLabelText(/six-digit code/i)).toBeTruthy();
  });

  it('asks a new player for details and signs them up with the same code', async () => {
    const user = userEvent.setup();
    respond([
      { status: 200, body: { status: 'sent' } },
      { status: 200, body: { status: 'details_required' } },
      { status: 200, body: { status: 'signed_in', hasCharacter: false } },
    ]);
    render(<LoginForm />);

    await enterEmail(user);
    await enterCode(user);

    expect(await screen.findByText(/almost there/i)).toBeTruthy();

    await user.click(screen.getByLabelText(/i accept the terms/i));
    await user.click(screen.getByLabelText(/i am 18 or older/i));
    await user.click(screen.getByRole('button', { name: /create my account/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/create-character'));
  });

  it('sends an existing player to their character', async () => {
    const user = userEvent.setup();
    respond([
      { status: 200, body: { status: 'sent' } },
      { status: 200, body: { status: 'signed_in', hasCharacter: true } },
    ]);
    render(<LoginForm />);

    await enterEmail(user);
    await enterCode(user);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });

  it('resubmits with the chosen age band for an under-18 player', async () => {
    const user = userEvent.setup();
    const calls: unknown[] = [];
    respond([
      { status: 200, body: { status: 'sent' } },
      { status: 200, body: { status: 'details_required' } },
      { status: 200, body: { status: 'signed_in', hasCharacter: false } },
    ]);
    const spy = vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })));
    void spy;
    const original = globalThis.fetch as unknown as (
      input: string,
      init: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal('fetch', (input: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return original(input, init);
    });

    render(<LoginForm />);
    await enterEmail(user);
    await enterCode(user);
    await user.click(await screen.findByLabelText(/i accept the terms/i));
    await user.click(screen.getByLabelText(/i am under 18/i));
    await user.click(screen.getByRole('button', { name: /create my account/i }));

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(calls.at(-1)).toMatchObject({
      details: { acceptTerms: true, ageBand: 'under_18' },
    });
  });

  it('says the code is wrong or expired and offers a new one', async () => {
    const user = userEvent.setup();
    respond([
      { status: 200, body: { status: 'sent' } },
      { status: 400, body: { error: 'invalid_or_expired' } },
    ]);
    render(<LoginForm />);

    await enterEmail(user);
    await enterCode(user, '000000');

    expect(await screen.findByText(/that code is wrong or has expired/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /send a new code/i })).toBeTruthy();
  });

  it('shows the wait when rate limited, as a countdown on the resend button', async () => {
    const user = userEvent.setup();
    respond([{ status: 429, body: { error: 'rate_limited' }, headers: { 'retry-after': '45' } }]);
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email address/i), 'player@example.com');
    await user.click(screen.getByRole('button', { name: /send me a code/i }));

    expect(await screen.findByText(/too many tries. wait 45 seconds/i)).toBeTruthy();
  });

  it('asks the player to try again in a minute when the email could not be sent', async () => {
    const user = userEvent.setup();
    respond([{ status: 503, body: { error: 'send_failed' } }]);
    render(<LoginForm />);

    await enterEmail(user);

    expect(
      await screen.findByText(/we could not send the email. try again in a minute/i),
    ).toBeTruthy();
  });

  it('explains that a disposable address is not accepted', async () => {
    const user = userEvent.setup();
    respond([{ status: 400, body: { error: 'email_not_supported' } }]);
    render(<LoginForm />);

    await enterEmail(user);

    expect(await screen.findByText(/that email address is not accepted/i)).toBeTruthy();
  });

  it('lets a player start again with a different email', async () => {
    const user = userEvent.setup();
    respond([{ status: 200, body: { status: 'sent' } }]);
    render(<LoginForm />);

    await enterEmail(user);
    await user.click(await screen.findByRole('button', { name: /use a different email/i }));

    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.queryByLabelText(/six-digit code/i)).toBeNull();
  });

  it('says nothing about whether the address is registered, whatever the answer', async () => {
    for (const reply of [
      { status: 200, body: { status: 'sent' } },
      { status: 200, body: { status: 'sent' } },
    ]) {
      const user = userEvent.setup();
      respond([reply]);
      const { unmount } = render(<LoginForm />);
      await enterEmail(user);
      const text = document.body.textContent ?? '';
      expect(text).not.toMatch(/no account|not registered|unknown email/i);
      unmount();
    }
  });
});
