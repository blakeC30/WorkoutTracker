/**
 * The backend has no UI. This page exists so that hitting the deployment root gives
 * something clearer than a 404 while you're setting things up.
 */
export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', lineHeight: 1.6 }}>
      <h1>WorkoutTracker Backend</h1>
      <p>No UI here. This app hosts the MCP server and the read API.</p>
      <p>
        Health check: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
