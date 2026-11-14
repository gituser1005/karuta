const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
// Published rules/audio as reference, with only the intentional 12-to-9 tile count change.
const baseline = execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`,
  'show', '326969f:capital-karuta.js'], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
// Change only the original slot allocation; leave rules, RNG and audio untouched.
const nineCardBaseline = baseline.replace('shuffled.slice(0,12)', 'shuffled.slice(0,9)').replace('waiting=shuffled.slice(12)', 'waiting=shuffled.slice(9)');
const current = read('capital-karuta.js');
const dataContext = { window: {} };
vm.runInNewContext(read('data/capitals.js'), dataContext);
const originalDeck = JSON.parse(JSON.stringify(dataContext.window.KarutaDeck));
const copy = value => JSON.parse(JSON.stringify(value));

class Element {
  constructor() {
    this.children = []; this.style = {}; this.handlers = {};
    this.textContent = ''; this.disabled = false; this.checked = false;
    this.classList = { add() {}, remove() {} };
  }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  replaceChildren(...items) { this.children = items; items.forEach(x => { x.parent = this; }); }
  appendChild(item) { this.children.push(item); item.parent = this; }
  replaceWith(item) {
    this.parent.children[this.parent.children.indexOf(this)] = item;
    item.parent = this.parent;
  }
}

function game(source, { deck = copy(originalDeck), audioSupport = true, seed = 12345, sharedRecords = null } = {}) {
  let now = 0, nextId = 0, speaking = null;
  const nodes = new Map(), timers = new Map(), audio = [], events = {}, documentEvents = {};
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  get('sound-off').checked = true;
  const schedule = (fn, delay, repeat = 0) => {
    const id = ++nextId; timers.set(id, { fn, at: now + delay, repeat }); return id;
  };
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => [{ lang: 'ja-JP', default: true }],
    resume() { this.paused = false; audio.push(['resume', now]); },
    cancel() {
      audio.push(['cancel', now]);
      if (speaking) {
        const old = speaking; speaking = null; this.speaking = false;
        old.onerror?.({ error: 'canceled' });
      }
    },
    speak(utterance) {
      audio.push(['speak', now, utterance.text, utterance.lang, utterance.rate, utterance.voice?.lang]);
      speaking = utterance; this.speaking = true;
      schedule(() => { if (speaking === utterance) utterance.onstart?.(); }, 5);
      schedule(() => {
        if (speaking !== utterance) return;
        speaking = null; this.speaking = false; utterance.onend?.();
      }, 200 + Array.from(utterance.text).length * 90);
    }
  };
  const window = { KarutaDeck: deck, addEventListener(name, fn) { events[name] = fn; } };
  if (audioSupport) {
    window.speechSynthesis = synth;
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  }
  const document = {
    hidden: false, getElementById: get, createElement: () => new Element(),
    addEventListener(name, fn) { documentEvents[name] = fn; }
  };
  const math = Object.create(Math);
  math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const context = {
    window, document, Math: math, performance: { now: () => now },
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay), clearInterval: id => timers.delete(id)
  };
  let sharedStore;
  if(sharedRecords!==null){
    const Study=require('../learning.js');
    const db={value:JSON.stringify({version:1,decks:{[deck.id]:sharedRecords}}),getItem(){return this.value},setItem(key,value){this.value=value}};
    sharedStore=Study.createStore(deck.id,{storage:db});
    window.KarutaStudy={...Study,createStore:()=>sharedStore};
  }
  // Inspection only; production exposes no mutable game state.
  const inspect = `globalThis.inspect={begin,init,pick,renderReading,
    get all(){return all},get slots(){return slots},get current(){return current},
    get waiting(){return waiting},get mode(){return mode},get turn(){return turn},
    get learning(){return typeof learningState==='undefined'?null:learningState}};`;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `${inspect}\n})();`), context);
  const api = context.inspect;
  const answer = item => item.data?.answer ?? item.capital;
  const state = item => item.state ?? item;
  return {
    api, get, audio, document, documentEvents, events, deck, sharedStore,
    tick(ms) {
      const until = now + ms;
      let count = 0;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        assert.ok(++count < 10000, 'timer loop');
        now = next[1].at;
        if (next[1].repeat) next[1].at += next[1].repeat;
        else timers.delete(next[0]);
        next[1].fn();
      }
      now = until;
    },
    sound(on) {
      get('sound-on').checked = on; get('sound-off').checked = !on;
      get(on ? 'sound-on' : 'sound-off').handlers.change();
    },
    choose(wrong = false) {
      const entry = api.slots.find(slot => wrong ? slot.item !== api.current : slot.item === api.current && !slot.dummy);
      assert.ok(entry); api.pick(entry, entry.button);
    },
    snapshot() {
      return copy({ mode: api.mode, turn: api.turn, current: api.current && answer(api.current),
        slots: api.slots.map(s => [answer(s.item), s.dummy, s.button.disabled]),
        waiting: api.waiting.map(answer),
        states: api.all.map(item => { const s = state(item); return [answer(item), s.streak, s.attempts, s.due, s.mastered]; }),
        text: [...nodes].filter(([id]) => !['finish-title','practice-all','learning-notice'].includes(id)).map(([id, el]) => [id, el.textContent, el.disabled, el.checked, el.style]),
        audio
      });
    }
  };
}

test('20 questions exactly match the published country/capital pairs and have stable IDs', () => {
  const pairs = vm.runInNewContext(baseline.match(/const raw=(\[[\s\S]*?\n\]);/)[1]);
  assert.deepEqual(originalDeck.questions.map(q => [q.question, q.answer]),
    copy(pairs).map(([country, answer]) => [country + 'の首都は', answer]));
  assert.equal(originalDeck.questions.length, 20);
  assert.equal(new Set(originalDeck.questions.map(q => q.id)).size, 20);
  assert.equal(originalDeck.questions[0].id, 'capital-au');
  const deck = copy(originalDeck); deck.questions.reverse();
  const g = game(current, { deck });
  for (const item of g.api.all) {
    assert.equal(item.id, originalDeck.questions.find(q => q.answer === item.data.answer).id);
    assert.equal(g.api.learning.get(item.id), item.state);
    assert.ok(Object.isFrozen(item.data));
  }
});

for (const audio of [false, true]) {
  test(`published behavior is unchanged through a full game (audio=${audio})`, () => {
    const old = game(nineCardBaseline), updated = game(current, { sharedRecords: {} });
    const equivalent = () => assert.deepEqual(updated.snapshot(), old.snapshot());
    // Map insertion order of mock nodes is irrelevant to rendered behavior.
    const normalize = g => { for (const id of ['start', 'reset', 'cards', 'mastered', 'clock', 'sentence', 'status']) g.get(id); };
    normalize(old); normalize(updated);
    if (audio) { old.sound(true); updated.sound(true); old.tick(1000); updated.tick(1000); }
    old.api.begin(); updated.api.begin(); equivalent();
    let questions = 0, sawDummy = false, sawReplacement = false;
    while (old.api.mode === 'reading' && questions < 1000) {
      assert.equal(updated.api.slots.length, 9);
      assert.equal(new Set(updated.api.slots.map(s => s.item.id)).size, 9);
      assert.deepEqual(updated.get('cards').children, Array.from(updated.api.slots, s => s.button));
      assert.ok(updated.api.slots.some(s => s.item === updated.api.current && !s.dummy));
      sawDummy ||= updated.api.slots.some(s => s.dummy);
      sawReplacement ||= updated.api.waiting.length < 11;
      if (questions % 7 === 1) { old.choose(true); updated.choose(true); equivalent(); }
      const delay = [0, 4999, 5000, 6500][questions % 4];
      old.tick(delay); updated.tick(delay); equivalent();
      old.choose(); updated.choose(); equivalent();
      for(let wait=0;old.api.mode==='answered'&&wait<200;wait++){
        old.tick(50); updated.tick(50); equivalent();
      }
      questions++;
    }
    assert.equal(updated.api.mode, 'finished');
    assert.ok(updated.api.all.every(item => item.state.mastered));
    assert.ok(sawDummy && sawReplacement);
    assert.deepEqual(updated.deck, originalDeck, 'gameplay must not write learning state into source data');
    updated.api.init(); old.api.init(); equivalent();
    assert.ok([...updated.api.learning.values()].every(s => s.attempts === 0 && !s.mastered));
  });
}

test('optional speech text is used without altering visible questions and answers', () => {
  const deck = copy(originalDeck);
  deck.questions.forEach(q => { q.speech = { question: '問題の読み', answer: '答えの読み' }; });
  const g = game(current, { deck }); g.sound(true); g.tick(1000); g.api.begin();
  assert.equal(g.audio.filter(a => a[0] === 'speak').at(-1)[2], '問題の読み');
  g.tick(5000);
  assert.equal(g.audio.filter(a => a[0] === 'speak').at(-1)[2], '答えの読み');
  assert.ok(g.get('sentence').textContent.startsWith(g.api.current.data.question));
  assert.equal(g.api.slots[0].button.textContent, g.api.slots[0].item.data.answer);
});

test('missing/invalid/duplicate data fail safely instead of starting an incomplete game', () => {
  const mutations = [() => null, d => ({ ...d, schemaVersion: 999 }),
    d => ({ ...d, questions: d.questions.slice(0, 9) }),
    d => { d.questions[1].id = d.questions[0].id; return d; },
    d => { d.questions[0].answer = ''; return d; },
    d => { d.questions[0].speech = { answer: '' }; return d; }];
  for (const mutate of mutations) {
    const g = game(current, { deck: mutate(copy(originalDeck)) });
    assert.equal(g.api.mode, 'error'); assert.equal(g.get('start').disabled, true);
    assert.equal(g.get('reset').disabled, true); assert.equal(g.get('cards').children.length, 0);
    assert.match(g.get('sentence').textContent, /読み込めません/);
  }
});

test('no audio support still allows normal play; reset cancels pending audio', () => {
  const g = game(current, { audioSupport: false });
  assert.equal(g.get('sound-on').disabled, true); g.api.begin(); g.choose(); g.tick(950);
  assert.equal(g.api.mode, 'reading');
  const audio = game(current); audio.sound(true); audio.api.begin(); audio.api.init();
  const count = audio.audio.filter(a => a[0] === 'speak').length;
  audio.tick(10000);
  assert.equal(audio.audio.filter(a => a[0] === 'speak').length, count);
  assert.equal(audio.api.mode, 'idle');
});


test('shared learning allows one active question with eight dummies and keeps graduation separate',()=>{
 const Study=require('../learning.js'),now=Date.now(),records={};
 for(const q of originalDeck.questions)records[q.id]={flashcard:{...Study.schedule(null,'remembered',now),history:[]}};
 records['capital-au'].flashcard={...Study.schedule(null,'forgot',now),history:[]};
 const g=game(current,{sharedRecords:records});
 assert.equal(g.api.slots.filter(s=>!s.dummy).length,1);assert.equal(g.api.slots.length,9);
 g.api.begin();g.choose();g.tick(950);g.choose();g.tick(950);
 assert.equal(g.api.mode,'finished');
 const saved=g.sharedStore.get('capital-au');assert.equal(saved.karuta.graduations,1);assert.equal(saved.flashcard.lastRating,'forgot');
 assert.equal(saved.flashcard.nextReviewAt,records['capital-au'].flashcard.nextReviewAt);
});
test('zero practice candidates offers an explicit all-question practice override',()=>{
 const Study=require('../learning.js'),records={};
 for(const q of originalDeck.questions)records[q.id]={flashcard:{...Study.schedule(null,'remembered',Date.now()),history:[]}};
 const g=game(current,{sharedRecords:records});assert.equal(g.api.mode,'complete');assert.equal(g.get('start').disabled,true);
 assert.equal(g.api.slots.length,9);assert.ok(g.api.slots.every(s=>s.dummy));
 g.get('practice-all').handlers.click();assert.equal(g.api.mode,'idle');assert.equal(g.api.slots.filter(s=>!s.dummy).length,9);assert.equal(g.api.waiting.length,11);
 g.api.begin();assert.equal(g.api.mode,'reading');
});

test('ten-question decks start with nine tiles and complete all ten; nine questions fail safely',()=>{
 for(const audio of [false,true]){
  const deck=copy(originalDeck);deck.questions=deck.questions.slice(0,10);
  const g=game(current,{deck,sharedRecords:{}});if(audio){g.sound(true);g.tick(1000)}g.api.begin();
  let turns=0;while(g.api.mode==='reading'&&turns<100){
   assert.equal(g.api.slots.length,9);assert.equal(new Set(g.api.slots.map(s=>s.item.id)).size,9);
   g.choose();while(g.api.mode==='answered')g.tick(50);turns++;
  }
  assert.equal(g.api.mode,'finished');assert.equal(turns,20);assert.ok(g.api.all.every(i=>i.state.mastered));
 }
 const short=copy(originalDeck);short.questions=short.questions.slice(0,9);assert.equal(game(current,{deck:short}).api.mode,'error');
});
