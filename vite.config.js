import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves the VEYRA API from the same origin during `vite dev`.
 *
 * The Android build and the deployed web build both call an absolute
 * `VITE_VEYRA_API_BASE_URL`; in development it is easier and safer to run the
 * same route table in-process. The provider key stays in this process
 * (`ZST_API_KEY` from the environment) and never reaches the browser bundle.
 *
 * Vite's HMR and server settings are untouched.
 */
function veyraApiDevServer() {
  return {
    name: 'veyra-api-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/veyra')) return next();
        const url = new URL(req.url, 'http://localhost');
        const send = (status, headers, body) => {
          res.statusCode = status;
          for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
          res.end(JSON.stringify(body));
        };
        server.ssrLoadModule('/server/veyra-api.js')
          .then(({ handleVeyraRequest }) => handleVeyraRequest({
            method: req.method,
            path: url.pathname,
            query: url.searchParams,
          }))
          .then((result) => send(result.status, result.headers, result.body))
          .catch((error) => {
            server.config.logger.error(`[veyra-api] ${error?.message || error}`);
            send(500, { 'Content-Type': 'application/json' }, {
              status: false,
              error: { code: 'INTERNAL', message: 'Request failed.' },
            });
          });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), veyraApiDevServer()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
