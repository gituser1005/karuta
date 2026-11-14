(()=>{'use strict';
const $=id=>document.getElementById(id);
const raw=[
 ['オーストラリア','キャンベラ'],['カナダ','オタワ'],
 ['ブラジル','ブラジリア'],['トルコ','アンカラ'],
 ['モロッコ','ラバト'],['エジプト','カイロ'],
 ['ケニア','ナイロビ'],['タイ','バンコク'],
 ['ベトナム','ハノイ'],['韓国','ソウル'],
 ['アルゼンチン','ブエノスアイレス'],
 ['ニュージーランド','ウェリントン'],
 ['フランス','パリ'],['イタリア','ローマ'],
 ['ドイツ','ベルリン'],['スペイン','マドリード'],
 ['インド','ニューデリー'],['フィリピン','マニラ'],
 ['ノルウェー','オスロ'],['メキシコ','メキシコシティ']
];
const shuffle=arr=>{const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
let all=[],waiting=[],slots=[],current=null,mode='idle';
const speed=400;
let turn=0,mastered=0,early=0,late=0,wrong=0,wrongThis=0;
let previousId=-1,startedAt=0,readTimer=null,advanceTimer=null,feedbackTimers=[];
const speechSupported='speechSynthesis' in window&&'SpeechSynthesisUtterance' in window;
let soundEnabled=false,activeSpeech=null,capitalAnnounced=false;
let speechQueueTimer=null,speechStartTimer=null,lastSpeechCancelAt=-Infinity;
const soundHelp='音あり：国名、5秒後の首都名、選んだ札を読み上げます。';
function clearSpeechStartTimer(){
  if(speechStartTimer!==null)clearTimeout(speechStartTimer);
  speechStartTimer=null;
}
function stopSpeech(){
  if(speechQueueTimer!==null)clearTimeout(speechQueueTimer);
  speechQueueTimer=null;
  clearSpeechStartTimer();
  const needsCancel=speechSupported&&(activeSpeech!==null||window.speechSynthesis.speaking||window.speechSynthesis.pending);
  activeSpeech=null;
  // Safari can discard the next utterance after cancel(); never cancel an idle engine.
  if(needsCancel){
    window.speechSynthesis.cancel();
    lastSpeechCancelAt=performance.now();
  }
}
function audioFailed(code){
  soundEnabled=false;
  stopSpeech();
  $('sound-off').checked=true;
  $('sound-on').checked=false;
  $('sound-status').textContent=code==='not-allowed'
    ? '読み上げが許可されませんでした。「音あり」をもう一度タップしてください。'
    : '読み上げできませんでした。音なしで続けます。日本語音声の設定を確認して再度「音あり」を選んでください。'+(code?'（'+code+'）':'');
}
function speak(text){
  if(!soundEnabled||!speechSupported||document.hidden)return;
  stopSpeech();
  try{
    const synth=window.speechSynthesis;
    const utterance=new window.SpeechSynthesisUtterance(text);
    utterance.lang='ja-JP';
    utterance.rate=1;
    const voices=synth.getVoices();
    const japanese=voices.filter(x=>/^ja(?:[-_]|$)/i.test(x.lang));
    const voice=japanese.find(x=>x.default)||japanese[0]||voices.find(x=>x.default);
    if(voice)utterance.voice=voice;
    activeSpeech=utterance;
    utterance.onstart=()=>{
      if(activeSpeech!==utterance)return;
      clearSpeechStartTimer();
      $('sound-status').textContent=soundHelp;
    };
    utterance.onend=()=>{
      if(activeSpeech!==utterance)return;
      clearSpeechStartTimer();
      activeSpeech=null;
    };
    utterance.onerror=event=>{if(activeSpeech===utterance)audioFailed(event.error)};
    const launch=()=>{
      speechQueueTimer=null;
      if(activeSpeech!==utterance||!soundEnabled||document.hidden)return;
      try{
        speechStartTimer=setTimeout(()=>{
          speechStartTimer=null;
          if(activeSpeech===utterance)$('sound-status').textContent='読み上げの開始を確認できません。消音モード・音量を確認し、「音なし」→「音あり」で試してください。';
        },3000);
        if(synth.paused)synth.resume();
        synth.speak(utterance);
      }catch(error){audioFailed(error.name)}
    };
    // First speech stays inside the tap handler. Only replacement speech is delayed.
    const wait=Math.max(0,80-(performance.now()-lastSpeechCancelAt));
    if(wait>0)speechQueueTimer=setTimeout(launch,wait);
    else launch();
  }catch(error){audioFailed(error.name)}
}
function configureSound(){
  if(speechSupported)window.speechSynthesis.getVoices();
  if(!speechSupported){
    $('sound-on').disabled=true;
    $('sound-status').textContent='このブラウザーは読み上げに対応していないため、音なしで遊べます。';
  }
  $('sound-on').addEventListener('change',()=>{
    if(!$('sound-on').checked||!speechSupported)return;
    soundEnabled=true;
    $('sound-status').textContent=soundHelp;
    if(mode==='reading'){
      const revealed=performance.now()-startedAt>=5000;
      capitalAnnounced=revealed;
      speak(revealed?current.capital:current.country+'の首都は');
    }else speak('音あり');
  });
  $('sound-off').addEventListener('change',()=>{
    if(!$('sound-off').checked)return;
    soundEnabled=false;
    stopSpeech();
    $('sound-status').textContent='音なしで遊びます。';
  });
  window.addEventListener('pagehide',stopSpeech);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopSpeech()});
}
function clearTimers(){stopSpeech();if(readTimer!==null)clearInterval(readTimer);if(advanceTimer!==null)clearTimeout(advanceTimer);feedbackTimers.forEach(clearTimeout);feedbackTimers=[];readTimer=null;advanceTimer=null}
function newItem(pair,id){return{id,country:pair[0],capital:pair[1],streak:0,attempts:0,due:0,mastered:false}}
function stats(){$('turn').textContent='第'+(turn+1)+'問';$('mastered').textContent=mastered+' / '+all.length;$('progress').style.width=(100*mastered/all.length)+'%';$('early').textContent=early;$('late').textContent=late;$('wrong').textContent=wrong}
function makeTile(entry){const b=document.createElement('button');b.type='button';b.className='tile';b.textContent=entry.item.capital;b.disabled=mode!=='reading';b.addEventListener('click',()=>pick(entry,b));entry.button=b;return b}
function init(){clearTimers();all=raw.map(newItem);const shuffled=shuffle(all);slots=shuffled.slice(0,12).map(item=>({item,dummy:false,button:null}));waiting=shuffled.slice(12);mode='idle';current=null;turn=mastered=early=late=wrong=0;previousId=-1;$('play').classList.remove('hidden');$('finish').classList.add('hidden');$('sentence').textContent='準備ができたらスタート！';$('status').textContent='2回連続で先取りすると卒業';$('clock').textContent='開始前';$('timefill').style.width='0%';$('start').textContent='スタート';$('start').disabled=false;$('cards').replaceChildren();slots.forEach(entry=>$('cards').appendChild(makeTile(entry)));stats()}
function shuffleCards(){
  const previous=slots;
  slots=shuffle(slots);
  // Ensure the layout changes even if the random shuffle returns the same order.
  if(slots.length>1&&slots.every((entry,index)=>entry===previous[index])){
    [slots[0],slots[1]]=[slots[1],slots[0]];
  }
  $('cards').replaceChildren(...slots.map(entry=>entry.button));
}
function chooseQuestion(){const candidates=slots.filter(s=>!s.dummy).map(s=>s.item);if(!candidates.length)return null;let eligible=candidates.filter(x=>x.due<=turn);if(!eligible.length){const soonest=Math.min(...candidates.map(x=>x.due));eligible=candidates.filter(x=>x.due===soonest)}const others=eligible.filter(x=>x.id!==previousId);if(others.length)eligible=others;const seen=eligible.filter(x=>x.attempts>0),fresh=eligible.filter(x=>x.attempts===0);if(seen.length&&fresh.length)eligible=Math.random()<.7?seen:fresh;return shuffle(eligible)[0]}
function sentence(x){return x.country+'の首都は'+x.capital+'。'}
function renderReading(){if(mode!=='reading')return;const elapsed=performance.now()-startedAt;const prefix=Array.from(current.country+'の首都は');const suffix=Array.from(current.capital+'。');const prefixInterval=Math.min(speed,4700/prefix.length);let out='';if(elapsed<5000){const n=Math.min(prefix.length,Math.floor(elapsed/prefixInterval)+1);out=prefix.slice(0,n).join('');if(n===prefix.length)out+='……';$('clock').textContent=((5000-elapsed)/1000).toFixed(1)+'秒';$('timefill').style.width=(100*elapsed/5000)+'%'}else{if(!capitalAnnounced){capitalAnnounced=true;speak(current.capital)}const n=Math.min(suffix.length,Math.floor((elapsed-5000)/speed)+1);out=prefix.join('')+suffix.slice(0,n).join('');$('timefill').style.width='100%';$('clock').textContent=n===suffix.length?'読了':'答え表示中';if(n===suffix.length){clearInterval(readTimer);readTimer=null;$('status').textContent='首都名が表示されました。札を探そう！'}}$('sentence').textContent=out}
function begin(){clearTimers();if(mastered===all.length){finish();return}current=chooseQuestion();if(!current){finish();return}mode='reading';wrongThis=0;capitalAnnounced=false;$('sentence').textContent='▍';$('clock').textContent='5.0秒';$('timefill').style.width='0%';$('status').textContent=current.attempts>0?'復習問題。先取りできるかな？':'わかったら札をタップ！';$('start').disabled=true;$('start').textContent='進行中';shuffleCards();slots.forEach(s=>{s.button.disabled=false;s.button.classList.remove('bad','good','bye')});stats();startedAt=performance.now();renderReading();readTimer=setInterval(renderReading,40);speak(current.country+'の首都は')}
function replaceGraduated(item){const pos=slots.findIndex(s=>s.item===item&&!s.dummy);if(pos<0)return;const old=slots[pos];let replacement;if(waiting.length){replacement={item:waiting.shift(),dummy:false,button:null}}else{const visibleIds=new Set(slots.filter((s,i)=>i!==pos).map(s=>s.item.id));const options=all.filter(x=>x.mastered&&!visibleIds.has(x.id));const dummy=shuffle(options)[0]||item;replacement={item:dummy,dummy:true,button:null}}slots[pos]=replacement;old.button.replaceWith(makeTile(replacement))}
function pick(entry,b){if(mode!=='reading'||b.disabled)return;if(entry.item!==current||entry.dummy){speak(entry.item.capital);wrong++;wrongThis++;stats();b.classList.add('bad');const task=setTimeout(()=>b.classList.remove('bad'),350);feedbackTimers.push(task);$('status').textContent='お手つき！ 別の札を探そう';return}const success=performance.now()-startedAt<5000&&wrongThis===0;clearTimers();mode='answered';speak(current.capital);current.attempts++;if(success){early++;current.streak++}else{late++;current.streak=0}slots.forEach(s=>s.button.disabled=true);b.classList.add('good');$('sentence').textContent=sentence(current);$('clock').textContent=success?'先取り成功':'正解';$('timefill').style.width='100%';const graduation=current.streak>=2;if(graduation){current.mastered=true;mastered++;b.classList.add('bye');$('status').textContent='🎉 2回連続先取り！ この首都は卒業！'}else if(success){$('status').textContent='★ 先取り成功！ あと1回で卒業'}else{$('status').textContent='答えを確認。数問後に復習しよう'}const finishedItem=current;previousId=finishedItem.id;turn++;if(!graduation)finishedItem.due=turn+2+Math.floor(Math.random()*3);stats();const answeredAt=performance.now();const advance=()=>{if(soundEnabled&&activeSpeech&&performance.now()-answeredAt<6000){advanceTimer=setTimeout(advance,100);return}if(graduation)replaceGraduated(finishedItem);if(mastered===all.length)finish();else begin()};advanceTimer=setTimeout(advance,950)}
function finish(){clearTimers();mode='finished';$('play').classList.add('hidden');$('finish').classList.remove('hidden');$('progress').style.width='100%';$('mastered').textContent=all.length+' / '+all.length;$('summary').innerHTML='出題数：<strong>'+turn+'問</strong><br>先取り成功：<strong>'+early+'回</strong><br>先取り失敗：<strong>'+late+'回</strong><br>お手つき：<strong>'+wrong+'回</strong>'}
$('start').addEventListener('click',()=>{if(mode==='idle')begin()});$('reset').addEventListener('click',init);$('again').addEventListener('click',init);configureSound();init();
})();
