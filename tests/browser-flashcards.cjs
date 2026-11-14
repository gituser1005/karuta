/* Optional end-to-end checks: Node 22+, Chrome, local static server. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const base = process.env.KARUTA_TEST_URL || 'http://127.0.0.1:8082/karuta/';

(async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'karuta-flashcards-'));
  const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=0', '--user-data-dir=' + path.join(output, 'profile')],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let ws, log = '';
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
      browser.stderr.on('data', buffer => {
        log += buffer;
        const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      browser.once('error', reject);
    });
    ws = new WebSocket(endpoint);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let sequence = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const task = pending.get(message.id); pending.delete(message.id);
      if (message.error) task.reject(new Error(JSON.stringify(message.error)));
      else task.resolve(message.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(30); }
      throw new Error('Timed out: ' + expression);
    };
    const navigate = async file => {
      await call('Page.navigate', { url: base + file });
      await waitFor(`document.readyState==='complete' && location.pathname.endsWith(${JSON.stringify(file)})`);
    };
    const click = async selector => {
      const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const count = () => evaluate(`Object.values(JSON.parse(localStorage.getItem('karuta.learning.v1')||'{}').decks?.[KarutaDeck.id]||{}).reduce((n,r)=>n+(r.flashcard?.history.length||0),0)`);
    const drag = async (dx, dy, touch = false) => {
      const start = await evaluate(`(()=>{const e=document.getElementById('flip-card');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      if (touch) await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
      else await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 8; i++) {
        const point = { x: start.x + dx * i / 8, y: start.y + dy * i / 8 };
        if (touch) await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
        else await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'left', buttons: 1 });
      }
      const label = await evaluate(`document.getElementById('flash-card').dataset.direction||null`);
      if (touch) await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + dx, y: start.y + dy, button: 'left', clickCount: 1 });
      await sleep(300); return label;
    };
    const shot = async name => {
      await sleep(280);
      const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(image.data, 'base64'));
    };
    await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__speech=[];let active=null;
      Object.defineProperty(window,'speechSynthesis',{value:{speaking:false,pending:false,paused:false,
        cancel(){if(active){active=null;this.speaking=false;}},getVoices(){return[{lang:'ja-JP',default:true}]},resume(){this.paused=false},
        speak(u){window.__speech.push(u.text);active=u;this.speaking=true;u.onstart?.();setTimeout(()=>{if(active===u){active=null;this.speaking=false;u.onend?.()}},1500)}}});
      window.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};
    ` });
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await call('Emulation.setTouchEmulationEnabled', { enabled: true });
    await navigate('flashcards.html');
    await evaluate(`localStorage.removeItem('karuta.learning.v1')`);
    await navigate('flashcards.html');
    await waitFor(`document.getElementById('flash-progress').textContent==='1 / 20枚'`);
    assert.equal(await count(), 0);
    assert.equal(await evaluate(`document.querySelector('[data-rating]').disabled`), true);
    assert.equal(await evaluate(`window.__speech.length`), 0);
    await drag(-130, 0); assert.equal(await count(), 0);
    assert.equal(await evaluate(`document.getElementById('flash-card').classList.contains('flipped')`), false);
    await click('#flip-card');
    assert.equal(await evaluate(`document.getElementById('flash-card').classList.contains('flipped')`), true);
    await shot('mobile-answer');
    await click('#read-answer');
    assert.equal(await evaluate(`window.__speech.at(-1)`), 'キャンベラ');
    await click('#flip-card');
    assert.equal(await evaluate(`document.getElementById('flash-card').classList.contains('flipped')`), false);
    await click('#flip-card');
    await drag(-30, 0); assert.equal(await count(), 0);
    await drag(110, -110); assert.equal(await count(), 0);
    for (const [dx, dy, rating] of [[-140, 0, 'forgot'], [0, -140, 'hesitant'], [140, 0, 'remembered']]) {
      const label = await drag(dx, dy, true);
      assert.equal(label, rating);
      assert.equal(await count(), 1);
      assert.equal(await evaluate(`JSON.parse(localStorage.getItem('karuta.learning.v1')).decks[KarutaDeck.id]['capital-au'].flashcard.lastRating`), rating);
      assert.equal(await evaluate(`document.getElementById('flash-card').classList.contains('flipped')`), false);
      await click('#undo');
      assert.equal(await count(), 0);
      assert.equal(await evaluate(`document.getElementById('flash-progress').textContent`), '1 / 20枚');
      assert.equal(await evaluate(`document.getElementById('flash-card').classList.contains('flipped')`), true);
    }
    console.log('PASS: front guard, flip/back, manual audio, short/diagonal cancel, touch L/U/R labels, next front, exact undo.');
    await click('[data-rating="remembered"]'); await sleep(220);
    await navigate('flashcards.html');
    assert.equal(await evaluate(`document.getElementById('flash-progress').textContent`), '1 / 19枚');
    assert.equal(await evaluate(`document.getElementById('flash-question').textContent`), 'カナダの首都は');
    for (let i = 0; i < 19; i++) {
      await click('#flip-card'); await click('[data-rating="remembered"]'); await sleep(210);
    }
    assert.equal(await count(), 20);
    assert.equal(await evaluate(`document.getElementById('review-result').classList.contains('hidden')`), false);
    assert.equal(await evaluate(`document.getElementById('result-count').textContent`), '復習した枚数：19枚');
    await shot('mobile-result');
    await click('#undo'); assert.equal(await count(), 19);
    await click('[data-rating="remembered"]'); await sleep(220);
    await navigate('flashcards.html');
    assert.equal(await evaluate(`document.getElementById('result-title').textContent`), '今日の復習は完了しています');
    await navigate('capital-karuta.html');
    assert.equal(await evaluate(`document.getElementById('start').disabled`), true);
    assert.equal(await evaluate(`document.querySelectorAll('.tile').length`), 12);
    await click('#practice-all');
    assert.equal(await evaluate(`document.getElementById('start').disabled`), false);
    console.log('PASS: reload persistence, future exclusion, completion counts, final undo, zero candidates and all-practice escape.');
    // Due records, new cards and forgotten cards share one state without forcing a mode switch.
    await evaluate(`(()=>{const s=JSON.parse(localStorage.getItem('karuta.learning.v1')),d=s.decks[KarutaDeck.id];d['capital-au'].flashcard.nextReviewAt=Date.now()-1;localStorage.setItem('karuta.learning.v1',JSON.stringify(s));})()`);
    await navigate('flashcards.html');
    assert.equal(await evaluate(`document.getElementById('flash-progress').textContent`), '1 / 1枚');
    await call('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
    await call('Emulation.setTouchEmulationEnabled', { enabled: false });
    await click('#flip-card'); assert.equal(await drag(140, 0), 'remembered');
    assert.equal(await evaluate(`document.getElementById('review-result').classList.contains('hidden')`), false);
    console.log('PASS: due-date selection and PC mouse drag.');
    // Responsive screens, dark mode and reduced-motion behavior.
    await evaluate(`localStorage.removeItem('karuta.learning.v1')`);
    for (const [width, height, dark] of [[320, 740, false], [390, 844, true], [844, 390, false]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 550 });
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await navigate('flashcards.html'); await click('#flip-card');
      assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`), false);
      assert.ok(await evaluate(`Math.min(...[...document.querySelectorAll('[data-rating]')].map(e=>e.getBoundingClientRect().height))>=48`));
      await shot('layout-' + width + (dark ? '-dark' : ''));
    }
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'speechSynthesis',{value:undefined});window.SpeechSynthesisUtterance=undefined;` });
    await navigate('flashcards.html'); await click('#flip-card');
    assert.equal(await evaluate(`document.getElementById('read-answer').disabled`), true);
    await click('[data-rating="hesitant"]'); await sleep(100);
    assert.equal(await count(), 1);
    console.log('PASS: 320px, dark mode, landscape, reduced motion, unavailable speech still grades.');
    // Failed persistence must not advance or silently claim success.
    await evaluate(`localStorage.removeItem('karuta.learning.v1')`);
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError')};` });
    await navigate('flashcards.html'); await click('#flip-card'); await click('[data-rating="remembered"]');
    assert.equal(await count(),0);
    assert.equal(await evaluate(`document.getElementById('flash-progress').textContent`),'1 / 20枚');
    assert.match(await evaluate(`document.getElementById('flash-status').textContent`),/確定していません/);
    console.log('PASS: failed storage write keeps current card and does not record a rating.');
    console.log('Screenshots: ' + output);
    await send('Browser.close');
  } finally {
    ws?.close(); browser.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
