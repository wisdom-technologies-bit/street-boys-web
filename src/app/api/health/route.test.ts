import { describe, expect, it, vi, beforeEach } from 'vitest';
import pkg from '../../../../package.json';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@/server/db/client', () => ({
  getDb: () => ({ execute }),
}));

const { GET } = await import('./route');

describe('GET /api/health', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('reports ok when the database answers', async () => {
    execute.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok', db: 'ok', version: pkg.version });
  });

  it('reports db down when the query fails, without leaking the reason', async () => {
    execute.mockRejectedValue(
      new Error('connection to postgresql://streetboys:hunter2@db.example:5432 failed'),
    );

    const response = await GET();
    const body = await response.json();
    const raw = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('down');
    expect(raw).not.toContain('postgresql://');
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('db.example');
    expect(raw).not.toContain('failed');
  });

  it('never sends connection details or secrets in the response', async () => {
    execute.mockResolvedValue({ rows: [] });

    const response = await GET();
    const raw = JSON.stringify(await response.json());

    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['db', 'status', 'version']);
    expect(raw).not.toMatch(/password|secret|token|host|port|user/i);
  });

  it('is not cacheable', async () => {
    execute.mockResolvedValue({ rows: [] });

    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
