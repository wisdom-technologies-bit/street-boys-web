import { getPool } from '@/server/db/client';
import { truncateAll } from '@/test/db-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditMetadataError, logEvent, recentEvents, subjectForEmail } from './audit';

beforeEach(async () => {
  await truncateAll();
});

describe('logEvent', () => {
  it('writes an event', async () => {
    await logEvent({ eventType: 'test.event', subject: 'someone', metadata: { step: 1 } });

    const events = await recentEvents('test.event');
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('test.event');
    expect(events[0]!.subject).toBe('someone');
  });

  it.each(['code', 'otp', 'token', 'password', 'secret', 'email', 'ip', 'EMAIL', 'Token'])(
    'refuses metadata with a "%s" key',
    async (key) => {
      await expect(
        logEvent({ eventType: 'test.event', metadata: { [key]: 'value' } }),
      ).rejects.toBeInstanceOf(AuditMetadataError);
    },
  );

  it('refuses a forbidden key nested inside an object or array', async () => {
    await expect(
      logEvent({ eventType: 'x', metadata: { outer: { inner: { otp: '123456' } } } }),
    ).rejects.toBeInstanceOf(AuditMetadataError);

    await expect(
      logEvent({ eventType: 'x', metadata: { list: [{ email: 'a@b.co' }] } }),
    ).rejects.toBeInstanceOf(AuditMetadataError);
  });

  it('says which path was refused, without echoing the value', async () => {
    const error = await logEvent({ eventType: 'x', metadata: { inner: { code: '987654' } } }).catch(
      (e: unknown) => e,
    );
    expect((error as AuditMetadataError).message).toContain('metadata.inner.code');
    expect((error as AuditMetadataError).message).not.toContain('987654');
  });
});

describe('subjectForEmail', () => {
  it('is a stable HMAC, not the address', () => {
    const subject = subjectForEmail('someone@example.com');
    expect(subject).not.toContain('@');
    expect(subject).toMatch(/^[0-9a-f]{64}$/);
    expect(subjectForEmail('someone@example.com')).toBe(subject);
    expect(subjectForEmail('other@example.com')).not.toBe(subject);
  });
});

describe('the database refuses edits to the log', () => {
  it('blocks UPDATE', async () => {
    await logEvent({ eventType: 'sealed.event' });
    await expect(getPool().query("update audit_log set event_type = 'tampered'")).rejects.toThrow(
      /append-only/,
    );
  });

  it('blocks DELETE', async () => {
    await logEvent({ eventType: 'sealed.event' });
    await expect(getPool().query('delete from audit_log')).rejects.toThrow(/append-only/);
  });

  it('still allows TRUNCATE, which the test harness needs', async () => {
    await logEvent({ eventType: 'sealed.event' });
    await expect(getPool().query('truncate audit_log')).resolves.toBeTruthy();
  });
});
