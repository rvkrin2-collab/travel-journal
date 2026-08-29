const seedWords = [
  {id:1, hanzi:"经验", pinyin:"jīngyàn", translation:"опыт", status:"learning", example:"我有很多工作经验。 · Wǒ yǒu hěn duō gōngzuò jīngyàn. · У меня большой опыт работы."},
  {id:2, hanzi:"安排", pinyin:"ānpái", translation:"планировать; организовывать", status:"learning", example:"我来安排明天的会议。 · Wǒ lái ānpái míngtiān de huìyì. · Я организую завтрашнюю встречу."},
  {id:3, hanzi:"负责", pinyin:"fùzé", translation:"отвечать за; ответственный", status:"new", example:"他负责这个项目。 · Tā fùzé zhège xiàngmù. · Он отвечает за этот проект."},
  {id:4, hanzi:"提高", pinyin:"tígāo", translation:"повышать; улучшать", status:"learning", example:"我想提高中文水平。 · Wǒ xiǎng tígāo Zhōngwén shuǐpíng. · Я хочу повысить уровень китайского."},
  {id:5, hanzi:"了解", pinyin:"liǎojiě", translation:"понимать; узнавать", status:"mastered", example:"我想先了解一下情况。 · Wǒ xiǎng xiān liǎojiě yíxià qíngkuàng. · Я хочу сначала разобраться в ситуации."},
  {id:6, hanzi:"情况", pinyin:"qíngkuàng", translation:"ситуация; положение", status:"learning", example:"现在情况怎么样？ · Xiànzài qíngkuàng zěnmeyàng? · Как сейчас обстоят дела?"},
  {id:7, hanzi:"决定", pinyin:"juédìng", translation:"решать; решение", status:"new", example:"我还没决定。 · Wǒ hái méi juédìng. · Я ещё не решил."},
  {id:8, hanzi:"联系", pinyin:"liánxì", translation:"связываться; контакт", status:"new", example:"到了以后联系我。 · Dào le yǐhòu liánxì wǒ. · Свяжись со мной, когда приедешь."},
  {id:9, hanzi:"顺利", pinyin:"shùnlì", translation:"гладко; успешно", status:"learning", example:"希望一切顺利。 · Xīwàng yíqiè shùnlì. · Надеюсь, всё пройдёт успешно."},
  {id:10, hanzi:"适合", pinyin:"shìhé", translation:"подходить; быть подходящим", status:"new", example:"这个时间很适合我。 · Zhège shíjiān hěn shìhé wǒ. · Это время мне хорошо подходит."},
  {id:11, hanzi:"确认", pinyin:"quèrèn", translation:"подтверждать", status:"learning", example:"请确认一下时间。 · Qǐng quèrèn yíxià shíjiān. · Пожалуйста, подтвердите время."},
  {id:12, hanzi:"建议", pinyin:"jiànyì", translation:"советовать; предложение", status:"new", example:"你有什么建议？ · Nǐ yǒu shénme jiànyì? · Какие у тебя есть предложения?"},
  {id:13, hanzi:"准备", pinyin:"zhǔnbèi", translation:"готовиться; готовить", status:"mastered", example:"我已经准备好了。 · Wǒ yǐjīng zhǔnbèi hǎo le. · Я уже готов."},
  {id:14, hanzi:"需要", pinyin:"xūyào", translation:"нуждаться; требоваться", status:"mastered", example:"我需要一点时间。 · Wǒ xūyào yìdiǎn shíjiān. · Мне нужно немного времени."},
  {id:15, hanzi:"习惯", pinyin:"xíguàn", translation:"привычка; привыкать", status:"new", example:"我还不习惯。 · Wǒ hái bù xíguàn. · Я ещё не привык."}
];

const defaultState = {
  words: seedWords,
  stats:{correct:0, wrong:0, streak:1, lastStudy:null},
  mistakes:{},
  tasks:{review:false,new:false,sentence:false}
};

