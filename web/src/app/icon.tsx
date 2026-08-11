import { ImageResponse } from 'next/og';

/** The same mark as apple-icon, at favicon size for the browser tab and the manifest. */
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

const BARS = [0.42, 0.66, 0.34, 0.9];

export default function Icon() {
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
          gap: 34,
          padding: 96,
        }}
      >
        {BARS.map((height, i) => (
          <div
            key={i}
            style={{
              width: 56,
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
