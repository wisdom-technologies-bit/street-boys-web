import { describe, expect, it } from 'vitest';
import { normaliseIp, resolveClientIp } from './client-ip';

describe('normaliseIp', () => {
  it.each([
    ['1.2.3.4', '1.2.3.4'],
    ['  1.2.3.4  ', '1.2.3.4'],
    ['1.2.3.4:51234', '1.2.3.4'],
    ['::1', '::1'],
    ['2001:DB8::1', '2001:db8::1'],
    ['[2001:db8::1]', '2001:db8::1'],
    ['[2001:db8::1]:443', '2001:db8::1'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normaliseIp(input)).toBe(expected);
  });

  it.each(['', '   ', 'unknown', 'not-an-ip', '1.2.3.256', '999.1.1.1', '1.2.3', '::1%eth0'])(
    'rejects %s rather than passing it through',
    (input) => {
      expect(normaliseIp(input)).toBeNull();
    },
  );
});

describe('resolveClientIp', () => {
  describe('with 0 trusted hops (no proxy, dev, a direct connection)', () => {
    it('uses the socket address and ignores the header entirely', () => {
      expect(
        resolveClientIp({
          forwardedFor: '203.0.113.9',
          remoteAddress: '127.0.0.1',
          trustedProxyHops: 0,
        }),
      ).toBe('127.0.0.1');
    });

    it('returns null when there is no socket address', () => {
      expect(
        resolveClientIp({ forwardedFor: '203.0.113.9', remoteAddress: null, trustedProxyHops: 0 }),
      ).toBeNull();
    });
  });

  describe('with 1 trusted hop (Vercel, Render: one edge in front)', () => {
    it('takes the rightmost entry, the one the trusted proxy appended', () => {
      expect(
        resolveClientIp({
          forwardedFor: '203.0.113.9',
          remoteAddress: '10.0.0.1',
          trustedProxyHops: 1,
        }),
      ).toBe('203.0.113.9');
    });

    it('ignores a spoofed hop the client prepended', () => {
      // The caller sent "1.2.3.4"; the proxy appended the real address.
      expect(
        resolveClientIp({
          forwardedFor: '1.2.3.4, 203.0.113.9',
          remoteAddress: '10.0.0.1',
          trustedProxyHops: 1,
        }),
      ).toBe('203.0.113.9');
    });

    it('ignores any number of spoofed hops', () => {
      expect(
        resolveClientIp({
          forwardedFor: '9.9.9.9, 8.8.8.8, 7.7.7.7, 203.0.113.9',
          remoteAddress: '10.0.0.1',
          trustedProxyHops: 1,
        }),
      ).toBe('203.0.113.9');
    });

    it('returns null when the header is missing, because the socket address is the proxy', () => {
      expect(
        resolveClientIp({ forwardedFor: null, remoteAddress: '10.0.0.1', trustedProxyHops: 1 }),
      ).toBeNull();
    });

    it('returns null when the entry is not an address', () => {
      expect(
        resolveClientIp({ forwardedFor: 'unknown', remoteAddress: '10.0.0.1', trustedProxyHops: 1 }),
      ).toBeNull();
    });
  });

  describe('with 2 trusted hops (CDN then load balancer)', () => {
    it('takes the second entry from the right', () => {
      expect(
        resolveClientIp({
          forwardedFor: '198.51.100.7, 203.0.113.9, 10.0.0.5',
          remoteAddress: '10.0.0.6',
          trustedProxyHops: 2,
        }),
      ).toBe('203.0.113.9');
    });

    it('still ignores spoofed hops to the left', () => {
      // 1.1.1.1 and 2.2.2.2 are the caller's invention. Our CDN appended the real
      // client (198.51.100.7) and our load balancer appended the CDN (203.0.113.9),
      // so with 2 trusted hops the client is the second entry from the right.
      expect(
        resolveClientIp({
          forwardedFor: '1.1.1.1, 2.2.2.2, 198.51.100.7, 203.0.113.9',
          remoteAddress: '10.0.0.6',
          trustedProxyHops: 2,
        }),
      ).toBe('198.51.100.7');
    });

    it('returns null when the chain is shorter than the trusted hop count', () => {
      expect(
        resolveClientIp({
          forwardedFor: '203.0.113.9',
          remoteAddress: '10.0.0.6',
          trustedProxyHops: 2,
        }),
      ).toBeNull();
    });
  });

  it('tolerates spaces, empty entries and mixed formatting', () => {
    expect(
      resolveClientIp({
        forwardedFor: '  , 203.0.113.9 , ',
        remoteAddress: '10.0.0.1',
        trustedProxyHops: 1,
      }),
    ).toBe('203.0.113.9');
  });

  it('returns an IPv6 client address without brackets', () => {
    expect(
      resolveClientIp({
        forwardedFor: '[2001:db8::1]:443, 10.0.0.1',
        remoteAddress: '10.0.0.2',
        trustedProxyHops: 2,
      }),
    ).toBe('2001:db8::1');
  });
});
