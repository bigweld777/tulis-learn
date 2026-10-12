const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const contract = require('./api-contract.js');

const dbPath = process.env.TULIS_DB_PATH || path.join(__dirname, 'tulis.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys for high concurrency & integrity
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'pro',
    streak INTEGER DEFAULT 0,
    retention TEXT DEFAULT '—',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'Ogólne',
    content TEXT NOT NULL,
    card_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS study_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deck_title TEXT,
    mode TEXT,
    score TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS newsletter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Password utilities using native node:crypto scrypt
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string' || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return false;
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(hash, 'hex'));
}

// User CRUD
function createUser(email, name, password, role = 'pro') {
  const passwordHash = hashPassword(password);
  const stmt = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)');
  const res = stmt.run(email.trim().toLowerCase(), name.trim(), passwordHash, role);
  db.prepare("UPDATE users SET streak = 0, retention = '—' WHERE id = ?").run(res.lastInsertRowid);
  return getUserById(res.lastInsertRowid);
}

function getUserByEmail(email) {
  const stmt = db.prepare('SELECT id, email, name, password_hash, role, streak, retention, created_at FROM users WHERE email = ?');
  return stmt.get(email.trim().toLowerCase());
}

function getUserById(id) {
  const stmt = db.prepare('SELECT id, email, name, role, streak, retention, created_at FROM users WHERE id = ?');
  const user = stmt.get(id);
  if (user) user.streak = contract.studyStats(db.prepare('SELECT created_at FROM study_logs WHERE user_id = ?').all(id));
  return user;
}

// Session management
function createSession(userId) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  const stmt = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)');
  stmt.run(token, userId, expiresAt);
  return { token, expiresAt };
}

