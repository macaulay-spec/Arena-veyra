/**
 * Render smoke test.
 *
 * Loads the app through Vite's SSR pipeline and renders every screen with real
 * catalog shapes. Catches crashes, undefined props and leftover "playback
 * unavailable" copy without needing a browser or the live API.
 */
import { createServer } from 'vite';

const server = await createServer({
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  await server.ssrLoadModule('/scripts/ssr-smoke-entry.jsx');
} finally {
  await server.close();
}
