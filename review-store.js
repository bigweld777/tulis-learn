/* FSRS scheduling and persistence, independent of rendering and network state. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/ts-fsrs.js'));
  else root.TulisReviews = factory(root.FSRS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FSRS) {
  'use strict';
  const scheduler = FSRS.fsrs({ request_retention: 0.9, enable_fuzz: false });
  const grades = { again: FSRS.Rating.Again, hard: FSRS.Rating.Hard, good: FSRS.Rating.Good, easy: FSRS.Rating.Easy };
  function validateSnapshot(data) {
    if (!data || data.version !== 1 || !data.cards || typeof data.cards !== 'object' || Array.isArray(data.cards) || !Array.isArray(data.reviews) || data.reviews.length > 2000 || Object.keys(data.cards).length > 10000) throw new Error('Nieprawidłowa kopia harmonogramu FSRS.');
    for (const [key, card] of Object.entries(data.cards)) {
      const identity = JSON.parse(key);
      if (!Array.isArray(identity) || identity.length !== 2 || identity.some(value => typeof value !== 'string' || value.length > 20000)) throw new Error('Nieprawidłowy identyfikator fiszki FSRS.');
      if (!card || typeof card.due !== 'string' || !Number.isFinite(Date.parse(card.due)) || ![0, 1, 2, 3].includes(card.state)) throw new Error('Nieprawidłowy stan fiszki FSRS.');
      for (const field of ['stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'reps', 'lapses', 'learning_steps']) {
        if (!Number.isFinite(card[field]) || card[field] < 0) throw new Error('Nieprawidłowa wartość FSRS: ' + field);
      }
      if (card.difficulty > 10 || (card.last_review && !Number.isFinite(Date.parse(card.last_review)))) throw new Error('Nieprawidłowy stan pamięci FSRS.');
    }
    for (const log of data.reviews) {
      if (!log || typeof log.card !== 'string' || ![1, 2, 3, 4].includes(log.rating) || !Number.isFinite(Date.parse(log.review))) throw new Error('Nieprawidłowy zapis oceny FSRS.');
    }
    return JSON.parse(JSON.stringify(data));
  }
  function create(storage, namespace) {
    const key = `tulis_fsrs_v1:${namespace}`;
    const identity = card => JSON.stringify([card.question, card.answer]);
    function read() {
      const data = JSON.parse(storage.getItem(key) || '{"version":1,"cards":{},"reviews":[]}');
      if (data.version !== 1 || !data.cards || typeof data.cards !== 'object' || Array.isArray(data.cards) || !Array.isArray(data.reviews)) throw new Error('Uszkodzony zapis FSRS.');
      return data;
    }
    function getCard(data, card, now) {
      const saved = data.cards[identity(card)];
      if (!saved) return FSRS.createEmptyCard(now);
      if (!Number.isFinite(Date.parse(saved.due)) || !Number.isFinite(saved.stability) || !Number.isFinite(saved.difficulty)) throw new Error('Uszkodzony stan fiszki FSRS.');
      return { ...saved, due: new Date(saved.due), last_review: saved.last_review ? new Date(saved.last_review) : undefined };
    }
    return {
      preview(card, now = new Date()) { return scheduler.repeat(getCard(read(), card, now), now); },
      rate(card, grade, now = new Date()) {
        if (!grades[grade]) throw new Error('Invalid FSRS rating');
        const data = read();
        const result = scheduler.next(getCard(data, card, now), now, grades[grade]);
        data.cards[identity(card)] = result.card;
        data.reviews.push({ card: identity(card), ...result.log });
        data.reviews = data.reviews.slice(-2000);
        storage.setItem(key, JSON.stringify(data));
        return result.card;
      },
      metrics(cards, now = new Date()) {
        const data = read();
        const reviewed = cards.map(card => getCard(data, card, now)).filter(card => card.reps > 0);
        const mean = field => reviewed.length ? reviewed.reduce((sum, card) => sum + card[field], 0) / reviewed.length : null;
        return {
          stability: mean('stability'), difficulty: mean('difficulty'),
          retrievability: reviewed.length ? reviewed.reduce((sum, card) => sum + Number(scheduler.get_retrievability(card, now, false)), 0) / reviewed.length : null,
          due: cards.filter(card => getCard(data, card, now).due <= now).length,
          reviewed: reviewed.length
        };
      },
      isDue(card, now = new Date()) { return getCard(read(), card, now).due <= now; },
      snapshot() { return validateSnapshot(read()); },
      restore(snapshot) {
        const incoming = validateSnapshot(snapshot);
        const current = read();
        const cards = { ...current.cards };
        for (const [id, card] of Object.entries(incoming.cards)) {
          if (!cards[id] || Date.parse(card.last_review || card.due) >= Date.parse(cards[id].last_review || cards[id].due)) cards[id] = card;
        }
        storage.setItem(key, JSON.stringify({ version: 1, cards, reviews: [...current.reviews, ...incoming.reviews].slice(-2000) }));
      }
    };
  }
  return { create, grades, validateSnapshot };
});