function getUserByToken(token) {
  if (!token) return null;
  const stmt = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.streak, u.retention, u.created_at, s.expires_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `);
  const row = stmt.get(token);
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(token);
    return null;
  }
  const { expires_at, ...user } = row;
  user.streak = contract.studyStats(db.prepare('SELECT created_at FROM study_logs WHERE user_id = ?').all(user.id));
  return user;
}

function deleteSession(token) {
  const stmt = db.prepare('DELETE FROM sessions WHERE token = ?');
  stmt.run(token);
}

// Deck CRUD
function getUserDecks(userId) {
  const stmt = db.prepare('SELECT id, user_id, title, category, content, card_count, updated_at FROM decks WHERE user_id = ? ORDER BY id DESC');
  return stmt.all(userId);
}

function createDeck(userId, title, category, content, cardCount) {
  const stmt = db.prepare('INSERT INTO decks (user_id, title, category, content, card_count) VALUES (?, ?, ?, ?, ?)');
  const res = stmt.run(userId, title, category || 'Ogólne', content, cardCount || 0);
  const getStmt = db.prepare('SELECT * FROM decks WHERE id = ?');
  return getStmt.get(res.lastInsertRowid);
}

function updateDeck(deckId, userId, title, content, cardCount, category) {
  const stmt = db.prepare('UPDATE decks SET title = ?, content = ?, card_count = ?, category = COALESCE(?, category), updated_at = ? WHERE id = ? AND user_id = ?');
  const result = stmt.run(title, content, cardCount, category ?? null, new Date().toISOString(), deckId, userId);
  if (!result.changes) return null;
  return db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
}

function deleteDeck(deckId, userId) {
  const stmt = db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?');
  const res = stmt.run(deckId, userId);
  return res.changes > 0;
}

// Study Logs
function logStudy(userId, deckTitle, mode, score) {
  const stmt = db.prepare('INSERT INTO study_logs (user_id, deck_title, mode, score, created_at) VALUES (?, ?, ?, ?, ?)');
  stmt.run(userId, deckTitle, mode, score, new Date().toISOString());
  const logs = db.prepare('SELECT created_at FROM study_logs WHERE user_id = ?').all(userId);
  db.prepare('UPDATE users SET streak = ? WHERE id = ?').run(contract.studyStats(logs), userId);
}

function getUserStudyLogs(userId, limit = 20) {
  const stmt = db.prepare('SELECT id, deck_title, mode, score, created_at FROM study_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?');
  return stmt.all(userId, limit);
}

/** Import is atomic: validate the complete payload before entering a transaction. */
function importBackup(userId, payload) {
  const data = contract.backup(payload);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of data.decks) createDeck(userId, item.title, item.category, item.content, item.card_count);
    const insert = db.prepare('INSERT INTO study_logs (user_id, deck_title, mode, score, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const log of data.logs) insert.run(userId, log.deck_title, log.mode, log.score, log.created_at || new Date().toISOString());
    const logs = db.prepare('SELECT created_at FROM study_logs WHERE user_id = ?').all(userId);
    db.prepare('UPDATE users SET streak = ? WHERE id = ?').run(contract.studyStats(logs), userId);
    db.exec('COMMIT');
    return { imported: data.decks.length, decks: getUserDecks(userId) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Each visitor gets a separate demo workspace, never the shared seed account. */
function createDemoSession() {
  const template = getUserByEmail('tomasz@tulislearn.com');
  const user = createUser(`demo-${crypto.randomUUID()}@tulis.invalid`, 'Tomasz Tulis', crypto.randomBytes(32).toString('hex'), 'demo');
  for (const deck of getUserDecks(template.id).slice(-3)) createDeck(user.id, deck.title, deck.category, deck.content, deck.card_count);
  return { user: getUserById(user.id), token: createSession(user.id).token };
}

// Platform Stats
function getPlatformStats() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const deckCount = db.prepare('SELECT COUNT(*) as count FROM decks').get().count;
  const sessionCount = db.prepare('SELECT COUNT(*) as count FROM study_logs').get().count;
  return { userCount, deckCount, sessionCount };
}

// Seed Demo User and Default Decks if empty
function seedIfEmpty() {
  if (!getUserByEmail('tomasz@tulislearn.com')) {
    console.log('Seeding initial demo database...');
    const demoUser = createUser('tomasz@tulislearn.com', 'Tomasz Tulis', 'demo1234', 'pro');

    createDeck(
      demoUser.id,
      '🌿 Biologia & Medycyna',
      'Medycyna',
      `Na czym polega aktywne przypominanie? | Na odtwarzaniu wiedzy z pamięci bez zaglądania do materiałów.\nCo oznacza fotosynteza? | Wytwarzanie związków organicznych z użyciem energii światła.\nKtóre organellum odpowiada za fotosyntezę? | Chloroplast.\nJaki gaz roślina pobiera podczas fotosyntezy? | Dwutlenek węgla.`,
      4
    );

    createDeck(
      demoUser.id,
      '⚡ Informatyka & AI',
      'Technologia',
      `Czym jest złożoność O(1)? | Złożonością stałą, niezależną od rozmiaru danych wejściowych.\nNa czym polega mechanizm Attention w Transformerach? | Na dynamicznym ważeniu istotności poszczególnych tokenów względem siebie.\nCo to jest Gradient Descent? | Algorytm optymalizacji minimalizujący funkcję straty wzdłuż spadku gradientu.\nCzym różni się overfitting od underfittingu? | Overfitting to dopasowanie do szumu, underfitting to niedouczenie modelu.`,
      4
    );

    createDeck(
      demoUser.id,
      '⚖️ Prawo cywilne & Rzymskie',
      'Prawo',
      `Co oznacza reguła Pacta sunt servanda? | Umów należy dotrzymywać.\nCzym jest zdolność prawna w prawie polskim? | Zdolnością do bycia podmiotem praw i obowiązków, od urodzenia do śmierci.\nCo określa zasada Lex retro non agit? | Prawo nie działa wstecz.\nCzym jest zasada Nemo iudex in causa sua? | Nikt nie może być sędzią we własnej sprawie.`,
      4
    );

    logStudy(demoUser.id, '🌿 Biologia & Medycyna', 'Quiz', '4/4 (100%)');
    logStudy(demoUser.id, '⚡ Informatyka & AI', 'Dopasowywanie', '12.4s (Mistrz)');
    logStudy(demoUser.id, '⚖️ Prawo cywilne & Rzymskie', 'Fiszki FSRS', 'Ukończono serię');
    console.log('Database seeded successfully.');
  }
}

// Newsletter
function subscribeNewsletter(email) {
  const stmt = db.prepare('INSERT OR IGNORE INTO newsletter (email) VALUES (?)');
  stmt.run(email.trim().toLowerCase());
  return { success: true };
}

function getNewsletterSubscribersCount() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM newsletter');
  return stmt.get().count;
}

seedIfEmpty();

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  createUser,
  getUserByEmail,
  getUserById,
  createSession,
  getUserByToken,
  deleteSession,
  getUserDecks,
  createDeck,
  updateDeck,
  deleteDeck,
  logStudy,
  getUserStudyLogs,
  importBackup,
  createDemoSession,
  getPlatformStats,
  subscribeNewsletter,
  getNewsletterSubscribersCount
};
