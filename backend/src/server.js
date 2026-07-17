// HTTP layer on Node's built-in http (zero external deps except `pg` when DATABASE_URL is set):
// WhatsApp webhook + admin JSON API + serves the static admin panel. Run: `node src/server.js`.
//
// PERSISTENCE: Postgres when DATABASE_URL is set (durable), otherwise in-memory (demo; resets on
// restart). WhatsApp uses the Cloud API adapter when WA_* creds are set, else a mock adapter so the
// panel/API run locally with no creds.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { createStore } from './store/index.js';
import { createCloudApiAdapter } from './whatsapp/cloudApi.js';
import { createMockAdapter } from './whatsapp/mockAdapter.js';
import { handle } from './journey/engine.js';
import { seedAdminUsers, seedDemo } from './api/seedAdmin.js';
import { apiRouter } from './api/routes.js';
import { startScheduler } from './jobs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');

const store = await createStore(config);
await seedAdminUsers(store);
if (config.seedDemo) await seedDemo(store);

const waReady = Boolean(config.whatsapp.phoneNumberId && config.whatsapp.token);
const adapter = waReady ? createCloudApiAdapter(config.whatsapp) : createMockAdapter();
const deps = { store, adapter };
startScheduler(deps);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const sendJson = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(obj));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        resolve({});
      }
    });
  });

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' || urlPath === '/admin' || urlPath === '/admin/' ? '/index.html' : urlPath.replace(/^\/admin/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  const method = req.method;

  if (method === 'OPTIONS') return sendJson(res, 204, {});
  if (pathname === '/health') return sendJson(res, 200, { ok: true, service: 'medinity-connect', whatsapp: waReady ? 'cloud-api' : 'mock' });

  if (pathname === '/webhook' && method === 'GET') {
    const mode = u.searchParams.get('hub.mode');
    const token = u.searchParams.get('hub.verify_token');
    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
      res.writeHead(200);
      return res.end(u.searchParams.get('hub.challenge'));
    }
    res.writeHead(403);
    return res.end('forbidden');
  }

  if (pathname === '/webhook' && method === 'POST') {
    const body = await readBody(req);
    res.writeHead(200);
    res.end('ok'); // ack fast; Meta retries on non-200
    const inbound = normalise(body);
    if (inbound) {
      handle(deps, inbound).catch((e) => console.error('[webhook] handler error:', e));
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    const body = method === 'POST' ? await readBody(req) : {};
    const query = Object.fromEntries(u.searchParams.entries());
    try {
      const out = await apiRouter(deps, { method, path: pathname, query, body, headers: req.headers });
      if (out.text != null) {
        res.writeHead(out.status, { 'Content-Type': out.contentType || 'text/plain', ...CORS });
        return res.end(out.text);
      }
      return sendJson(res, out.status, out.json);
    } catch (e) {
      console.error('[api] error:', e);
      return sendJson(res, 500, { error: 'server error' });
    }
  }

  return serveStatic(res, pathname);
});

function normalise(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return null;
  const waPhone = `+${msg.from}`;
  const profileName = value?.contacts?.[0]?.profile?.name;
  let event;
  if (msg.type === 'text') event = { kind: 'text', text: msg.text.body };
  else if (msg.type === 'interactive') {
    const r = msg.interactive.button_reply || msg.interactive.list_reply;
    event = { kind: 'interactive', replyId: r?.id, text: r?.title };
  } else if (msg.type === 'image') event = { kind: 'image', media: { id: msg.image.id, mimeType: msg.image.mime_type } };
  else event = { kind: 'text', text: '' };
  return { waPhone, profileName, ...event };
}

server.listen(config.port, () => {
  console.log(`Medinity Connect on :${config.port}  (panel: /  ·  webhook: /webhook  ·  store: ${store.kind}  ·  whatsapp: ${waReady ? 'cloud-api' : 'MOCK'})`);
  if (!waReady) console.warn('[whatsapp] not configured — using mock adapter; webhook inert until WA_* creds are set.');
  if (store.kind === 'memory') console.warn('[persistence] in-memory store — data resets on restart. Set DATABASE_URL for Postgres.');
});