let state = loadState();
let filter = "all";
let flashIndex = 0;
let quizWord = null;
let sessionWords = [];
let sessionPos = 0;

function loadState(){
  const raw = localStorage.getItem("chineseStudyState");
  if(!raw) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(raw);
    return {...structuredClone(defaultState), ...parsed, words: parsed.words || seedWords};
  } catch { return structuredClone(defaultState); }
}
function save(){ localStorage.setItem("chineseStudyState", JSON.stringify(state)); renderAll(); }
function statusLabel(s){ return s==="new"?"Новое":s==="learning"?"Учу":"Знаю"; }
function accuracy(){
  const t=state.stats.correct+state.stats.wrong;
  return t?Math.round(state.stats.correct/t*100):0;
}
function updateStreak(){
  const today = new Date(); today.setHours(0,0,0,0);
  if(!state.stats.lastStudy){ state.stats.lastStudy=today.toISOString(); return; }
  const last = new Date(state.stats.lastStudy); last.setHours(0,0,0,0);
  const days = Math.round((today-last)/86400000);
  if(days===1) state.stats.streak += 1;
  else if(days>1) state.stats.streak = 1;
  state.stats.lastStudy=today.toISOString();
}
function markStudy(){ updateStreak(); localStorage.setItem("chineseStudyState",JSON.stringify(state)); }

function renderTodayWords(){
  const box=document.getElementById("todayWords");
  box.innerHTML=state.words.slice(0,5).map(w=>`
    <div class="word-tile">
      <div class="hz">${w.hanzi}</div>
      <div class="py">${w.pinyin}</div>
      <div class="tr">${w.translation}</div>
    </div>`).join("");
}
function renderWords(){
  const q=(document.getElementById("wordSearch")?.value||"").toLowerCase().trim();
  const rows=state.words.filter(w => (filter==="all"||w.status===filter) &&
    [w.hanzi,w.pinyin,w.translation].join(" ").toLowerCase().includes(q));
  document.getElementById("wordTable").innerHTML = rows.map(w=>`
    <div class="word-row">
      <div class="hz">${w.hanzi}</div>
      <div class="pinyin-cell">${w.pinyin}</div>
      <div class="translation-cell">${w.translation}</div>
      <div class="status-cell"><span class="status ${w.status}">${statusLabel(w.status)}</span></div>
      <button class="icon-btn" title="Сменить статус" onclick="cycleStatus(${w.id})">↻</button>
    </div>`).join("") || `<div class="word-row"><div>Ничего не найдено</div></div>`;
}
window.cycleStatus=(id)=>{
  const w=state.words.find(x=>x.id===id);
  const order=["new","learning","mastered"];
  w.status=order[(order.indexOf(w.status)+1)%order.length];
  save();
};

