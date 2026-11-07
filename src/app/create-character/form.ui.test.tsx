import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}));

import { CharacterForm } from './form';

type Reply = { status: number; body: unknown };

function respond(reply: Reply): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>, name = 'Ada'): Promise<void> {
  await user.type(screen.getByLabelText(/name/i), name);
  // Every picker uses the same numbers, so the first "2" is the skin tone.
  const [skinToneTwo] = screen.getAllByLabelText('2');
  await user.click(skinToneTwo!);
}

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
});

describe('create character', () => {
  it('shows the name rules next to the field', () => {
    render(<CharacterForm />);
    expect(screen.getByText(/3 to 20 characters/i)).toBeTruthy();
  });

  it('goes home when the character is created', async () => {
    const user = userEvent.setup();
    respond({ status: 201, body: { name: 'Ada', avatar: { skinTone: 2, hair: 1, outfit: 1 } } });
    render(<CharacterForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /enter the street/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });

  it('keeps a reserved name on the name field', async () => {
    const user = userEvent.setup();
    respond({ status: 400, body: { error: 'name_not_allowed' } });
    render(<CharacterForm />);

    await fill(user, 'System');
    await user.click(screen.getByRole('button', { name: /enter the street/i }));

    expect(await screen.findByText(/that name is not allowed/i)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('says when a name is taken', async () => {
    const user = userEvent.setup();
    respond({ status: 409, body: { error: 'name_taken' } });
    render(<CharacterForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /enter the street/i }));

    expect(await screen.findByText(/someone already has that name/i)).toBeTruthy();
  });

  it('says when the avatar is not one of the options', async () => {
    const user = userEvent.setup();
    respond({ status: 400, body: { error: 'avatar_invalid' } });
    render(<CharacterForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /enter the street/i }));

    expect(await screen.findByText(/choose a skin tone, hair style and outfit/i)).toBeTruthy();
  });

  it('says when the player already has a character', async () => {
    const user = userEvent.setup();
    respond({ status: 409, body: { error: 'already_has_character' } });
    render(<CharacterForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /enter the street/i }));

    expect(await screen.findByText(/you already have a character/i)).toBeTruthy();
  });

  it('asks the player to sign in again when the session ended', async () => {
    const user = userEvent.setup();
    respond({ status: 401, body: { error: 'unauthorized' } });
    render(<CharacterForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /enter the street/i }));

    expect(await screen.findByText(/your session has ended/i)).toBeTruthy();
  });

  it('reports too many tries', async () => {
    const user = userEvent.setup();
    respond({ status: 429, body: { error: 'rate_limited' } });
    render(<CharacterForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /enter the street/i }));

    expect(await screen.findByText(/too many tries/i)).toBeTruthy();
  });

  it('reports a network failure without losing the form', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    render(<CharacterForm />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /enter the street/i }));

    expect(await screen.findByText(/no connection/i)).toBeTruthy();
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe('Ada');
  });
});
