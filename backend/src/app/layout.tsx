import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WorkoutTracker Backend',
  description: 'MCP server and read API. No UI here.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
