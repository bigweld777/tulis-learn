'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db.js');
const contract = require('./api-contract.js');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://generativelanguage.googleapis.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
  'Cross-Origin-Resource-Policy': 'same-origin'
};
const PUBLIC_FILES = new Set(['index.html', 'app.js', 'api-contract.js', 'local-api.js', 'review-store.js', 'vendor/ts-fsrs.js', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'manifest.json', 'sw.js', '404.html', 'robots.txt', 'sitemap.xml']);
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const MAX_BODY = 2 * 1024 * 1024;

/** Drain oversized requests so the client receives a real 413 response. */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
        if (!tooLarge) { tooLarge = true; chunks.length = 0; reject(Object.assign(new Error('Payload too large'), { statusCode: 413 })); }
      } else if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(contract.object(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))); }
      catch (error) { reject(Object.assign(error, { statusCode: 400 })); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(Object.assign(new Error('Request aborted'), { statusCode: 400 })));
  });
}
function sendJson(res, status, data) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function tokenOf(req) {
  const header = req.headers.authorization || '';
  return /^Bearer [a-f0-9]{64}$/.test(header) ? header.slice(7) : '';
}
function requireUser(req) {
  const user = db.getUserByToken(tokenOf(req));
  if (!user) contract.fail('Wymagane logowanie.', 401);
  return user;
}
/** Each instance owns its limiter; tests run against an isolated database. */
function createServer() {
  const buckets = new Map();
  function rateLimit(req, auth) {
    const now = Date.now();
    for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
    const key = `${req.socket.remoteAddress}:${auth ? 'auth' : 'api'}`;
    const entry = buckets.get(key) || { count: 0, until: now + 60000 };
    entry.count++;
    buckets.set(key, entry);
    if (entry.count > (auth ? 20 : 240)) contract.fail('Zbyt wiele żądań. Spróbuj za minutę.', 429);
  }
  const server = http.createServer(async (req, res) => {
    try {
      const host = new URL(`http://${req.headers.host || 'localhost'}`).hostname;
      const allowedHosts = process.env.PUBLIC_ORIGIN ? [new URL(process.env.PUBLIC_ORIGIN).hostname] : ['localhost', '127.0.0.1', '[::1]'];
      if (!allowedHosts.includes(host)) contract.fail('Host not allowed', 403);
      const url = new URL(req.url, 'http://localhost');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { contract.fail('Malformed URI', 400); }
      if (pathname.includes('\0')) contract.fail('Invalid path', 400);
      if (pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        const expectedOrigin = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
        if (origin && origin !== expectedOrigin) contract.fail('Origin not allowed', 403);
        rateLimit(req, pathname.startsWith('/api/auth/') && req.method === 'POST');
        const route = `${req.method} ${pathname}`;
        if (route === 'GET /api/health') return sendJson(res, 200, { success: true, status: 'operational', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
        if (route === 'GET /api/stats') return sendJson(res, 200, { success: true, stats: db.getPlatformStats() });
        if (route === 'POST /api/auth/register') {
          const body = contract.credentials(await parseJsonBody(req), true);
          if (db.getUserByEmail(body.email)) contract.fail('Konto o tym adresie e-mail już istnieje.', 409);
          const user = db.createUser(body.email, body.name, body.password, 'starter');
          return sendJson(res, 201, { success: true, user, token: db.createSession(user.id).token });
        }
        if (route === 'POST /api/auth/login') {
          const body = contract.credentials(await parseJsonBody(req));
          const user = db.getUserByEmail(body.email);
          if (!user || !db.verifyPassword(body.password, user.password_hash)) contract.fail('Nieprawidłowy e-mail lub hasło.', 401);
          return sendJson(res, 200, { success: true, user: db.getUserById(user.id), token: db.createSession(user.id).token });
        }
        if (route === 'POST /api/auth/quick-start') {
          if (process.env.DISABLE_QUICK_START === '1') contract.fail('Quick Start disabled', 403);
          return sendJson(res, 200, { success: true, ...db.createQuickStartSession() });
        }
        if (route === 'POST /api/newsletter') {
          const body = await parseJsonBody(req);
          db.subscribeNewsletter(contract.email(body.email));
          return sendJson(res, 200, { success: true });
        }
        const user = requireUser(req);
        if (route === 'GET /api/auth/me') return sendJson(res, 200, { success: true, user });
        if (route === 'POST /api/auth/logout') {
          db.deleteSession(tokenOf(req));
          return sendJson(res, 200, { success: true });
        }
        if (route === 'GET /api/decks') return sendJson(res, 200, { success: true, decks: db.getUserDecks(user.id) });
        if (route === 'POST /api/decks') {
          const body = contract.deck(await parseJsonBody(req));
          return sendJson(res, 201, { success: true, deck: db.createDeck(user.id, body.title, body.category, body.content, body.card_count) });
        }
        const match = pathname.match(/^\/api\/decks\/(\d+)$/);
        if (match && ['PUT', 'DELETE'].includes(req.method)) {
          const id = Number(match[1]);
          if (!Number.isSafeInteger(id)) contract.fail('Invalid deck ID');
          const existing = db.getUserDecks(user.id).find(deck => deck.id === id);
          if (!existing) contract.fail('Nie znaleziono talii.', 404);
          if (req.method === 'DELETE') {
            db.deleteDeck(id, user.id);
            return sendJson(res, 200, { success: true });
          }
          const body = contract.deck({ ...existing, ...await parseJsonBody(req) });
          return sendJson(res, 200, { success: true, deck: db.updateDeck(id, user.id, body.title, body.content, body.card_count, body.category) });
        }
        if (route === 'POST /api/study/log') {
          const body = contract.study(await parseJsonBody(req));
          db.logStudy(user.id, body.deck_title, body.mode, body.score);
          return sendJson(res, 200, { success: true, user: db.getUserById(user.id) });
        }
        if (route === 'GET /api/study/history') return sendJson(res, 200, { success: true, logs: db.getUserStudyLogs(user.id) });
        if (route === 'GET /api/backup') return sendJson(res, 200, { success: true, backup: { version: 1, export_date: new Date().toISOString(), user, decks: db.getUserDecks(user.id), logs: db.getUserStudyLogs(user.id, 10000) } });
        if (route === 'POST /api/backup') return sendJson(res, 200, { success: true, ...db.importBackup(user.id, await parseJsonBody(req)) });
        contract.fail('Endpoint not found', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) contract.fail('Method not allowed', 405);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      // The allowlist blocks .git, nested dotfiles, configs and unknown files.
      if (!PUBLIC_FILES.has(relative)) contract.fail('Forbidden', 403);
      const filename = path.join(__dirname, relative);
      const real = await fs.promises.realpath(filename).catch(() => null);
      if (!real) contract.fail('Not found', 404);
      const within = path.relative(__dirname, real);
      if (within.startsWith('..') || path.isAbsolute(within)) contract.fail('Forbidden', 403);
      const content = await fs.promises.readFile(real);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME_TYPES[path.extname(relative)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-cache', ...(relative === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const status = error.statusCode || 500;
      if (status === 500) console.error('Request failed:', error.message);
      if (!res.headersSent && !res.destroyed) sendJson(res, status, { success: false, error: status === 500 ? 'Internal server error' : error.message });
      else if (!res.destroyed) res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Tulis Learn: http://${host}:${port}/`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(() => { db.db.close(); process.exit(0); });
    server.closeIdleConnections();
  });
}
module.exports = { createServer, parseJsonBody };
