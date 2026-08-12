/**
 * The launch images iOS shows between tapping the home-screen icon and the first paint.
 *
 * Without these it shows WHITE — on an app whose whole point is being legible in gym
 * lighting on an OLED that renders `#121110` as off pixels. The manifest's `background_color`
 * does not help: that is what Chrome on Android uses to build a splash, and iOS has never
 * read it. iOS wants `apple-touch-startup-image`, and it wants one per device geometry.
 *
 * The matching is exact and unforgiving. If the image's pixel dimensions do not equal the
 * device's, iOS silently ignores it and you are back to white — so each entry carries the CSS
 * size and pixel ratio it is for, and the pixel dimensions are derived rather than typed,
 * because a hand-typed 1170x2532 is a transposition away from doing nothing at all.
 *
 * DESIGN.md says the target is one iPhone 13 Pro, and for layout that is right — a width
 * breakpoint here would be dead code. This list is the exception, and not really a
 * contradiction: an unlisted device does not get a worse layout, it gets the white screen
 * this file exists to remove. The cost of covering a phone you might own in two years is one
 * row.
 */
export type SplashScreen = {
  /** CSS pixels, what the media query matches on. */
  width: number;
  height: number;
  /** Device pixel ratio. */
  ratio: number;
  /** Which phones this row is for — comment only, never rendered. */
  devices: string;
};

export const SPLASH_SCREENS: SplashScreen[] = [
  { width: 320, height: 568, ratio: 2, devices: 'iPhone SE 1st gen' },
  { width: 375, height: 667, ratio: 2, devices: 'iPhone SE 2nd/3rd gen, 6/7/8' },
  { width: 414, height: 736, ratio: 3, devices: 'iPhone 8 Plus' },
  { width: 375, height: 812, ratio: 3, devices: 'iPhone X, XS, 11 Pro, 12 mini' },
  { width: 414, height: 896, ratio: 2, devices: 'iPhone XR, 11' },
  { width: 414, height: 896, ratio: 3, devices: 'iPhone XS Max, 11 Pro Max' },
  { width: 360, height: 780, ratio: 3, devices: 'iPhone 12 mini, 13 mini' },
  { width: 390, height: 844, ratio: 3, devices: 'iPhone 12, 12 Pro, 13, 13 Pro, 14' },
  { width: 428, height: 926, ratio: 3, devices: 'iPhone 12 Pro Max, 13 Pro Max, 14 Plus' },
  { width: 393, height: 852, ratio: 3, devices: 'iPhone 14 Pro, 15, 15 Pro, 16' },
  { width: 430, height: 932, ratio: 3, devices: 'iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus' },
  { width: 402, height: 874, ratio: 3, devices: 'iPhone 16 Pro' },
  { width: 440, height: 956, ratio: 3, devices: 'iPhone 16 Pro Max' },
];

/** `1170x2532` — the path segment and the actual pixel size of the generated image. */
export function splashSlug(screen: SplashScreen): string {
  return `${screen.width * screen.ratio}x${screen.height * screen.ratio}`;
}

/**
 * The media query iOS matches against. `orientation: portrait` only, because the manifest
 * locks the app to portrait — a landscape entry would be an image that can never be shown.
 */
export function splashMedia(screen: SplashScreen): string {
  return (
    `(device-width: ${screen.width}px) and (device-height: ${screen.height}px) ` +
    `and (-webkit-device-pixel-ratio: ${screen.ratio}) and (orientation: portrait)`
  );
}

/** Guards the image route: only sizes this app actually advertises may be rendered. */
export function splashSizeFromSlug(slug: string): { width: number; height: number } | null {
  const match = SPLASH_SCREENS.find((screen) => splashSlug(screen) === slug);
  if (!match) return null;
  return { width: match.width * match.ratio, height: match.height * match.ratio };
}