function renderMistakes(){
  const items = Object.entries(state.mistakes)
    .filter(([,count])=>count>0)
    .sort((a,b)=>b[1]-a[1])
    .map(([id,count])=>({w:state.words.find(x=>x.id===Number(id)),count}))
    .filter(x=>x.w);
  const box=document.getElementById("mistakeList");
  if(!items.length){
    box.innerHTML=`<article class="card"><h2>Пока чисто</h2><p class="muted">Ошибки из карточек и тестов будут автоматически попадать сюда.</p></article>`;
    return;
  }
  box.innerHTML=items.map(({w,count})=>`
    <div class="mistake-item">
      <div class="hz">${w.hanzi}</div>
      <div><b>${w.pinyin}</b><div class="muted">${w.translation}</div></div>
      <div>${w.example}</div>
      <div class="count">ошибок: ${count}</div>
    </div>`).join("");
}
function renderProgress(){
  const total=state.words.length;
  const c={new:0,learning:0,mastered:0};
  state.words.forEach(w=>c[w.status]++);
  const pct=k=> total?Math.round(c[k]/total*100):0;
  document.getElementById("totalWords").textContent=total;
  document.getElementById("knownWords").textContent=c.mastered;
  document.getElementById("mistakesTotal").textContent=Object.values(state.mistakes).reduce((a,b)=>a+b,0);
  document.getElementById("answersTotal").textContent=state.stats.correct+state.stats.wrong;
  ["New","Learning","Mastered"].forEach(K=>{
    const k=K.toLowerCase();
    document.getElementById("bar"+K).style.width=pct(k)+"%";
    document.getElementById(k+"Label").textContent=`${c[k]} · ${pct(k)}%`;
  });
}
function renderStats(){
  const mastered=state.words.filter(w=>w.status==="mastered").length;
  document.getElementById("masteredCount").textContent=mastered;
  document.getElementById("masteredMirror").textContent=mastered;
  document.getElementById("accuracy").textContent=accuracy();
  document.getElementById("streakCount").textContent=state.stats.streak;
  document.getElementById("streakMirror").textContent=state.stats.streak;
  document.getElementById("dueCount").textContent=Math.min(10,state.words.length);
  document.getElementById("goalProgress").style.width=Math.min(100,mastered/30*100)+"%";
  document.querySelectorAll("[data-task]").forEach(cb=>cb.checked=!!state.tasks[cb.dataset.task]);
}
function renderFlashcard(){
  const w=state.words[flashIndex%state.words.length];
  document.getElementById("flashHanzi").textContent=w.hanzi;
  document.getElementById("flashPinyin").textContent=w.pinyin;
  document.getElementById("flashTranslation").textContent=w.translation;
  document.getElementById("flashPinyin").classList.add("hidden");
  document.getElementById("flashTranslation").classList.add("hidden");
}
function newQuiz(){
  quizWord=state.words[Math.floor(Math.random()*state.words.length)];
  const distract=[...state.words].filter(w=>w.id!==quizWord.id).sort(()=>Math.random()-.5).slice(0,3);
  const opts=[quizWord,...distract].sort(()=>Math.random()-.5);
  document.getElementById("quizPrompt").textContent=`Как переводится ${quizWord.hanzi}?`;
  document.getElementById("quizFeedback").textContent="";
  const box=document.getElementById("quizOptions");
  box.innerHTML=opts.map(w=>`<button class="quiz-option" data-id="${w.id}">${w.translation}</button>`).join("");
  box.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>answerQuiz(Number(b.dataset.id),b)));
}
function answerQuiz(id,el){
  document.querySelectorAll(".quiz-option").forEach(b=>b.disabled=true);
  if(id===quizWord.id){
    state.stats.correct++;
    el.classList.add("correct");
    document.getElementById("quizFeedback").innerHTML=`Верно: <b>${quizWord.pinyin}</b>`;
  } else {
    state.stats.wrong++;
    state.mistakes[quizWord.id]=(state.mistakes[quizWord.id]||0)+1;
    el.classList.add("wrong");
    const right=[...document.querySelectorAll(".quiz-option")].find(b=>Number(b.dataset.id)===quizWord.id);
    right?.classList.add("correct");
    document.getElementById("quizFeedback").innerHTML=`Нужно повторить: <b>${quizWord.hanzi} — ${quizWord.pinyin}</b>`;
  }
  markStudy(); save();
}
function gradeFlash(good){
  const w=state.words[flashIndex%state.words.length];
  if(good){
    state.stats.correct++;
    if(w.status==="new") w.status="learning";
    else if(w.status==="learning") w.status="mastered";
  } else {
    state.stats.wrong++;
    w.status="learning";
    state.mistakes[w.id]=(state.mistakes[w.id]||0)+1;
  }
  markStudy();
  flashIndex=(flashIndex+1)%state.words.length;
  save(); renderFlashcard();
}
function startSession(){
  sessionWords=[...state.words].sort((a,b)=>{
    const weight=s=>s==="new"?0:s==="learning"?1:2;
    return weight(a.status)-weight(b.status) || Math.random()-.5;
  }).slice(0,10);
  sessionPos=0;
  document.getElementById("sessionModal").classList.add("open");
  renderSession();
}
function renderSession(){
  if(sessionPos>=sessionWords.length){
    document.getElementById("sessionModal").classList.remove("open");
    state.tasks.review=true; save(); return;
  }
  const w=sessionWords[sessionPos];
  document.getElementById("sessionIndex").textContent=sessionPos+1;
  document.getElementById("sessionTotal").textContent=sessionWords.length;
  document.getElementById("sessionHanzi").textContent=w.hanzi;
  document.getElementById("sessionPinyin").textContent=w.pinyin;
  document.getElementById("sessionTranslation").textContent=w.translation;
  document.getElementById("sessionExample").textContent=w.example;
  document.getElementById("sessionAnswer").classList.add("hidden");
  document.getElementById("sessionGrade").classList.add("hidden");
  document.getElementById("revealSession").classList.remove("hidden");
}
function gradeSession(good){
  const w=sessionWords[sessionPos];
  if(good){
    state.stats.correct++;
    if(w.status==="new")w.status="learning"; else if(w.status==="learning")w.status="mastered";
  }else{
    state.stats.wrong++;
    w.status="learning";
    state.mistakes[w.id]=(state.mistakes[w.id]||0)+1;
  }
  markStudy(); sessionPos++; save(); renderSession();
}
function renderAll(){ renderTodayWords(); renderWords(); renderMistakes(); renderProgress(); renderStats(); }

