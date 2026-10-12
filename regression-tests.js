'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const C = require('./api-contract.js');
const { create: createLocal } = require('./local-api.js');
const Reviews = require('./review-store.js');

module.exports = async function ({ assert, base, db }) {
  const sample = { title: 'Example', category: 'Test', content: 'Question | Answer', card_count: 999 };
  const storage = new Map();
  const memory = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  // Same scenarios exercise both adapters, not just mock HTTP responses.
  const local = createLocal({ storage: memory, crypto, presets: [sample] });
  const secureStorage = new Map();
  const secureMemory = { getItem: key => secureStorage.get(key) ?? null, setItem: (key, value) => secureStorage.set(key, value) };
  const secureLocal = createLocal({ storage: secureMemory, crypto, presets: [sample] });
  const member = await secureLocal.request('/api/auth/register', 'POST', { email: 'member@example.test', name: 'Member', password: 'password123' });
  const memberState = JSON.parse(secureMemory.getItem('tulis_local_database_v1'));
  memberState.users.find(user => user.id === member.user.id).role = 'pro';
  secureMemory.setItem('tulis_local_database_v1', JSON.stringify(memberState));
  const instant = await secureLocal.request('/api/auth/quick-start', 'POST');
  const instantMe = await secureLocal.request('/api/auth/me', 'GET', null, instant.token);
  assert(instant.success && instant.user.id !== member.user.id && instantMe.user.role === 'pro' && instantMe.user.email === 'tomasz@tulislearn.com', 'Quick Start: local PRO access never opens a password-protected member account');
  const instantDeck = await secureLocal.request('/api/decks', 'POST', sample, instant.token);
  const resumed = await secureLocal.request('/api/auth/quick-start', 'POST');
  assert(resumed.user.id === instant.user.id && (await secureLocal.request('/api/decks', 'GET', null, resumed.token)).decks.some(deck => deck.id === instantDeck.deck.id), 'Quick Start: returning local access preserves its own decks');
  const sqliteInstant = db.createQuickStartSession();
  const sqliteOther = db.createQuickStartSession();
  const sqliteMe = db.getUserByToken(sqliteInstant.token);
  assert(sqliteInstant.user.email === 'tomasz@tulislearn.com' && sqliteMe.email === sqliteInstant.user.email && sqliteMe.role === 'pro' && sqliteOther.user.id !== sqliteInstant.user.id, 'Quick Start: SQLite preserves separate identities with a consistent PRO profile');
  const privateDeck = db.createDeck(sqliteInstant.user.id, sample.title, sample.category, sample.content, 1);
  assert(!db.getUserDecks(sqliteOther.user.id).some(deck => deck.id === privateDeck.id), 'Quick Start: separate SQLite sessions never share private decks');
  async function http(endpoint, method = 'GET', body, token, extra = {}) {
    const response = await fetch(base + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return { ...await response.json(), status: response.status, headers: response.headers };
  }
  for (const [name, request] of [['SQLite', http], ['localStorage', (e, m, b, t) => local.request(e, m, b, t)]]) {
    const prefix = name + ': ';
    for (const endpoint of ['/api/decks', '/api/backup', '/api/study/history']) assert((await request(endpoint)).status === 401, prefix + endpoint + ' requires authentication');
    assert((await request('/api/auth/me', 'GET', undefined, 'invalid')).status === 401, prefix + 'invalid token rejected');
    assert((await request('/api/auth/register', 'POST', { email: {}, name: 'Test', password: 'password' })).status === 400, prefix + 'non-string email rejected');
    assert((await request('/api/auth/register', 'POST', { email: 'a@b.test', name: ' ', password: 'password' })).status === 400, prefix + 'whitespace name rejected');
    const first = await request('/api/auth/register', 'POST', { email: 'review-one@example.test', name: '<script>test</script>', password: '  password  ' });
    const second = await request('/api/auth/register', 'POST', { email: 'review-two@example.test', name: 'Second', password: 'password2' });
    assert(first.success && second.success && !first.user.password_hash && first.user.streak === 0, prefix + 'registration creates safe user with honest stats');
    const token = first.token;
    assert((await request('/api/auth/register', 'POST', { email: 'REVIEW-ONE@EXAMPLE.TEST', name: 'Test', password: 'password' })).status === 409, prefix + 'case-insensitive duplicate registration rejected');
    assert((await request('/api/auth/login', 'POST', { email: first.user.email, password: 'wrong' })).status === 401, prefix + 'wrong password rejected');
    assert((await request('/api/auth/login', 'POST', { email: first.user.email, password: '  password  ' })).success, prefix + 'password whitespace preserved');
    assert((await request('/api/decks', 'POST', { ...sample, content: 'broken' }, token)).status === 400, prefix + 'malformed flashcards rejected');
    const created = await request('/api/decks', 'POST', sample, token);
    assert(created.success && created.deck.card_count === 1, prefix + 'card count derived from content');
    const id = created.deck.id;
    const otherUpdate = await request('/api/decks/' + id, 'PUT', { title: 'Stolen' }, second.token);
    assert(otherUpdate.status === 404 && !otherUpdate.deck, prefix + 'cross-user update never reveals a deck');
    assert((await request('/api/decks/' + id, 'DELETE', undefined, second.token)).status === 404, prefix + 'cross-user deletion rejected');
    const updated = await request('/api/decks/' + id, 'PUT', { title: "SQL '); DROP TABLE users; --", category: 'Updated' }, token);
    assert(updated.success && updated.deck.content === sample.content && updated.deck.category === 'Updated', prefix + 'partial update preserves data and category; SQL remains inert text');
    const before = (await request('/api/decks', 'GET', undefined, token)).decks.length;
    const invalid = await request('/api/backup', 'POST', { decks: [sample, { title: 'Bad', content: [] }] }, token);
    assert(invalid.status === 400 && (await request('/api/decks', 'GET', undefined, token)).decks.length === before, prefix + 'invalid backup imports nothing');
    const backup = { decks: [sample], logs: [{ deck_title: 'Example', mode: 'Quiz', score: '1/1', created_at: '2026-01-01T12:00:00.000Z' }] };
    const imported = await request('/api/backup', 'POST', backup, token);
    assert(imported.success && imported.imported === 1, prefix + 'atomic backup import succeeds');
    const exported = await request('/api/backup', 'GET', undefined, token);
    assert(exported.backup.decks.length === before + 1 && exported.backup.logs.length === 1 && exported.backup.logs[0].score === '1/1', prefix + 'backup round-trips decks and study logs');
    await request('/api/study/log', 'POST', { deck_title: 'Example', mode: 'Quiz', score: '1/1' }, token);
    await request('/api/study/log', 'POST', { deck_title: 'Example', mode: 'Quiz', score: '1/1' }, token);
    assert((await request('/api/auth/me', 'GET', undefined, token)).user.streak === 1, prefix + 'repeated sessions on one day count as one streak day');
    assert((await request('/api/study/history', 'GET', undefined, token)).logs.length === 3, prefix + 'study history persists');
    assert((await request('/api/decks/' + id, 'DELETE', undefined, token)).success, prefix + 'owner can delete a deck');
    assert((await request('/api/decks/' + id, 'PUT', sample, token)).status === 404, prefix + 'missing deck update returns 404');
    assert((await request('/api/unknown', 'GET', undefined, token)).status === 404, prefix + 'unknown endpoint returns failure');
    await request('/api/auth/logout', 'POST', undefined, token);
    assert((await request('/api/auth/me', 'GET', undefined, token)).status === 401, prefix + 'logout invalidates session');
  }
  const reloaded = createLocal({ storage: memory, crypto });
  const login = await reloaded.request('/api/auth/login', 'POST', { email: 'review-one@example.test', password: '  password  ' });
  assert(login.success && (await reloaded.request('/api/decks', 'GET', null, login.token)).decks.length === 1, 'localStorage: credentials and decks survive adapter reload');
  assert((await reloaded.request('/api/newsletter', 'POST', { email: 'a@b.test' })).status === 503, 'localStorage: newsletter never reports a delivery it cannot perform');
  assert(!JSON.stringify([...storage.values()]).includes('  password  '), 'localStorage: passwords are never stored as plaintext');
  const fullStorage = { getItem: memory.getItem, setItem() { throw new Error('Quota exceeded'); } };
  const full = createLocal({ storage: fullStorage, crypto });
  assert((await full.request('/api/decks', 'POST', sample, login.token)).status === 507, 'localStorage: quota failure is reported, not a false success');
  assert((await reloaded.request('/api/decks', 'GET', null, login.token)).decks.length === 1, 'localStorage: failed write preserves previous database');
  const simultaneous = await Promise.all([reloaded.request('/api/decks', 'POST', sample, login.token), reloaded.request('/api/decks', 'POST', sample, login.token)]);
  assert(simultaneous.every(result => result.success) && new Set(simultaneous.map(result => result.deck.id)).size === 2 && (await reloaded.request('/api/decks', 'GET', null, login.token)).decks.length === 3, 'localStorage: concurrent writes preserve both decks and unique IDs');
  const localState = JSON.parse(memory.getItem('tulis_local_database_v1'));
  const localUserId = localState.sessions.find(session => session.token === login.token).user_id;
  for (const log of localState.logs.filter(log => log.user_id === localUserId)) log.created_at = '2000-01-01T00:00:00.000Z';
  memory.setItem('tulis_local_database_v1', JSON.stringify(localState));
  assert((await reloaded.request('/api/auth/me', 'GET', null, login.token)).user.streak === 0, 'localStorage: stale streak resets even before a new study session');
  localState.sessions.find(session => session.token === login.token).expires_at = '2000-01-01T00:00:00.000Z';
  memory.setItem('tulis_local_database_v1', JSON.stringify(localState));
  assert((await reloaded.request('/api/auth/me', 'GET', null, login.token)).status === 401, 'localStorage: expired sessions are rejected after reload');
  const corrupt = createLocal({ storage: { getItem: () => '{broken', setItem() { throw Error('must not overwrite'); } }, crypto });
  assert(!(await corrupt.request('/api/auth/quick-start', 'POST')).success, 'localStorage: corrupt JSON fails safely without overwriting it');
  const blank = createLocal({ storage: { getItem: () => null, setItem() { throw Error('blocked'); } }, crypto });
  assert(!(await blank.request('/api/auth/quick-start', 'POST')).success, 'localStorage: blocked persistence does not create a false session');

  assert(db.verifyPassword('anything', 'a:ff') === false, 'Malformed stored password hash does not crash timingSafeEqual');
  const inactive = db.createUser('inactive@example.test', 'Inactive', 'password123', 'starter');
  db.logStudy(inactive.id, 'Example', 'Fiszki', 'Good');
  db.db.prepare('UPDATE study_logs SET created_at = ? WHERE user_id = ?').run('2000-01-01T00:00:00.000Z', inactive.id);
  assert(db.getUserByToken(db.createSession(inactive.id).token).streak === 0 && db.getUserById(inactive.id).streak === 0, 'SQLite: stale streak resets even before a new study session');
  const expired = db.createSession(1);
  db.db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run('2000-01-01T00:00:00.000Z', expired.token);
  assert((await http('/api/auth/me', 'GET', undefined, expired.token)).status === 401, 'Expired server sessions rejected');
  assert((await http('/api/auth/login', 'POST', null)).status === 400, 'Null JSON bodies rejected with 400');
  assert((await http('/api/auth/login', 'POST', [])).status === 400, 'Array JSON bodies rejected with 400');
  assert((await http('/api/health', 'GET', undefined, undefined, { Origin: 'https://untrusted.example' })).status === 403, 'Cross-origin API requests rejected');
  for (const file of ['/.git/config', '/.git/HEAD', '/netlify.toml', '/api-contract.js/../../db.js', '/vendor/../db.js', '/regression-tests.js', '/work/polish.cjs']) {
    assert((await fetch(base + file)).status === 403, 'Static allowlist blocks ' + file);
  }
  const oversized = await fetch(base + '/api/auth/login', { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(2 * 1024 * 1024) }), signal: AbortSignal.timeout(5000) });
  assert(oversized.status === 413, 'Oversized requests receive a real 413 response');
  const response = await fetch(base + '/');
  assert(response.headers.get('content-security-policy').includes("script-src 'self'"), 'CSP forbids inline scripts and remote script execution');
  assert(!(await http('/api/health')).headers.get('access-control-allow-origin'), 'No wildcard CORS policy');

  const card = { question: 'Remember this?', answer: 'Yes.' };
  const reviews = Reviews.create(memory, 'regression');
  const now = new Date('2026-01-01T10:00:00.000Z');
  const preview = reviews.preview(card, now);
  assert(preview[1].card.due < preview[4].card.due, 'FSRS: Again is scheduled before Easy');
  const rated = reviews.rate(card, 'good', now);
  assert(rated.stability > 0 && rated.difficulty > 0 && rated.reps === 1, 'FSRS: rating updates actual memory state');
  assert(Reviews.create(memory, 'regression').metrics([card], now).reviewed === 1, 'FSRS: reviewed state survives reload');
  assert(!reviews.isDue(card, now) && reviews.isDue(card, rated.due), 'FSRS: due queue follows stored schedule');
  const next = reviews.rate(card, 'easy', new Date('2026-01-02T10:00:00.000Z'));
  assert(next.reps === 2 && next.due > rated.due, 'FSRS: repeated rating adapts the next interval');
  assert(Reviews.create(memory, 'another-user').metrics([card], now).reviewed === 0, 'FSRS: schedules are scoped to a profile');
  const snapshot = reviews.snapshot();
  const restored = Reviews.create(memory, 'restored');
  restored.restore(snapshot);
  assert(restored.snapshot().cards[JSON.stringify([card.question, card.answer])].reps === 2, 'FSRS: backup restores the full memory state');
  let invalidSnapshotRejected = false;
  try { restored.restore({ ...snapshot, cards: { bad: { due: 'invalid' } } }); } catch { invalidSnapshotRejected = true; }
  assert(invalidSnapshotRejected && restored.metrics([card], now).reviewed === 1, 'FSRS: invalid backup leaves the existing schedule intact');
  let quotaReported = false;
  try { Reviews.create(fullStorage, 'regression').rate(card, 'easy', now); } catch { quotaReported = true; }
  assert(quotaReported, 'FSRS: failed persistence surfaces an error');
  assert(C.studyStats([{ created_at: '2026-01-01T12:00:00Z' }, { created_at: '2026-01-02T12:00:00Z' }], new Date('2026-01-03T12:00:00Z')) === 2, 'Streak tolerates an unfinished current day');
  assert(C.studyStats([{ created_at: '2026-01-01T12:00:00Z' }], new Date('2026-01-04T12:00:00Z')) === 0, 'Streak resets after a missed day');

  const handlers = {};
  let installedAssets;
  const deleted = [];
  const cache = { addAll: async assets => { installedAssets = assets; }, match: async url => String(url).endsWith('/index.html') ? new Response('offline shell') : undefined, put: async () => {} };
  const context = vm.createContext({ URL, Response, Set, Promise, self: { location: { href: 'https://example.test/tulis-learn/sw.js' }, addEventListener: (type, handler) => { handlers[type] = handler; }, skipWaiting: async () => {}, clients: { claim: async () => {} } }, caches: { open: async () => cache, keys: async () => ['other-app-cache', 'tulis-learn-v2'], delete: async key => deleted.push(key) }, fetch: async () => { throw Error('offline'); } });
  vm.runInContext(fs.readFileSync(require.resolve('./sw.js'), 'utf8'), context);
  await new Promise(resolve => handlers.install({ waitUntil: p => p.then(resolve) }));
  assert(installedAssets.every(asset => asset.startsWith('./')), 'PWA: all precache assets resolve within subdirectory scope');
  await new Promise(resolve => handlers.activate({ waitUntil: p => p.then(resolve) }));
  assert(deleted.length === 1 && deleted[0] === 'tulis-learn-v2', 'PWA: activation preserves caches belonging to other apps');
  let offline;
  handlers.fetch({ request: { url: 'https://example.test/tulis-learn/', method: 'GET', mode: 'navigate' }, waitUntil: () => {}, respondWith: p => { offline = p; } });
  assert(await (await offline).text() === 'offline shell', 'PWA: offline navigation returns the scoped application shell');
  offline = undefined;
  handlers.fetch({ request: { url: 'https://example.test/tulis-learn/?source=quick-start#aplikacja', method: 'GET', mode: 'navigate' }, waitUntil: () => {}, respondWith: p => { offline = p; } });
  assert(offline && await (await offline).text() === 'offline shell', 'PWA: query strings and fragments preserve offline navigation');
  let intercepted = false;
  handlers.fetch({ request: { url: 'https://example.test/tulis-learn/api/backup', method: 'GET' }, respondWith: () => { intercepted = true; } });
  handlers.fetch({ request: { url: 'https://external.example/app.js', method: 'GET' }, respondWith: () => { intercepted = true; } });
  assert(!intercepted, 'PWA: API and third-party requests are never cached');

  const js = fs.readFileSync(require.resolve('./app.js'), 'utf8');
  assert(!/atob\(|AIza[\w-]{20}|onclick=/.test(js), 'Client contains no embedded API key or inline handlers');
  assert(js.includes('function escapeHtml('), 'HTML escaping helper exists at runtime');
  const html = fs.readFileSync(require.resolve('./index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert(new Set(ids).size === ids.length, 'DOM IDs are unique');
  assert(html.includes('prefers-reduced-motion') && html.includes(':focus-visible'), 'Reduced motion and keyboard focus styles present');
  assert(!/\son[a-z]+\s*=/.test(html), 'HTML contains no CSP-blocked inline event handlers');
  assert(html.includes('srsAgainBtn') && html.includes('graphAccessibleList'), 'All four FSRS ratings and accessible graph list available');
  let dialogDepth = 0;
  let validDialogs = true;
  for (const tag of html.matchAll(/<\/?dialog\b[^>]*>/g)) {
    dialogDepth += tag[0].startsWith('</') ? -1 : 1;
    if (dialogDepth < 0 || dialogDepth > 1) validDialogs = false;
  }
  assert(validDialogs && dialogDepth === 0, 'Dialogs are balanced siblings; notifications cannot be trapped inside a closed dialog');
  assert(fs.readFileSync(require.resolve('./netlify.toml'), 'utf8').includes('publish = "dist"'), 'Netlify publishes only staged public assets');

  // Run last: intentionally exhaust this isolated instance's auth limiter.
  let rateStatus;
  for (let i = 0; i < 25; i++) rateStatus = (await http('/api/auth/login', 'POST', { email: 'invalid@example.test', password: 'wrong' })).status;
  assert(rateStatus === 429, 'Authentication brute-force attempts are rate limited');
};
