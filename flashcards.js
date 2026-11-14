(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const labels = { forgot: '忘れた', hesitant: '迷った', remembered: '覚えていた' };
  const ratingButtons = [...document.querySelectorAll('[data-rating]')];
  const card = $('flash-card'), flipButton = $('flip-card');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let store, questions = [], queue = [], index = 0, reviews = [], revealed = false, flipped = false;
  let busy = false, drag = null, suppressClick = false, animationTimer = null;
  const audio = window.KarutaAnswerAudio.create(message => { $('flash-status').textContent = message; });

  function resetPosition() {
    card.classList.remove('dragging');
    card.style.transform = ''; card.style.opacity = '';
    delete card.dataset.direction; $('drag-label').textContent = '';
  }
  function controls() {
    if (store?.notice) { $('storage-notice').textContent = store.notice; $('storage-notice').classList.remove('hidden'); }
    ratingButtons.forEach(button => { button.disabled = !revealed || busy || index >= queue.length; });
    $('undo').disabled = busy || reviews.length === 0;
    flipButton.disabled = busy;
    $('read-answer').hidden = !flipped || index >= queue.length;
    $('read-answer').disabled = !audio.supported || busy;
    $('swipe-help').textContent = revealed ? '← 忘れた　↑ 迷った　覚えていた →' : 'タップして答えを確認してください';
  }
  function result() {
    $('review-area').classList.add('hidden'); $('review-result').classList.remove('hidden');
    $('result-title').textContent = reviews.length ? '復習が終わりました' : '今日の復習は完了しています';
    $('result-count').textContent = `復習した枚数：${reviews.length}枚`;
    $('result-ratings').hidden = reviews.length === 0;
    for (const rating of Object.keys(labels)) $('count-' + rating).textContent = reviews.filter(r => r.rating === rating).length + '枚';
    const records = store.records(), now = Date.now();
    const remaining = window.KarutaStudy.dueQuestions(questions, id => records[id], now).length;
    const future = questions.map(q => records[q.id]?.flashcard?.nextReviewAt).filter(t => t > now);
    $('next-review').textContent = remaining ? `ほかに${remaining}枚の復習対象があります。`
      : future.length ? '次の復習：' + new Date(Math.min(...future)).toLocaleString('ja-JP') : '';
  }
  function render(restore = null) {
    card.classList.add('resetting');
    requestAnimationFrame(() => { card.classList.remove('resetting'); });
    audio.stop(); busy = false; drag = null; resetPosition();
    flipped = restore?.flipped ?? false; revealed = restore?.revealed ?? false;
    card.classList.toggle('flipped', flipped); card.classList.toggle('can-rate', revealed);
    $('flash-progress').textContent = `${Math.min(index + 1, queue.length)} / ${queue.length}枚`;
    $('flash-status').textContent = audio.supported ? '' : 'この環境では読み上げを利用できません。カードの復習は続けられます。';
    if (index >= queue.length) { controls(); result(); $('undo').focus(); return; }
    $('review-area').classList.remove('hidden'); $('review-result').classList.add('hidden');
    const question = queue[index];
    $('flash-question').textContent = question.question;
    $('flash-answer').textContent = question.answer;
    setFace(); controls();
  }
  function setFace() {
    card.classList.toggle('flipped', flipped);
    $('card-front').setAttribute('aria-hidden', String(flipped));
    $('card-back').setAttribute('aria-hidden', String(!flipped));
    flipButton.setAttribute('aria-pressed', String(flipped));
    flipButton.setAttribute('aria-label', (flipped ? queue[index].answer + '。タップで問題に戻る' : queue[index].question + '。タップで答えを確認'));
  }
  function startSession() {
    clearTimeout(animationTimer); audio.stop();
    const records = store.records();
    queue = window.KarutaStudy.dueQuestions(questions, id => records[id], Date.now(), 20);
    index = 0; reviews = []; render();
  }
  function rate(rating) {
    if (busy || !revealed || !queue[index]) return;
    let token;
    try { token = store.rate(queue[index].id, rating); }
    catch (error) { $('flash-status').textContent = error.message; resetPosition(); return; }
    audio.stop(); busy = true; drag = null;
    reviews.push({ token, index, rating, flipped }); controls();
    card.dataset.direction = rating; $('drag-label').textContent = labels[rating];
    const distance = Math.max(innerWidth, 600);
    card.style.transform = rating === 'hesitant' ? `translateY(-${distance}px)` : `translateX(${rating === 'forgot' ? -distance : distance}px) rotate(${rating === 'forgot' ? -18 : 18}deg)`;
    card.style.opacity = '0';
    animationTimer = setTimeout(() => { index++; render(); if (index < queue.length) flipButton.focus({ preventScroll: true }); }, reducedMotion.matches ? 0 : 180);
  }
  function undo() {
    if (busy || !reviews.length) return;
    const last = reviews.at(-1);
    try { store.undo(last.token); }
    catch (error) { $('flash-status').textContent = error.message; return; }
    reviews.pop(); index = last.index;
    render({ revealed: true, flipped: last.flipped });
    $('flash-status').textContent = '直前の評価と復習予定を取り消しました。再評価できます。';
    flipButton.focus({ preventScroll: true });
  }
  flipButton.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); suppressClick = false; return; }
    if (busy || !queue[index]) return;
    audio.stop(); flipped = !flipped; revealed = true;
    card.classList.add('can-rate'); setFace(); controls();
  });
  flipButton.addEventListener('pointerdown', event => {
    if (busy || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, moved: false, allowed: revealed };
    flipButton.setPointerCapture(event.pointerId);
  });
  flipButton.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.dx = event.clientX - drag.x; drag.dy = event.clientY - drag.y;
    if (Math.hypot(drag.dx, drag.dy) < 8 && !drag.moved) return;
    drag.moved = true;
    if (!drag.allowed) return;
    event.preventDefault(); card.classList.add('dragging');
    card.style.transform = `translate(${drag.dx}px,${drag.dy}px) rotate(${Math.max(-16, Math.min(16, drag.dx / 15))}deg)`;
    const direction = window.KarutaStudy.swipeRating(drag.dx, drag.dy, 18);
    if (direction) { card.dataset.direction = direction; $('drag-label').textContent = labels[direction]; }
    else { delete card.dataset.direction; $('drag-label').textContent = ''; }
  });
  function finishDrag(event, canceled = false) {
    if (!drag || drag.id !== event.pointerId) return;
    const ended = drag; drag = null;
    if (flipButton.hasPointerCapture(event.pointerId)) flipButton.releasePointerCapture(event.pointerId);
    if (ended.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 250); }
    const threshold = Math.max(65, Math.min(100, flipButton.clientWidth * .24));
    const rating = !canceled && ended.moved && ended.allowed ? window.KarutaStudy.swipeRating(ended.dx, ended.dy, threshold) : null;
    resetPosition(); if (rating) rate(rating);
  }
  flipButton.addEventListener('pointerup', finishDrag);
  flipButton.addEventListener('pointercancel', event => finishDrag(event, true));
  flipButton.addEventListener('lostpointercapture', event => { if (drag) finishDrag(event, true); });
  ratingButtons.forEach(button => button.addEventListener('click', () => rate(button.dataset.rating)));
  $('undo').addEventListener('click', undo);
  $('review-again').addEventListener('click', startSession);
  $('read-answer').addEventListener('click', () => { if (flipped && !busy && queue[index]) audio.speak(queue[index]); });
  window.addEventListener('pagehide', () => { audio.stop(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && drag) finishDrag({ pointerId: drag.id }, true);
  });
  try {
    const deck = window.KarutaDeck;
    if (!deck || deck.schemaVersion !== 1 || !deck.id || !Array.isArray(deck.questions)
      || deck.questions.some(q => !q || typeof q.id !== 'string' || !q.id.trim() || typeof q.question !== 'string' || !q.question.trim() || typeof q.answer !== 'string' || !q.answer.trim())
      || new Set(deck.questions.map(q => q.id)).size !== deck.questions.length) throw new Error('問題データを読み込めませんでした。');
    questions = deck.questions;
    store = window.KarutaStudy.createStore(deck.id);
    $('deck-title').textContent = deck.title || '学習';
    if (store.notice) { $('storage-notice').textContent = store.notice; $('storage-notice').classList.remove('hidden'); }
    startSession();
  } catch (error) {
    $('review-area').classList.add('hidden'); $('flash-status').textContent = error.message;
  }
})();
