const { test } = require('node:test');
const assert = require('node:assert/strict');
const Study = require('../learning.js');
const NOW = Date.UTC(2026, 10, 14, 0, 0);
function storage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map };
}
const questions = Array.from({ length: 30 }, (_, i) => ({ id: 'q' + i, question: 'question' + i, answer: 'answer' + i }));

test('simple scheduler has explicit, independent intervals and grows remembered reviews', () => {
  const first = Study.schedule(null, 'remembered', NOW);
  assert.equal(first.intervalMs, Study.DAY);
  assert.equal(Study.schedule(first, 'remembered', NOW).intervalMs, Study.DAY * 2);
  assert.equal(Study.schedule(first, 'hesitant', NOW).intervalMs, Study.DAY / 2);
  assert.equal(Study.schedule(null, 'hesitant', NOW).intervalMs, Study.HOUR);
  assert.equal(Study.schedule(first, 'forgot', NOW).intervalMs, 600000);
  assert.equal(Study.schedule({ intervalMs: Study.DAY * 500 }, 'remembered', NOW).intervalMs, Study.DAY * 365);
  assert.throws(() => Study.schedule(null, 'typo', NOW));
});

test('review selection excludes future cards, sorts due cards, caps only new cards at 20', () => {
  const records = {
    q0: { flashcard: Study.schedule(null, 'remembered', NOW) },
    q1: { flashcard: { nextReviewAt: NOW } },
    q2: { flashcard: { nextReviewAt: NOW - 100 } }
  };
  const result = Study.dueQuestions(questions, id => records[id], NOW);
  assert.equal(result.length, 22);
  assert.deepEqual(result.slice(0, 2).map(q => q.id), ['q2', 'q1']);
  assert.ok(!result.some(q => q.id === 'q0'));
  assert.equal(Study.dueQuestions(questions.slice(0, 1), id => records[id], NOW).length, 0);
});

test('ratings, history, time and interval survive store recreation; undo restores exact prior review', () => {
  const db = storage(), store = Study.createStore('deck', { storage: db });
  const first = store.rate('q', 'remembered', NOW);
  const before = store.get('q');
  const second = store.rate('q', 'hesitant', NOW + Study.DAY);
  const reloaded = Study.createStore('deck', { storage: db });
  assert.equal(reloaded.get('q').flashcard.lastRating, 'hesitant');
  assert.equal(reloaded.get('q').flashcard.history.length, 2);
  reloaded.undo(second);
  assert.deepEqual(reloaded.get('q'), before);
  reloaded.undo(first);
  assert.deepEqual(reloaded.get('q'), {});
  assert.deepEqual(JSON.parse(db.getItem(Study.KEY)).decks.deck, {});
});

test('karuta has its own statistics and does not change long-term schedules, including undo', () => {
  const db = storage(), store = Study.createStore('deck', { storage: db });
  const token = store.rate('q', 'forgot', NOW);
  const review = store.get('q').flashcard;
  store.recordKaruta('q', { success: true, wrong: 0, graduation: true }, NOW + 1);
  assert.deepEqual(store.get('q').flashcard, review);
  assert.equal(store.get('q').karuta.graduations, 1);
  store.undo(token);
  assert.equal(store.get('q').flashcard, undefined);
  assert.equal(store.get('q').karuta.graduations, 1);
});

test('undo refuses to overwrite a later rating from another tab', () => {
  const db = storage(), a = Study.createStore('deck', { storage: db, clientId: 'a' });
  const b = Study.createStore('deck', { storage: db, clientId: 'b' });
  const old = a.rate('q', 'forgot', NOW);
  b.rate('q', 'remembered', NOW + 1);
  assert.throws(() => a.undo(old), /別の画面/);
  assert.equal(a.get('q').flashcard.lastRating, 'remembered');
});

test('future remembered cards are dummy-only by default; weak and unseen cards remain candidates', () => {
  const future = Study.schedule(null, 'remembered', NOW);
  assert.equal(Study.practicePriority({ flashcard: future }, NOW), Infinity);
  assert.equal(Study.practicePriority({ flashcard: future }, future.nextReviewAt), 3);
  assert.equal(Study.practicePriority({}, NOW), 0);
  assert.equal(Study.practicePriority({ flashcard: Study.schedule(null, 'forgot', NOW) }, NOW), 1);
  assert.equal(Study.practicePriority({ flashcard: Study.schedule(null, 'hesitant', NOW) }, NOW), 2);
});

test('swipe direction is the same for labels and commits; diagonal, downward and short gestures cancel', () => {
  for (const [x, y, result] of [[-120, 10, 'forgot'], [120, -10, 'remembered'], [10, -120, 'hesitant'], [120, -120, null], [0, 120, null], [30, 0, null]]) {
    assert.equal(Study.swipeRating(x, y, 75), result);
    if (result) assert.equal(Study.swipeRating(x, y, 18), result);
  }
});

test('corrupt or unknown-version data is retained without overwrite; unavailable storage is explicit', () => {
  for (const value of ['broken json', JSON.stringify({ version: 999, decks: {} })]) {
    const db = storage(); db.setItem(Study.KEY, value);
    const store = Study.createStore('deck', { storage: db });
    assert.equal(store.persistent, false); assert.match(store.notice, /上書きせず/);
    store.rate('q', 'forgot', NOW);
    assert.equal(db.getItem(Study.KEY), value);
  }
  const transient = Study.createStore('deck', { storage: null });
  assert.match(transient.notice, /失われます/);
  transient.rate('q', 'forgot', NOW); assert.equal(transient.get('q').flashcard.lastRating, 'forgot');
});

test('failed writes do not commit a rating; deck and question IDs remain separate', () => {
  const db = storage(), a = Study.createStore('a', { storage: db }), b = Study.createStore('b', { storage: db });
  a.rate('same-id', 'forgot', NOW); assert.deepEqual(b.get('same-id'), {});
  const stored = db.getItem(Study.KEY); db.setItem = () => { throw new Error('quota'); };
  assert.throws(() => a.rate('same-id', 'remembered', NOW), /確定していません/);
  assert.equal(db.getItem(Study.KEY), stored);
  assert.equal(a.get('same-id').flashcard.lastRating, 'forgot');
});
