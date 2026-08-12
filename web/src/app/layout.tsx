import type { Metadata, Viewport } from 'next';
import { Azeret_Mono, IBM_Plex_Sans } from 'next/font/google';
import { TabBar } from '@/components/TabBar';
import { SPLASH_SCREENS, splashMedia, splashSlug } from '@/lib/splash';
import './globals.css';

/*
 * Two families with a rule that decides between them: mono for anything measured, sans for
 * anything named. next/font self-hosts both at build time, so there is no request to Google
 * at runtime and no layout shift while a webfont loads.
 */
const mono = Azeret_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
});

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Log',
  description: 'Training log',
  // Added to the home screen, this is what makes it open without Safari chrome.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Log',
    // What iOS paints between tapping the icon and the first frame of the app. Without it
    // that gap is WHITE — the manifest's background_color is Chrome's mechanism, not
    // Safari's, and iOS has never read it. One entry per device geometry, because the match
    // is on exact pixel dimensions and a near miss is silently ignored.
    startupImage: SPLASH_SCREENS.map((screen) => ({
      url: `/apple-splash/${splashSlug(screen)}`,
      media: splashMedia(screen),
    })),
  },
  // Nothing here should ever be indexed; it is one person's bodyweight.
  robots: { index: false, follow: false },
  other: {
    /*
     * Next 16 renders `appleWebApp.capable: true` as the STANDARD `mobile-web-app-capable`
     * and no longer emits Apple's legacy name. Standalone launch still works, because iOS
     * 16.4+ takes that from the manifest's `display` — but `apple-touch-startup-image` is
     * older machinery than the manifest and still gates on the legacy meta. Without this
     * line iOS ignored all thirteen launch images and painted white, which is exactly what
     * it looks like when the images are wrong, so the tags were never the suspect.
     *
     * Emitting both names is correct rather than belt-and-braces: they are two generations
     * of the same declaration and neither implies the other here.
     */
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No zoom: this is a fixed-width app, and a double-tap that zooms feels like a web page.
  maximumScale: 1,
  userScalable: false,
  // Lets the layout paint under the notch and the home indicator, which env(safe-area-inset-*)
  // then pads back. Without it there are black bars top and bottom in standalone mode.
  viewportFit: 'cover',
  themeColor: '#121110',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`}>
      <body>
        {children}
        <TabBar />
      </body>
    </html>
  );
}
