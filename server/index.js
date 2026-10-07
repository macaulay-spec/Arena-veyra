// Standalone VEYRA API server.
//
//   ZST_API_KEY=... node server/index.js
//
// Binds 0.0.0.0 so it works for a local device, an emulator and a container.
// The provider credential is read from the environment and never leaves this
// process.

import { createServer } from 'node:http';
import { handleVeyraRequest } from './veyra-api.js';
import { providerBases, providerConfigured } from './providers/zst.js';

const PORT = Number(process.env.PORT || process.env.VEYRA_API_PORT || 8787);

/** Origins a Capacitor shell or a local dev server legitimately presents. */
const SAFE_ORIGIN = [
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
  /^capacitor:\/\/localhost$/,
  /^https?:\/\/localhost$/,
];

function configuredOrigins() {
  return String(process.env.VEYRA_CORS_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin) {
  if (!origin) return true; // Same-origin and native fetches send no Origin.
  if (configuredOrigins().includes(origin)) return true;
  return SAFE_ORIGIN.some((pattern) => pattern.test(origin));
}

function corsHeaders(origin) {
  if (!origin || !isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function send(res, { status, headers, body }, origin) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...headers,
    ...corsHeaders(origin),
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createVeyraServer() {
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }
    if (!url.pathname.startsWith('/api/veyra')) {
      send(res, { status: 404, headers: { 'Content-Type': 'application/json' }, body: { status: false, error: { code: 'NOT_FOUND', message: 'Unknown route.' } } }, origin);
      return;
    }

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const response = await handleVeyraRequest({
        method: req.method,
        path: url.pathname,
        query: url.searchParams,
        signal: controller.signal,
      });
      send(res, response, origin);
    } catch (error) {
      console.error(JSON.stringify({ scope: 'veyra-api', code: error?.code || 'INTERNAL' }));
      send(res, { status: 500, headers: { 'Content-Type': 'application/json' }, body: { status: false, error: { code: 'INTERNAL', message: 'Request failed.' } } }, origin);
    }
  });
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (isDirectRun) {
  const server = createVeyraServer();
  server.listen(PORT, '0.0.0.0', () => {
    const bases = providerBases();
    console.log(JSON.stringify({
      scope: 'veyra-api',
      event: 'listening',
      port: PORT,
      providerConfigured: providerConfigured(),
      catalogHostConfigured: Boolean(bases.catalog),
      mediaHostConfigured: Boolean(bases.media),
    }));
    if (!providerConfigured()) {
      console.warn('ZST_API_KEY is not set: catalogue routes will answer NOT_CONFIGURED.');
    }
  });
}
