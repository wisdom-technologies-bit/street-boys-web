import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@/server/db/client', () => ({
  getDb: () => ({ execute }),
}));

const { GET } = await import('./route');

describe('GET /api/ready', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('is 200 ready when the database answers', async () => {
    execute.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
  });

  it('is 503 not_ready when the database is unreachable', async () => {
    execute.mockRejectedValue(
      new Error('connection to postgresql://someone:secret@db.internal:5432 failed: ECONNREFUSED'),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'not_ready' });
  });

  it('never exposes connection details in the failure body', async () => {
    execute.mockRejectedValue(
      new Error('connection to postgresql://someone:secret@db.internal:5432 failed'),
    );

    const raw = JSON.stringify(await GET().then((r) => r.json()));

    expect(raw).not.toMatch(/postgres|secret|db\.internal|5432|ECONNREFUSED/i);
  });

  it('is not cached', async () => {
    execute.mockResolvedValue({ rows: [] });
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
