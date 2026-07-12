import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Root HTML shell for every web page. Expo Router static rendering wraps each
 * route in this document, so it is where the PWA + iOS standalone metadata
 * lives: with these tags in place the app installs to the iPhone home screen
 * and runs with no Safari address bar or toolbar. This file only runs in Node
 * during `expo export`; it never ships to the client bundle.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
        />
        <title>Ours</title>

        {/* Web app manifest (display: standalone lives here). */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#F4ECDD" />

        {/* iOS home-screen web app: no Safari chrome, parchment status bar. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Ours" />

        {/* Icons. iOS requires real PNGs, not SVG or emoji. */}
        <link rel="icon" href="/favicon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152.png" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: bodyReset }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// Parchment ground everywhere so the status bar area and any uncovered edge
// match the app background instead of flashing white on launch.
const bodyReset = `
html, body { background-color: #F4ECDD; }
@media (prefers-color-scheme: dark) {
  html, body { background-color: #F4ECDD; }
}
`;
