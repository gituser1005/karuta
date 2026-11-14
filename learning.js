/* Shared scheduling and storage. No DOM, game rules, or speech dependencies. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KarutaStudy = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  'use strict';
  const KEY = 'karuta.learning.v1';
  const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
  const RATINGS = ['forgot', 'hesitant', 'remembered'];
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const put = (object, key, value) => Object.defineProperty(object, key, {
    value, enumerable: true, configurable: true, writable: true
  });
  const empty = () => ({ version: 1, decks: {} });

  function schedule(previous, rating, now) {
    if (!RATINGS.includes(rating) || !Number.isFinite(now) || now < 0) throw new Error('評価が正しくありません。');
    const old = previous?.intervalMs || 0;
    const intervalMs = rating === 'forgot' ? 10 * 60 * 1000
      : rating === 'hesitant' ? Math.min(DAY, Math.max(HOUR, old / 2))
        : Math.min(365 * DAY, Math.max(DAY, old * 2));
    return { lastRating: rating, lastReviewedAt: now, nextReviewAt: now + intervalMs, intervalMs };
  }

  function dueQuestions(questions, getRecord, now, newLimit = 20) {
    const due = [], fresh = [];
    for (const question of questions) {
      const review = getRecord(question.id)?.flashcard;
      if (!review) fresh.push(question);
      else if (review.nextReviewAt <= now) due.push(question);
    }
    due.sort((a, b) => getRecord(a.id).flashcard.nextReviewAt - getRecord(b.id).flashcard.nextReviewAt);
    return due.concat(fresh.slice(0, newLimit));
  }

  function practicePriority(record, now) {
    const review = record?.flashcard;
    if (!review) return 0;
    if (review.lastRating === 'forgot') return 1;
    if (review.lastRating === 'hesitant') return 2;
    return review.nextReviewAt <= now ? 3 : Infinity;
  }

  function swipeRating(dx, dy, threshold = 75) {
    if (Math.abs(dx) >= threshold && Math.abs(dx) >= Math.abs(dy) * 1.35) return dx < 0 ? 'forgot' : 'remembered';
    if (-dy >= threshold && -dy >= Math.abs(dx) * 1.35) return 'hesitant';
    return null;
  }

  function validate(document) {
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const time = value => Number.isFinite(value) && value >= 0;
    if (!object(document) || document.version !== 1 || !object(document.decks)) throw new Error('保存形式が未対応です。');
    for (const deck of Object.values(document.decks)) {
      if (!object(deck)) throw new Error('問題集の記録が不正です。');
      for (const record of Object.values(deck)) {
        if (!object(record)) throw new Error('学習記録が不正です。');
        if (record.flashcard != null) {
          const f = record.flashcard;
          if (!object(f) || !RATINGS.includes(f.lastRating) || !time(f.lastReviewedAt)
            || !time(f.nextReviewAt) || !time(f.intervalMs) || !Array.isArray(f.history)
            || f.history.some(e => !object(e) || typeof e.id !== 'string' || !RATINGS.includes(e.rating)
              || !time(e.reviewedAt) || !time(e.nextReviewAt) || !time(e.intervalMs))) throw new Error('復習記録が不正です。');
        }
        if (record.karuta != null && (!object(record.karuta)
          || ['attempts', 'early', 'late', 'wrong', 'graduations'].some(key => !Number.isInteger(record.karuta[key]) || record.karuta[key] < 0)
          || !time(record.karuta.lastPlayedAt))) throw new Error('かるたの記録が不正です。');
      }
    }
    return document;
  }

  function createStore(deckId, options = {}) {
    let storage = options.storage, memory = empty(), notice = '', writable = true, serial = 0;
    const clock = options.now || Date.now;
    const instanceId = options.clientId || `${clientId}-${++storeSerial}`;
    if (typeof deckId !== 'string' || !deckId.trim()) throw new Error('問題集IDがありません。');
    if (!own(options, 'storage')) {
      try { storage = window.localStorage; } catch (_) { storage = null; }
    }
    if (storage && typeof location !== 'undefined' && location.protocol === 'file:') notice = '直接ファイルを開いた場合、画面間の履歴共有はブラウザーに依存します。共有にはHTTPサーバーか公開サイトを利用してください。';
    if (!storage) notice = 'この環境では履歴を保存できません。この画面を閉じると記録は失われます。';
    function load() {
      if (!storage || !writable) return clone(memory);
      try {
        const raw = storage.getItem(KEY);
        memory = raw === null ? empty() : validate(JSON.parse(raw));
      } catch (_) {
        writable = false;
        notice = '保存済みの履歴を読み込めません。元の記録は上書きせず、この画面内だけで練習します。';
        memory = empty();
      }
      return clone(memory);
    }
    function commit(document) {
      if (storage && writable) {
        try { storage.setItem(KEY, JSON.stringify(document)); }
        catch (_) { throw new Error('学習履歴を保存できません。空き容量やブラウザーの保存設定を確認してください。評価は確定していません。'); }
      }
      memory = document;
    }
    function deckOf(document) {
      if (!own(document.decks, deckId)) put(document.decks, deckId, {});
      return document.decks[deckId];
    }
    function recordOf(deck, id) {
      return own(deck, id) ? deck[id] : {};
    }
    load();
    return {
      get notice() { return notice; },
      get persistent() { return !!storage && writable; },
      get(id) { const document = load(); return clone(recordOf(deckOf(document), id)); },
      records() { return clone(deckOf(load())); },
      rate(id, rating, now = clock()) {
        const document = load(), deck = deckOf(document), record = recordOf(deck, id);
        const before = clone(record.flashcard || null);
        const update = schedule(before, rating, now);
        const eventId = `${now}-${++serial}-${instanceId}`;
        record.flashcard = { ...update, history: [...(before?.history || []), {
          id: eventId, rating, reviewedAt: now, nextReviewAt: update.nextReviewAt, intervalMs: update.intervalMs
        }] };
        put(deck, id, record); commit(document);
        return { questionId: id, eventId, before };
      },
      undo(token) {
        const document = load(), deck = deckOf(document), record = recordOf(deck, token.questionId);
        if (record.flashcard?.history.at(-1)?.id !== token.eventId) throw new Error('この問題は別の画面で更新されました。新しい評価を上書きしないため取り消せません。');
        if (token.before) record.flashcard = clone(token.before);
        else delete record.flashcard;
        if (Object.keys(record).length) put(deck, token.questionId, record);
        else delete deck[token.questionId];
        commit(document);
      },
      recordKaruta(id, result, now = clock()) {
        const document = load(), deck = deckOf(document), record = recordOf(deck, id);
        const old = record.karuta || { attempts: 0, early: 0, late: 0, wrong: 0, graduations: 0 };
        record.karuta = {
          attempts: old.attempts + 1, early: old.early + (result.success ? 1 : 0),
          late: old.late + (result.success ? 0 : 1), wrong: old.wrong + result.wrong,
          graduations: old.graduations + (result.graduation ? 1 : 0), lastPlayedAt: now
        };
        put(deck, id, record); commit(document);
      }
    };
  }

  // Does not consume Math.random(), preserving karuta's existing shuffle sequence.
  let storeSerial = 0;
  const clientId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${typeof performance !== 'undefined' ? performance.now() : 0}`;
  return { KEY, HOUR, DAY, RATINGS, schedule, dueQuestions, practicePriority, swipeRating, createStore };
});
