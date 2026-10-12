/* Shared boundary validation for SQLite and the browser-only adapter. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TulisContract = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function fail(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
  }
  function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Oczekiwano obiektu JSON.');
    return value;
  }
  function text(value, name, max, fallback) {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Nieprawidłowe pole: ${name}.`);
    return value.trim();
  }
  function email(value) {
    const result = text(value, 'email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('Podaj poprawny adres e-mail.');
    return result;
  }
  function credentials(value, register = false) {
    object(value);
    const result = { email: email(value.email), password: text(value.password, 'password', 1024) };
    // Do not trim passwords; whitespace is significant.
    result.password = value.password;
    if (register) {
      if (result.password.length < 8) fail('Hasło musi mieć co najmniej 8 znaków.');
      result.name = text(value.name, 'name', 100);
    }
    return result;
  }
  function deck(value) {
    object(value);
    const result = {
      title: text(value.title, 'title', 200),
      category: text(value.category, 'category', 100, 'Ogólne'),
      content: text(value.content, 'content', 20000)
    };
    const lines = result.content.split(/\r?\n/).filter(line => line.trim());
    if (!lines.length || lines.length > 100 || lines.some(line => {
      const index = line.indexOf('|');
      return index < 1 || !line.slice(0, index).trim() || !line.slice(index + 1).trim();
    })) fail('Talia wymaga 1–100 par w formacie pytanie | odpowiedź.');
    result.card_count = lines.length;
    return result;
  }
  function study(value) {
    object(value);
    return {
      deck_title: text(value.deck_title, 'deck_title', 200, 'Talia'),
      mode: text(value.mode, 'mode', 100, 'Fiszki'),
      score: text(value.score, 'score', 100, 'Ukończono')
    };
  }
  function backup(value) {
    object(value);
    if (!Array.isArray(value.decks) || value.decks.length > 100) fail('Nieprawidłowy format kopii zapasowej (maks. 100 talii).');
    if (value.logs !== undefined && (!Array.isArray(value.logs) || value.logs.length > 10000)) fail('Nieprawidłowa historia powtórek.');
    return {
      decks: value.decks.map(deck),
      logs: (value.logs || []).map(log => {
        const result = study(log);
        if (log.created_at !== undefined) {
          if (typeof log.created_at !== 'string' || !Number.isFinite(Date.parse(log.created_at))) fail('Nieprawidłowa data powtórki.');
          result.created_at = new Date(log.created_at).toISOString();
        }
        return result;
      })
    };
  }
  function studyStats(logs, now = new Date()) {
    const day = date => new Date(date).toISOString().slice(0, 10);
    const days = new Set(logs.map(log => day(log.created_at)));
    const cursor = new Date(now);
    if (!days.has(day(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
    let streak = 0;
    while (days.has(day(cursor))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return streak;
  }
  return { fail, object, text, email, credentials, deck, study, backup, studyStats };
});
