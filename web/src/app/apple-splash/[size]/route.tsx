import { ImageResponse } from 'next/og';
import { splashSizeFromSlug } from '@/lib/splash';

/**
 * The launch image, at one exact device size per request.
 *
 * Generated rather than committed as thirteen PNGs: the mark is four rectangles, and the
 * alternative is a folder of binaries that no one can diff and that drift from the icon the
 * first time a colour changes. `icon.tsx` and `apple-icon.tsx` already work this way.
 *
 * The size comes out of the path and is looked up in the advertised list rather than parsed.
 * Rendering an arbitrary WxH from a URL is an invitation to ask for 30000x30000 and find out
 * how much memory a serverless function has.
 *
 * NOTE: this route must stay outside the proxy matcher. iOS fetches launch images while
 * installing to the home screen, with no session — a redirect to /login here means it caches
 * an HTML page as an image, which is a white screen with extra steps.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: slug } = await params;
  const size = splashSizeFromSlug(slug);

  if (!size) return new Response('Not found', { status: 404 });

  // The icon mark: three bars at rest, the last one lit. Same shape and colours as
  // src/app/icon.tsx, scaled to sit in the middle of a phone screen rather than a 512px
  // square — about a fifth of the width, which reads as a logo and not a banner.
  const barWidth = Math.round(size.width * 0.038);
  const gap = Math.round(barWidth * 0.6);
  const markHeight = Math.round(size.width * 0.22);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#121110',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap,
            height: markHeight,
          }}
        >
          {[0.42, 0.66, 0.34, 0.9].map((height, i) => (
            <div
              key={i}
              style={{
                width: barWidth,
                height: `${height * 100}%`,
                background: i === 3 ? '#e0913a' : '#7a5124',
              }}
            />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      headers: {
        // iOS keeps launch images for a long time and refetches rarely. Immutable is honest
        // here: the URL contains the exact dimensions, so a different image is a different URL.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  );
}
