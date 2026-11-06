import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Transfer Tally • Ethiopian Bank Receipt Scanner',
  description:
    'Mobile-first receipt scanner and tally for cashier screenshots (Telebirr, CBE, Awash, etc.). Excludes duplicates and totals instantly.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Transfer Tally',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f766e',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icon.svg" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var lang = localStorage.getItem('tt_language');
                  if (lang !== 'en' && lang !== 'am') {
                    lang = (navigator.language || '').toLowerCase().indexOf('am') === 0 ? 'am' : 'en';
                  }
                  document.documentElement.setAttribute('lang', lang);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
                  // Skip service worker in dev
                } else {
                  window.addEventListener('load', () => {
                    navigator.serviceWorker.register('/sw.js').catch(console.error);
                  });
                }
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
