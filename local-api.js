/* Browser-local API. Same validation/ownership rules as SQLite; no cloud sync. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./api-contract.js'));
  else root.TulisLocalApi = factory(root.TulisContract);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';
  const KEY = 'tulis_local_database_v1';
  function create({ storage, crypto, locks, presets = [] }) {
    let queue = Promise.resolve();
    const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
    async function passwordHash(password, salt) {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
      return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 210000, hash: 'SHA-256' }, key, 256)));
    }
    const safe = (user, state) => {
      const { password_hash, salt, ...result } = user;
      result.streak = C.studyStats(userLogs(state, user.id));
      return result;
    };
    const fresh = () => ({ version: 1, nextId: 1, users: [], sessions: [], decks: [], logs: [] });
    function read() {
      const raw = storage.getItem(KEY);
      if (!raw) return fresh();
      const state = JSON.parse(raw);
      if (state.version !== 1 || !['users', 'sessions', 'decks', 'logs'].every(key => Array.isArray(state[key])) || !Number.isSafeInteger(state.nextId)) C.fail('Uszkodzone dane lokalne. Zachowano oryginał; przywróć kopię zapasową.', 422);
      return state;
    }
    const userDecks = (state, id) => state.decks.filter(deck => deck.user_id === id).sort((a, b) => b.id - a.id);
    const userLogs = (state, id) => state.logs.filter(log => log.user_id === id).sort((a, b) => b.id - a.id);
    function addDeck(state, user, data) {
      const item = { id: state.nextId++, user_id: user.id, ...data, updated_at: new Date().toISOString() };
      state.decks.push(item);
      return item;
    }
    async function dispatch(endpoint, method, body, token) {
      const state = read();
      const route = `${method} ${endpoint}`;
      let dirty = false;
      const finish = result => {
        if (dirty) storage.setItem(KEY, JSON.stringify(state));
        return { success: true, ...result };
      };
      function sessionFor(user) {
        state.sessions = state.sessions.filter(session => Date.parse(session.expires_at) > Date.now());
        const session = { token: `local_${random()}`, user_id: user.id, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() };
        state.sessions.push(session);
        dirty = true;
        return finish({ user: safe(user, state), token: session.token });
      }
      if (route === 'GET /api/health') return finish({ status: 'operational', mode: 'local' });
      if (route === 'GET /api/stats') return finish({ stats: { userCount: state.users.length, deckCount: state.decks.length, sessionCount: state.logs.length } });
      if (route === 'POST /api/newsletter') {
        C.email(C.object(body).email);
        C.fail('Newsletter wymaga połączenia z serwerem. Nie wysłano adresu e-mail.', 503);
      }
      if (route === 'POST /api/auth/register') {
        const input = C.credentials(body, true);
        if (state.users.some(user => user.email === input.email)) C.fail('Konto o tym adresie e-mail już istnieje.', 409);
        const salt = random();
        const user = { id: state.nextId++, email: input.email, name: input.name, role: 'starter', streak: 0, retention: '—', created_at: new Date().toISOString(), salt, password_hash: await passwordHash(input.password, salt) };
        state.users.push(user);
        return sessionFor(user);
      }
      if (route === 'POST /api/auth/login') {
        const input = C.credentials(body);
        const user = state.users.find(user => user.email === input.email && user.password_hash);
        if (!user || await passwordHash(input.password, user.salt) !== user.password_hash) C.fail('Nieprawidłowy e-mail lub hasło.', 401);
        return sessionFor(user);
      }
      if (route === 'POST /api/auth/demo') {
        let user = state.users.find(user => user.role === 'demo');
        if (!user) {
          user = { id: state.nextId++, email: 'demo@tulis.invalid', name: 'Tomasz Tulis', role: 'demo', streak: 0, retention: '—', created_at: new Date().toISOString() };
          state.users.push(user);
          for (const deck of presets) addDeck(state, user, C.deck(deck));
          // One-time migration; leave legacy keys intact for manual recovery.
          const legacy = storage.getItem('tulis_local_decks');
          if (legacy) for (const deck of C.backup({ decks: JSON.parse(legacy) }).decks) addDeck(state, user, deck);
        }
        return sessionFor(user);
      }
      const session = state.sessions.find(item => item.token === token && Date.parse(item.expires_at) > Date.now());
      const user = session && state.users.find(item => item.id === session.user_id);
      if (!user) C.fail('Wymagane logowanie.', 401);
      if (route === 'GET /api/auth/me') return finish({ user: safe(user, state) });
      if (route === 'POST /api/auth/logout') {
        state.sessions = state.sessions.filter(item => item.token !== token);
        dirty = true;
        return finish({});
      }
      if (route === 'GET /api/decks') return finish({ decks: userDecks(state, user.id) });
      if (route === 'POST /api/decks') {
        const deck = addDeck(state, user, C.deck(body));
        dirty = true;
        return finish({ deck });
      }
      const match = endpoint.match(/^\/api\/decks\/(\d+)$/);
      if (match && ['PUT', 'DELETE'].includes(method)) {
        const deck = state.decks.find(item => item.id === Number(match[1]) && item.user_id === user.id);
        if (!deck) C.fail('Nie znaleziono talii.', 404);
        dirty = true;
        if (method === 'DELETE') { state.decks = state.decks.filter(item => item !== deck); return finish({}); }
        Object.assign(deck, C.deck({ ...deck, ...C.object(body) }), { updated_at: new Date().toISOString() });
        return finish({ deck });
      }
      if (route === 'POST /api/study/log') {
        state.logs.push({ id: state.nextId++, user_id: user.id, ...C.study(body), created_at: new Date().toISOString() });
        user.streak = C.studyStats(userLogs(state, user.id));
        dirty = true;
        return finish({ user: safe(user, state) });
      }
      if (route === 'GET /api/study/history') return finish({ logs: userLogs(state, user.id).slice(0, 20).map(({ user_id, ...log }) => log) });
      if (route === 'GET /api/backup') return finish({ backup: { version: 1, export_date: new Date().toISOString(), user: safe(user, state), decks: userDecks(state, user.id), logs: userLogs(state, user.id).map(({ user_id, ...log }) => log) } });
      if (route === 'POST /api/backup') {
        const data = C.backup(body);
        for (const deck of data.decks) addDeck(state, user, deck);
        for (const log of data.logs) state.logs.push({ ...log, id: state.nextId++, user_id: user.id, created_at: log.created_at || new Date().toISOString() });
        user.streak = C.studyStats(userLogs(state, user.id));
        dirty = true;
        return finish({ imported: data.decks.length, decks: userDecks(state, user.id) });
      }
      C.fail('Endpoint not found', 404);
    }
    return {
      async request(endpoint, method = 'GET', body = null, token = '') {
        try {
          // A single localStorage write commits the transaction. Web Locks serialize tabs.
          if (locks) return await locks.request(KEY, () => dispatch(endpoint, method, body, token));
          const operation = queue.then(() => dispatch(endpoint, method, body, token));
          queue = operation.catch(() => {});
          return await operation;
        } catch (error) {
          return { success: false, status: error.statusCode || 507, error: error.statusCode ? error.message : 'Nie można odczytać lub zapisać danych lokalnych. Sprawdź pamięć przeglądarki.' };
        }
      }
    };
  }
  return { create };
});
