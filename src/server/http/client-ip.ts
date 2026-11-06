/**
 * The client's IP address, decided in exactly one place.
 *
 * `x-forwarded-for` is a **client-controlled header**. Its leftmost entries are
 * whatever the caller decided to send, and only the entries appended by proxies
 * you actually run can be believed. Reading it naively ("take the first value")
 * is how rate limits and audit logs get defeated by one header. So:
 *
 * - `TRUSTED_PROXY_HOPS` **must** match the real deployment: Vercel and Render put
 *   one proxy in front of the app, so the default is `1`. If you are wrong here,
 *   you are trusting an address a stranger chose.
 * - With `N` trusted hops, the address is the `N`th entry **from the right**,
 *   because that is the entry the outermost proxy you trust appended. Everything
 *   to the left of it is ignored, which is what makes a spoofed extra hop harmless.
 * - With `0` hops there is no proxy: forwarded headers are ignored entirely and
 *   the socket address is used.
 * - If the answer cannot be decided — too few entries, a malformed value, no
 *   socket address — the answer is `null`. Callers must treat `null` as "unknown"
 *   and, for rate limiting, fail closed.
 *
 * Nothing else in the application reads `x-forwarded-for`. `eslint.config.mjs`
 * enforces that: the header name is a lint error outside this file.
 */

export type ClientIpInput = {
  /** The raw `x-forwarded-for` header, or null when absent. */
  forwardedFor: string | null | undefined;
  /** The socket address (`request.socket.remoteAddress` or the platform's equivalent). */
  remoteAddress?: string | null;
  /** How many proxies in front of the app may be trusted. */
  trustedProxyHops: number;
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Normalise one header entry to a bare IP, or `null`.
 *
 * Handles `1.2.3.4`, `1.2.3.4:51234`, `::1`, `2001:db8::1`, `[2001:db8::1]` and
 * `[2001:db8::1]:443`. Anything else is not an address and is rejected rather
 * than passed through, because a rejected entry becomes `null` and a `null` is
 * visibly wrong, while a passed-through `"unknown"` looks like an answer.
 */
export function normaliseIp(raw: string): string | null {
  let value = raw.trim();
  if (value === '') return null;

  // [IPv6] or [IPv6]:port
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) {
    value = bracketed[1] ?? '';
  } else if (IPV4.test(value) === false && value.includes(':')) {
    // A bare IPv6 address, or an IPv4:port pair.
    const ipv4WithPort = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d{1,5}$/.exec(value);
    if (ipv4WithPort) {
      value = ipv4WithPort[1] ?? '';
    } else if (value.split(':').length === 2 && IPV4.test(value.split(':')[0] ?? '')) {
      value = value.split(':')[0] ?? '';
    }
  }

  const ipv4 = IPV4.exec(value);
  if (ipv4) {
    const octets = value.split('.').map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    return octets.join('.');
  }

  // Loose IPv6 check: hex groups and colons only, at least two colons, no zone id.
  if (/^[0-9a-fA-F:]+$/.test(value) && value.split(':').length >= 3) {
    return value.toLowerCase();
  }

  return null;
}

/**
 * Resolve the client's IP, or `null` when it cannot be decided.
 */
export function resolveClientIp(input: ClientIpInput): string | null {
  const { forwardedFor, remoteAddress, trustedProxyHops } = input;

  const socketIp = remoteAddress ? normaliseIp(remoteAddress) : null;

  // No trusted proxy: the header is a stranger's opinion.
  if (trustedProxyHops <= 0) {
    return socketIp;
  }

  if (!forwardedFor) {
    // No header at all. The socket address is still the last hop we can see, and
    // in a correctly configured deployment that is the proxy's address, not the
    // client's, so it is not an acceptable answer when hops are expected.
    return null;
  }

  const entries = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  if (entries.length < trustedProxyHops) {
    // Fewer hops than we are told to trust: the request did not travel the path
    // we expect, so nothing in the header can be believed.
    return null;
  }

  const chosen = entries[entries.length - trustedProxyHops];
  if (chosen === undefined) return null;

  return normaliseIp(chosen);
}
