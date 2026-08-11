import { ImageResponse } from 'next/og';

/**
 * The home-screen icon, generated at build time so there is no binary asset to maintain.
 *
 * It is the app's own bar chart, not a dumbbell: four amber bars on the ground colour. iOS
 * squares the corners itself, so the artwork is drawn flat and full-bleed — a rounded rect
 * baked into the PNG would show as a border inside the mask.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// Loosely the shape of a training block: build, build, back off, build.
const BARS = [0.42, 0.66, 0.34, 0.9];

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#121110',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: 12,
          padding: 34,
        }}
      >
        {BARS.map((height, i) => (
          <div
            key={i}
            style={{
              width: 20,
              height: `${height * 100}%`,
              background: i === BARS.length - 1 ? '#e0913a' : '#7a5124',
            }}
          />
        ))}
      </div>
    ),
    size,
  );
}