document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById("view-"+btn.dataset.view).classList.add("active");
  const titles={today:"今天学一点，不多，但记住。",words:"把词变成自己的。",practice:"看得懂，不等于说得出。",mistakes:"错误是最有价值的词表。",progress:"每天一点，慢慢就会很多。"};
  document.getElementById("pageTitle").textContent=titles[btn.dataset.view];
}));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>document.querySelector(`.nav-item[data-view="${b.dataset.go}"]`).click()));
document.querySelectorAll("[data-task]").forEach(cb=>cb.addEventListener("change",()=>{state.tasks[cb.dataset.task]=cb.checked;save();}));
document.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{
  document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));
  c.classList.add("active"); filter=c.dataset.filter; renderWords();
}));
document.getElementById("wordSearch").addEventListener("input",renderWords);
document.getElementById("showAnswer").addEventListener("click",()=>{
  document.getElementById("flashPinyin").classList.remove("hidden");
  document.getElementById("flashTranslation").classList.remove("hidden");
});
document.getElementById("answerGood").addEventListener("click",()=>gradeFlash(true));
document.getElementById("answerBad").addEventListener("click",()=>gradeFlash(false));
document.getElementById("nextQuiz").addEventListener("click",newQuiz);
document.getElementById("startSession").addEventListener("click",startSession);
document.getElementById("closeSession").addEventListener("click",()=>document.getElementById("sessionModal").classList.remove("open"));
document.getElementById("revealSession").addEventListener("click",()=>{
  document.getElementById("sessionAnswer").classList.remove("hidden");
  document.getElementById("sessionGrade").classList.remove("hidden");
  document.getElementById("revealSession").classList.add("hidden");
});
document.querySelectorAll("[data-grade]").forEach(b=>b.addEventListener("click",()=>gradeSession(b.dataset.grade==="good")));
document.getElementById("resetBtn").addEventListener("click",()=>{
  if(confirm("Сбросить весь локальный прогресс и вернуть демо-данные?")){
    localStorage.removeItem("chineseStudyState"); state=structuredClone(defaultState); filter="all"; flashIndex=0; renderAll(); renderFlashcard(); newQuiz();
  }
});

renderAll(); renderFlashcard(); newQuiz();
