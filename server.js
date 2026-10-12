const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db.js');

const PORT = 3000;

// Process-level resilience against crashes
process.on('uncaughtException', (err) => {
  console.error('[SERVER RESILIENCE] Uncaught Exception caught safely:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[SERVER RESILIENCE] Unhandled Rejection caught safely:', reason);
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) { // 2MB limit
        req.destroy();
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        const parseErr = new Error('Invalid JSON format');
        parseErr.statusCode = 400;
        reject(parseErr);
      }
    });
    req.on('error', (err) => {
      err.statusCode = 400;
      reject(err);
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...SECURITY_HEADERS
  });
  res.end(JSON.stringify(data));
}

function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (!token && req.headers['cookie']) {
    const match = req.headers['cookie'].match(/tulis_token=([a-zA-Z0-9_-]+)/);
    if (match) token = match[1];
  }
  if (!token) return null;
  return db.getUserByToken(token);
}

const server = http.createServer(async (req, res) => {
  try {
    // CORS Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, SECURITY_HEADERS);
      res.end();
      return;
    }

    let urlObj;
    try {
      urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Bad Request: Invalid URL');
      return;
    }

    const pathname = urlObj.pathname;

    // === REST API ROUTES ===
    if (pathname.startsWith('/api/')) {
      try {
        // 1. Auth Register
        if (pathname === '/api/auth/register' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { email, name, password } = body;
          if (!email || !name || !password || password.length < 5) {
            return sendJson(res, 400, { success: false, error: 'Wypełnij wszystkie pola (hasło min. 5 znaków).' });
          }
          const existing = db.getUserByEmail(email);
          if (existing) {
            return sendJson(res, 409, { success: false, error: 'Konto o tym adresie e-mail już istnieje.' });
          }
          const user = db.createUser(email, name, password, 'pro');
          const session = db.createSession(user.id);
          return sendJson(res, 201, { success: true, user, token: session.token });
        }

        // 2. Auth Login
        if (pathname === '/api/auth/login' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { email, password } = body;
          if (!email || !password) {
            return sendJson(res, 400, { success: false, error: 'Podaj adres e-mail i hasło.' });
          }
          const user = db.getUserByEmail(email);
          if (!user || !db.verifyPassword(password, user.password_hash)) {
            return sendJson(res, 401, { success: false, error: 'Nieprawidłowy e-mail lub hasło.' });
          }
          const session = db.createSession(user.id);
          const safeUser = db.getUserById(user.id);
          return sendJson(res, 200, { success: true, user: safeUser, token: session.token });
        }

        // 3. Demo Quick Login
        if (pathname === '/api/auth/demo' && req.method === 'POST') {
          let demoUser = db.getUserByEmail('tomasz@tulislearn.com');
          if (!demoUser) {
            demoUser = db.createUser('tomasz@tulislearn.com', 'Tomasz Tulis', 'demo1234', 'pro');
          }
          const session = db.createSession(demoUser.id);
          const safeUser = db.getUserById(demoUser.id);
          return sendJson(res, 200, { success: true, user: safeUser, token: session.token });
        }

        // 4. Current User (Auth Me)
        if (pathname === '/api/auth/me' && req.method === 'GET') {
          const user = getAuthUser(req);
          if (!user) {
            return sendJson(res, 401, { success: false, error: 'Brak aktywnej sesji' });
          }
          return sendJson(res, 200, { success: true, user });
        }

        // 5. Auth Logout
        if (pathname === '/api/auth/logout' && req.method === 'POST') {
          const authHeader = req.headers['authorization'] || '';
          let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
          if (token) db.deleteSession(token);
          return sendJson(res, 200, { success: true, message: 'Wylogowano pomyślnie' });
        }

        // 6. User Decks: GET & POST
        if (pathname === '/api/decks' && req.method === 'GET') {
          const user = getAuthUser(req);
          const userId = user ? user.id : 1; // Default to demo user if unauthenticated
          const decks = db.getUserDecks(userId);
          return sendJson(res, 200, { success: true, decks });
        }

        if (pathname === '/api/decks' && req.method === 'POST') {
          const user = getAuthUser(req);
          if (!user) return sendJson(res, 401, { success: false, error: 'Wymagane logowanie' });
          const body = await parseJsonBody(req);
          const { title, category, content, card_count } = body;
          if (!title || !content) {
            return sendJson(res, 400, { success: false, error: 'Tytuł i zawartość są wymagane' });
          }
          const deck = db.createDeck(user.id, title, category, content, card_count);
          return sendJson(res, 201, { success: true, deck });
        }

        // 7. Deck specific: PUT & DELETE
        const deckMatch = pathname.match(/^\/api\/decks\/(\d+)$/);
        if (deckMatch) {
          const deckId = parseInt(deckMatch[1], 10);
          const user = getAuthUser(req);
          if (!user) return sendJson(res, 401, { success: false, error: 'Wymagane logowanie' });

          if (req.method === 'PUT') {
            const body = await parseJsonBody(req);
            const { title, content, card_count } = body;
            const updated = db.updateDeck(deckId, user.id, title, content, card_count);
            return sendJson(res, 200, { success: true, deck: updated });
          }

          if (req.method === 'DELETE') {
            const ok = db.deleteDeck(deckId, user.id);
            return sendJson(res, 200, { success: ok });
          }
        }

        // 8. Study Log: POST & GET
        if (pathname === '/api/study/log' && req.method === 'POST') {
          const user = getAuthUser(req);
          const userId = user ? user.id : 1;
          const body = await parseJsonBody(req);
          const { deck_title, mode, score } = body;
          db.logStudy(userId, deck_title || 'Talia', mode || 'Fiszki', score || 'Ukończono');

          if (user) {
            const newStreak = (user.streak || 5) + 1;
            db.updateUserStats(user.id, newStreak, user.retention || '95.0%');
          }
          return sendJson(res, 200, { success: true });
        }

        if (pathname === '/api/study/history' && req.method === 'GET') {
          const user = getAuthUser(req);
          const userId = user ? user.id : 1;
          const logs = db.getUserStudyLogs(userId);
          return sendJson(res, 200, { success: true, logs });
        }

        // 9. Platform Overview Stats
        if (pathname === '/api/stats' && req.method === 'GET') {
          const stats = db.getPlatformStats();
          return sendJson(res, 200, { success: true, stats });
        }

        // 10. Backup Export (GET) & Import (POST)
        if (pathname === '/api/backup' && req.method === 'GET') {
          const user = getAuthUser(req);
          const userId = user ? user.id : 1;
          const decks = db.getUserDecks(userId);
          const logs = db.getUserStudyLogs(userId);
          return sendJson(res, 200, {
            success: true,
            backup: {
              export_date: new Date().toISOString(),
              user: user || { name: 'Gość' },
              decks,
              logs
            }
          });
        }

        if (pathname === '/api/backup' && req.method === 'POST') {
          const user = getAuthUser(req);
          if (!user) return sendJson(res, 401, { success: false, error: 'Wymagane logowanie' });
          const body = await parseJsonBody(req);
          if (!body || !Array.isArray(body.decks)) {
            return sendJson(res, 400, { success: false, error: 'Nieprawidłowy format kopii zapasowej.' });
          }
          let imported = 0;
          for (const d of body.decks) {
            if (d && d.title && d.content) {
              db.createDeck(user.id, d.title, d.category || 'Import', d.content, d.card_count || 4);
              imported++;
            }
          }
          const updatedDecks = db.getUserDecks(user.id);
          return sendJson(res, 200, { success: true, imported, decks: updatedDecks });
        }

        // 11. Health Check
        if (pathname === '/api/health' && req.method === 'GET') {
          return sendJson(res, 200, {
            success: true,
            status: 'operational',
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString()
          });
        }

        // 12. Newsletter Subscription
        if (pathname === '/api/newsletter' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const email = (body.email || '').trim();
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!email || !emailRegex.test(email)) {
            return sendJson(res, 400, { success: false, error: 'Podaj poprawny adres e-mail.' });
          }
          db.subscribeNewsletter(email);
          return sendJson(res, 200, {
            success: true,
            message: 'Dziękujemy za zapis do biuletynu kognitywnego!'
          });
        }

        return sendJson(res, 404, { success: false, error: 'Endpoint not found' });
      } catch (err) {
        console.error('API Error:', err.message);
        const code = err.statusCode || 500;
        return sendJson(res, code, { success: false, error: err.message });
      }
    }

    // === STATIC FILE SERVING WITH STRICT SECURITY ===
    let reqPath;
    try {
      reqPath = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Bad Request: Malformed URI');
      return;
    }

    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    // Normalize and sanitize path
    const safeRelative = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, safeRelative);

    // Security check 1: Directory traversal defense
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Forbidden: Directory traversal denied');
      return;
    }

    // Security check 2: Block server code, database files, and sensitive configurations
    const baseName = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();
    const blockedFiles = new Set(['server.js', 'db.js', 'test_suite.js', 'package.json', 'package-lock.json', '.gitignore']);

    if (
      blockedFiles.has(baseName) ||
      baseName.startsWith('.') ||
      ext === '.db' ||
      baseName.includes('.db-') ||
      ext === '.wal' ||
      ext === '.shm' ||
      ext === '.log' ||
      ext === '.sqlite'
    ) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Forbidden: Access to sensitive file is prohibited');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
        res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>404 Not Found</title></head><body><h1>404 Not Found</h1><p><a href="/">Powrót do Tulis Learn</a></p></body></html>');
        return;
      }

      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': (ext === '.html' || baseName === 'sw.js') ? 'no-cache' : 'public, max-age=3600',
        'Service-Worker-Allowed': '/',
        ...SECURITY_HEADERS
      });

      fs.createReadStream(filePath).pipe(res);
    });
  } catch (globalErr) {
    console.error('[SERVER GLOBAL CATCH]:', globalErr);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Internal Server Error');
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Tulis Learn server with SQLite DB running at: http://localhost:${PORT}/`);
});
