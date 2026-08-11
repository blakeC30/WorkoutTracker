import type { MetadataRoute } from 'next';

/**
 * What makes the home-screen icon open standalone instead of in a Safari tab.
 *
 * `portrait` is locked because the layout is built for one width; landscape would stretch a
 * 390px design across 844px with nothing to fill it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Training Log',
    short_name: 'Log',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#121110',
    theme_color: '#121110',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
