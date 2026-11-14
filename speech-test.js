(() => {
  'use strict';

  const readButton = document.getElementById('read-sentence');
  const answerButton = document.getElementById('answer');
  const stopButton = document.getElementById('stop-speech');
  const status = document.getElementById('speech-status');

  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    readButton.disabled = true;
    answerButton.disabled = true;
    status.textContent = 'このブラウザーは音声読み上げに対応していません。Safariなどの対応ブラウザーでお試しください。';
    return;
  }

  const synth = window.speechSynthesis;
  // Keep the active utterance alive and ignore events from canceled speech.
  let activeUtterance = null;

  function stop() {
    activeUtterance = null;
    synth.cancel();
    stopButton.disabled = true;
  }

  function speak(text) {
    stop();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    // Query on each tap so voices loaded after the page opens are included.
    const japaneseVoice = synth.getVoices().find(voice => /^ja(?:[-_]|$)/i.test(voice.lang));
    if (japaneseVoice) utterance.voice = japaneseVoice;

    activeUtterance = utterance;
    stopButton.disabled = false;
    status.textContent = '読み上げを準備しています…';

    utterance.onstart = () => {
      if (activeUtterance === utterance) status.textContent = '読み上げ中：' + text;
    };
    utterance.onend = () => {
      if (activeUtterance !== utterance) return;
      activeUtterance = null;
      stopButton.disabled = true;
      status.textContent = '読み上げが終わりました。何度でも試せます。';
    };
    utterance.onerror = event => {
      if (activeUtterance !== utterance) return;
      activeUtterance = null;
      stopButton.disabled = true;
      status.textContent = event.error === 'not-allowed'
        ? '読み上げが許可されませんでした。もう一度ボタンをタップしてください。'
        : '読み上げできませんでした。端末の日本語音声の設定を確認し、もう一度お試しください。';
    };

    try {
      // Call directly from the tap handler, without timers or automatic playback.
      synth.speak(utterance);
    } catch (error) {
      stop();
      status.textContent = '読み上げを開始できませんでした。もう一度お試しください。';
    }
  }

  readButton.addEventListener('click', () => {
    speak(document.getElementById('test-sentence').textContent.trim());
  });
  answerButton.addEventListener('click', () => speak('キャンベラ'));
  stopButton.addEventListener('click', () => {
    stop();
    status.textContent = '読み上げを停止しました。';
  });
  window.addEventListener('pagehide', stop);
})();
