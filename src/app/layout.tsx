import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Street Boys',
  description: 'A Nigerian street-life simulation. Coming soon.',
};

/**
 * Mobile first. Width follows the device, the initial zoom stays at 1 so text is
 * legible on a cheap Android screen, and the theme colour matches the page so a
 * phone browser does not repaint its chrome on load.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111111',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
