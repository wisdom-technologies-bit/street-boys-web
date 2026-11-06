import type { NextConfig } from 'next';

/**
 * Baseline security headers (AGENTS.md section 7).
 *
 * The Content-Security-Policy keeps every fetch same-origin and allows nothing
 * remote. `'unsafe-inline'` is present for scripts and styles only because the
 * Next App Router emits inline bootstrap scripts; a nonce-based CSP belongs with
 * the real application, not with this empty foundation.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Standalone output (D-139). `next build` writes a self-contained server to
   * `.next/standalone` with only the files and `node_modules` it actually needs,
   * which is what the Dockerfile ships and what a plain Node host runs. It is the
   * reason this app does not depend on any one platform's build system.
   */
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
