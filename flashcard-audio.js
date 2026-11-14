/* Manual answer playback. Karuta's existing timing/control remains untouched. */
window.KarutaAnswerAudio = (() => {
  'use strict';
  function create(onStatus) {
    const supported = !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';
    if (supported) { try { window.speechSynthesis.getVoices(); } catch (_) {} }
    let active = null, queued = null, watchdog = null, lastCancelAt = -Infinity;
    function stop() {
      clearTimeout(queued); clearTimeout(watchdog); queued = watchdog = null;
      const cancel = supported && (active || speechSynthesis.speaking || speechSynthesis.pending);
      active = null;
      if (cancel) { speechSynthesis.cancel(); lastCancelAt = performance.now(); }
    }
    function speak(question) {
      if (!supported || document.hidden) return;
      stop();
      try {
        const utterance = new SpeechSynthesisUtterance(question.speech?.answer ?? question.answer);
        utterance.lang = 'ja-JP'; utterance.rate = 1;
        const voices = speechSynthesis.getVoices();
        const japanese = voices.filter(v => /^ja(?:[-_]|$)/i.test(v.lang));
        const voice = japanese.find(v => v.default) || japanese[0] || voices.find(v => v.default);
        if (voice) utterance.voice = voice;
        active = utterance;
        utterance.onstart = () => { if (active === utterance) { clearTimeout(watchdog); onStatus('答えを読み上げています。'); } };
        utterance.onend = () => { if (active === utterance) { clearTimeout(watchdog); active = null; onStatus(''); } };
        utterance.onerror = () => {
          if (active !== utterance) return;
          stop(); onStatus('読み上げできませんでした。音量と日本語音声の設定を確認してください。評価はそのまま続けられます。');
        };
        const launch = () => {
          queued = null;
          if (active !== utterance || document.hidden) return;
          try {
            watchdog = setTimeout(() => {
              if (active === utterance) onStatus('発話の開始を確認できません。消音モード・音量を確認して再度ボタンを押してください。');
            }, 3000);
            if (speechSynthesis.paused) speechSynthesis.resume();
            speechSynthesis.speak(utterance);
          } catch (_) { stop(); onStatus('読み上げを開始できませんでした。'); }
        };
        const wait = Math.max(0, 80 - (performance.now() - lastCancelAt));
        if (wait) queued = setTimeout(launch, wait); else launch();
      } catch (_) { stop(); onStatus('読み上げを開始できませんでした。'); }
    }
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    return { supported, speak, stop };
  }
  return { create };
})();
