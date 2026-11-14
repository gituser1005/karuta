(()=>{'use strict';
const $=id=>document.getElementById(id);
let questions=[];
// Session-only learning state is separate from the immutable question definitions.
const learningState=new Map();
let sharedStore=null,practiceIds=new Set(),targetCount=0,practiceAll=false;
function readQuestions(deck){
  if(!deck||deck.schemaVersion!==1||typeof deck.id!=='string'||!deck.id.trim()||!Array.isArray(deck.questions)){
    throw new Error('問題データの形式が正しくありません。');
  }
  if(deck.questions.length<12)throw new Error('12枚の札を表示するには12問以上必要です。');
  const ids=new Set();
  const nonempty=value=>typeof value==='string'&&value.trim().length>0;
  return Object.freeze(deck.questions.map(question=>{
    if(!question||!nonempty(question.id)||question.id!==question.id.trim()||ids.has(question.id)||!nonempty(question.question)||!nonempty(question.answer)){
      throw new Error('問題IDの重複、または問題・答えの不足があります。');
    }
    ids.add(question.id);
    const result={id:question.id,question:question.question,answer:question.answer};
    if(question.speech!==undefined){
      if(!question.speech||typeof question.speech!=='object'||Array.isArray(question.speech))throw new Error('読み上げ情報の形式が正しくありません。');
      const speech={};
      for(const key of ['question','answer']){
        if(question.speech[key]!==undefined){
          if(!nonempty(question.speech[key]))throw new Error('読み上げテキストが空です。');
          speech[key]=question.speech[key];
        }
      }
      result.speech=Object.freeze(speech);
    }
    return Object.freeze(result);
  }));
}
function spokenQuestion(item){return item.data.speech?.question??item.data.question}
function spokenAnswer(item){return item.data.speech?.answer??item.data.answer}
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
      speak(revealed?spokenAnswer(current):spokenQuestion(current));
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
function newItem(question){
  const state={streak:0,attempts:0,due:0,mastered:false};
  learningState.set(question.id,state);
  return{id:question.id,data:question,state};
}
function stats(){$('turn').textContent='第'+(turn+1)+'問';$('mastered').textContent=mastered+' / '+targetCount;$('progress').style.width=(targetCount?100*mastered/targetCount:100)+'%';$('early').textContent=early;$('late').textContent=late;$('wrong').textContent=wrong}
function makeTile(entry){const b=document.createElement('button');b.type='button';b.className='tile';b.textContent=entry.item.data.answer;b.disabled=mode!=='reading';b.addEventListener('click',()=>pick(entry,b));entry.button=b;return b}
function init(){
  clearTimers();learningState.clear();all=questions.map(newItem);
  const shuffled=shuffle(all);
  const records=sharedStore?sharedStore.records():{};
  const practiceNow=Date.now();
  const rank=item=>practiceAll||!sharedStore?0:window.KarutaStudy.practicePriority(records[item.id],practiceNow);
  const candidates=shuffled.filter(item=>rank(item)!==Infinity).sort((a,b)=>rank(a)-rank(b));
  practiceIds=new Set(candidates.map(item=>item.id));targetCount=candidates.length;
  slots=candidates.slice(0,12).map(item=>({item,dummy:false,button:null}));
  if(slots.length<12){
    const visible=new Set(slots.map(s=>s.item.id));
    for(const item of shuffled){
      if(slots.length===12)break;
      if(!visible.has(item.id)){slots.push({item,dummy:true,button:null});visible.add(item.id)}
    }
  }
  waiting=candidates.slice(12);mode='idle';current=null;turn=mastered=early=late=wrong=0;previousId=-1;
  $('play').classList.remove('hidden');$('finish').classList.add('hidden');
  $('sentence').textContent='準備ができたらスタート！';$('status').textContent='2回連続で先取りすると卒業';
  $('clock').textContent='開始前';$('timefill').style.width='0%';$('start').textContent='スタート';$('start').disabled=false;
  $('cards').replaceChildren();slots.forEach(entry=>$('cards').appendChild(makeTile(entry)));stats();
  if(sharedStore){
    $('finish-title').textContent=targetCount===questions.length?'全'+targetCount+'か国を卒業！':'練習候補'+targetCount+'問を卒業！';
    if(targetCount<questions.length)$('practice-all').classList.remove('hidden');else $('practice-all').classList.add('hidden');
    if(sharedStore.notice){$('learning-notice').textContent=sharedStore.notice;$('learning-notice').classList.remove('hidden')}
  }
  if(!targetCount){
    mode='complete';$('start').disabled=true;
    slots.forEach(s=>s.button.disabled=true);
    $('sentence').textContent='今の練習候補はありません';
    $('status').textContent='暗記カードの復習予定はまだ先です。「全問で練習する」で自由に練習できます。';
  }
}
function shuffleCards(){
  const previous=slots;
  slots=shuffle(slots);
  // Ensure the layout changes even if the random shuffle returns the same order.
  if(slots.length>1&&slots.every((entry,index)=>entry===previous[index])){
    [slots[0],slots[1]]=[slots[1],slots[0]];
  }
  $('cards').replaceChildren(...slots.map(entry=>entry.button));
}
function chooseQuestion(){const candidates=slots.filter(s=>!s.dummy).map(s=>s.item);if(!candidates.length)return null;let eligible=candidates.filter(x=>x.state.due<=turn);if(!eligible.length){const soonest=Math.min(...candidates.map(x=>x.state.due));eligible=candidates.filter(x=>x.state.due===soonest)}const others=eligible.filter(x=>x.id!==previousId);if(others.length)eligible=others;const seen=eligible.filter(x=>x.state.attempts>0),fresh=eligible.filter(x=>x.state.attempts===0);if(seen.length&&fresh.length)eligible=Math.random()<.7?seen:fresh;return shuffle(eligible)[0]}
function sentence(x){return x.data.question+x.data.answer+'。'}
function renderReading(){if(mode!=='reading')return;const elapsed=performance.now()-startedAt;const prefix=Array.from(current.data.question);const suffix=Array.from(current.data.answer+'。');const prefixInterval=Math.min(speed,4700/prefix.length);let out='';if(elapsed<5000){const n=Math.min(prefix.length,Math.floor(elapsed/prefixInterval)+1);out=prefix.slice(0,n).join('');if(n===prefix.length)out+='……';$('clock').textContent=((5000-elapsed)/1000).toFixed(1)+'秒';$('timefill').style.width=(100*elapsed/5000)+'%'}else{if(!capitalAnnounced){capitalAnnounced=true;speak(spokenAnswer(current))}const n=Math.min(suffix.length,Math.floor((elapsed-5000)/speed)+1);out=prefix.join('')+suffix.slice(0,n).join('');$('timefill').style.width='100%';$('clock').textContent=n===suffix.length?'読了':'答え表示中';if(n===suffix.length){clearInterval(readTimer);readTimer=null;$('status').textContent='首都名が表示されました。札を探そう！'}}$('sentence').textContent=out}
function begin(){clearTimers();if(mastered===targetCount){finish();return}current=chooseQuestion();if(!current){finish();return}mode='reading';wrongThis=0;capitalAnnounced=false;$('sentence').textContent='▍';$('clock').textContent='5.0秒';$('timefill').style.width='0%';$('status').textContent=current.state.attempts>0?'復習問題。先取りできるかな？':'わかったら札をタップ！';$('start').disabled=true;$('start').textContent='進行中';shuffleCards();slots.forEach(s=>{s.button.disabled=false;s.button.classList.remove('bad','good','bye')});stats();startedAt=performance.now();renderReading();readTimer=setInterval(renderReading,40);speak(spokenQuestion(current))}
function replaceGraduated(item){const pos=slots.findIndex(s=>s.item===item&&!s.dummy);if(pos<0)return;const old=slots[pos];let replacement;if(waiting.length){replacement={item:waiting.shift(),dummy:false,button:null}}else{const visibleIds=new Set(slots.filter((s,i)=>i!==pos).map(s=>s.item.id));const options=all.filter(x=>(x.state.mastered||!practiceIds.has(x.id))&&!visibleIds.has(x.id));const dummy=shuffle(options)[0]||item;replacement={item:dummy,dummy:true,button:null}}slots[pos]=replacement;old.button.replaceWith(makeTile(replacement))}
function pick(entry,b){if(mode!=='reading'||b.disabled)return;if(entry.item!==current||entry.dummy){speak(spokenAnswer(entry.item));wrong++;wrongThis++;stats();b.classList.add('bad');const task=setTimeout(()=>b.classList.remove('bad'),350);feedbackTimers.push(task);$('status').textContent='お手つき！ 別の札を探そう';return}const success=performance.now()-startedAt<5000&&wrongThis===0;clearTimers();mode='answered';speak(spokenAnswer(current));current.state.attempts++;if(success){early++;current.state.streak++}else{late++;current.state.streak=0}slots.forEach(s=>s.button.disabled=true);b.classList.add('good');$('sentence').textContent=sentence(current);$('clock').textContent=success?'先取り成功':'正解';$('timefill').style.width='100%';const graduation=current.state.streak>=2;if(sharedStore){try{sharedStore.recordKaruta(current.id,{success,wrong:wrongThis,graduation})}catch(error){$('learning-notice').textContent=error.message;$('learning-notice').classList.remove('hidden')}}if(graduation){current.state.mastered=true;mastered++;b.classList.add('bye');$('status').textContent='🎉 2回連続先取り！ この首都は卒業！'}else if(success){$('status').textContent='★ 先取り成功！ あと1回で卒業'}else{$('status').textContent='答えを確認。数問後に復習しよう'}const finishedItem=current;previousId=finishedItem.id;turn++;if(!graduation)finishedItem.state.due=turn+2+Math.floor(Math.random()*3);stats();const answeredAt=performance.now();const advance=()=>{if(soundEnabled&&activeSpeech&&performance.now()-answeredAt<6000){advanceTimer=setTimeout(advance,100);return}if(graduation)replaceGraduated(finishedItem);if(mastered===targetCount)finish();else begin()};advanceTimer=setTimeout(advance,950)}
function finish(){clearTimers();mode='finished';$('play').classList.add('hidden');$('finish').classList.remove('hidden');$('progress').style.width='100%';$('mastered').textContent=targetCount+' / '+targetCount;$('summary').innerHTML='出題数：<strong>'+turn+'問</strong><br>先取り成功：<strong>'+early+'回</strong><br>先取り失敗：<strong>'+late+'回</strong><br>お手つき：<strong>'+wrong+'回</strong>'}
$('start').addEventListener('click',()=>{if(mode==='idle')begin()});$('reset').addEventListener('click',init);$('again').addEventListener('click',init);configureSound();
try{
  questions=readQuestions(window.KarutaDeck);
  if(window.KarutaStudy){
    sharedStore=window.KarutaStudy.createStore(window.KarutaDeck.id);
    $('practice-all').addEventListener('click',()=>{practiceAll=true;init()});
  }
  init();
}catch(error){
  mode='error';
  $('start').disabled=true;
  $('reset').disabled=true;
  $('cards').replaceChildren();
  $('mastered').textContent='0 / 0';
  $('clock').textContent='読み込みエラー';
  $('sentence').textContent='問題データを読み込めませんでした。';
  $('status').textContent=error.message+' ページを再読み込みしてください。';
}
})();
