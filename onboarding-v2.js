/* PARA onboarding v2 — data-driven study preferences. */
(function(){
'use strict';
var root=document.getElementById('onboard'),frame=document.getElementById('obFrame');
if(!root||!frame)return;
var P={step:0,schools:[],school:null,course:null,group:null,query:'',searchSeq:0,screenSeq:0,lessons:[],subChoices:[],langChoices:[],selected:{},languageCategory:null,sourceMissing:false,loading:false};
var el=function(id){return document.getElementById(id)};
var esc2=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var filled=function(map,choices){return choices.every(function(c){return !!map[c.name]})};
function card(value,label,desc,id,active){
 return '<button type="button" class="p2-item'+(active?' is-selected':'')+'" data-'+id+'="'+esc2(value)+'"><span class="p2-item-body"><span class="p2-item-title">'+esc2(label)+'</span>'+(desc?'<span class="p2-item-desc">'+esc2(desc)+'</span>':'')+'</span>'+(active?'<span class="p2-item-arrow">✓</span>':'')+'</button>';
}
function button(label,disabled){
 return '<button type="button" class="p2-primary" id="p2Next" '+(disabled?'disabled':'')+'>'+label+'</button>';
}
function render(title,kicker,body,footer,back){
 frame.className='p2-frame';
 frame.innerHTML='<div class="p2-top"><div class="p2-top-left">'+(back?'<button type="button" id="p2Back" class="p2-back" aria-label="Назад">←</button>':'<img class="p2-mini-logo" src="./para-logo.svg?v=4" alt="para.">')+'</div></div>'+
 '<div class="p2-body p2-enter"><div class="p2-heading"><h1 class="p2-title">'+title+'</h1></div><div class="p2-body-inner">'+body+'</div></div>'+
 '<div class="p2-bottom">'+(footer||'')+'</div>';
 if(back)el('p2Back').onclick=function(){go(P.step-1)};
}
function go(step){
 P.step=Math.max(0,Math.min(5,step));
 P.screenSeq++;P.searchSeq++;if(frame)frame.scrollTop=0;
 if(P.step===0){
  render('Где учишься?','',card('safu','САФУ','','uni',false),'',false);
  frame.querySelector('[data-uni]').onclick=function(){go(1)};
 }
 if(P.step===1){
  render('Высшая школа','','<div id="p2Schools" class="p2-scroll-list">'+(P.schools.length?schoolCards():'<p class="p2-note">Загружаем подразделения…</p>')+'</div>','',true);
  if(P.schools.length)bindSchools();else loadSchools();
 }
 if(P.step===2){
  var cells=[1,2,3,4,5,6].map(function(n){return '<button type="button" data-course="'+n+'" class="p2-course '+(P.course===n?'active':'')+'">'+String(n).padStart(2,'0')+'</button>'}).join('');
  render('Курс','', '<div class="p2-courses">'+cells+'</div>',button('Продолжить',!P.course),true);
  frame.querySelectorAll('[data-course]').forEach(function(b){b.onclick=function(){P.course=Number(b.dataset.course);frame.querySelectorAll('[data-course]').forEach(function(x){x.classList.toggle('active',x===b)});el('p2Next').disabled=false}});
  el('p2Next').onclick=function(){go(3)};
 }
 if(P.step===3){
  render('Группа','', '<input class="p2-input" id="p2Query" aria-label="Номер группы" autocomplete="off" spellcheck="false" placeholder="Номер группы" value="'+esc2(P.query)+'"><p class="p2-note" id="p2Message" role="status" hidden></p><div class="p2-scroll-list p2-group-list" id="p2Matches"></div>',button('Продолжить',!P.group),true);
  el('p2Query').oninput=function(){P.query=this.value.trim();P.group=null;P.selected={};P.languageCategory=null;el('p2Next').disabled=true;clearTimeout(P.searchTimer);P.searchTimer=setTimeout(searchGroups,180)};
  el('p2Next').onclick=function(){go(4)};
  searchGroups();
 }
 if(P.step===4){
  render('Подгруппы','', '<div id="p2Subgroups"><p class="p2-note">Загружаем…</p></div>',button('Продолжить',true)+'<button type="button" id="p2Skip" class="p2-skip">Пропустить</button>',true);
  el('p2Next').onclick=function(){go(5)};
  el('p2Skip').onclick=function(){go(5)};
  loadLessons();
 }
 if(P.step===5){
  render('Иностранный язык','', '<div id="p2Languages"></div>',button('Открыть расписание',false)+'<button type="button" class="p2-skip" id="p2SkipLanguage">Пропустить</button>',true);
  drawLanguages();
  el('p2Next').onclick=finish;
  el('p2SkipLanguage').onclick=finish;
 }
}
function schoolCards(){return P.schools.map(function(s){return card(s.id,s.name,'','school',P.school&&String(P.school.id)===String(s.id))}).join('')}
function bindSchools(){frame.querySelectorAll('[data-school]').forEach(function(b){b.onclick=function(){P.school=P.schools.find(function(s){return String(s.id)===b.dataset.school});P.group=null;P.query='';P.selected={};go(2)}})}
async function loadSchools(){
 var epoch=P.screenSeq;
 try{
  if(typeof ensureCatalog==='function')await ensureCatalog();
  var r=await fetch('/api/v1/institutions',{cache:'no-store'});if(!r.ok)throw Error('catalog unavailable');
  var list=await r.json();if(!Array.isArray(list))throw Error('invalid catalog');
  P.schools=list;
  if(epoch!==P.screenSeq||P.step!==1)return;
  el('p2Schools').innerHTML=schoolCards()||'<p class="p2-note">Подразделения временно недоступны.</p>';
  bindSchools();
 }catch(e){if(epoch!==P.screenSeq||P.step!==1)return;el('p2Schools').innerHTML='<p class="p2-note">Не удалось загрузить список. Проверь подключение.</p><button type="button" class="p2-retry" id="p2Retry">Повторить</button>';el('p2Retry').onclick=loadSchools}
}
async function searchGroups(){
 if(P.step!==3||!P.school)return;
 var epoch=++P.searchSeq,host=el('p2Matches'),message=el('p2Message'),q=P.query;
 message.hidden=true;
 try{
  var groups=await queryGroups(q,String(P.school.id));
  if(epoch!==P.searchSeq||P.step!==3)return;
  groups=groups.filter(function(g){return String(g.institution_id)===String(P.school.id)});
  var exact=groups.filter(function(g){return String(g.number).toLowerCase()===q.toLowerCase()});
  if(q&&exact.length===1){P.group=exact[0];el('p2Next').disabled=false}
  var shown=groups.slice(0,q?20:15);
  host.innerHTML=shown.map(function(g){return card(g.id,g.number,g.program||'','group',P.group&&String(P.group.id)===String(g.id))}).join('');
  host.querySelectorAll('[data-group]').forEach(function(b){b.onclick=function(){
   var oldGroup=P.group&&String(P.group.id);P.group=shown.find(function(g){return String(g.id)===b.dataset.group});if(!P.group)return;
   if(oldGroup!==String(P.group.id)){P.selected={};P.languageCategory=null}
   P.query=P.group.number;el('p2Query').value=P.query;el('p2Next').disabled=false;searchGroups();
  }});
  message.hidden=groups.length>0;message.textContent='Группа не найдена';
 }catch(e){if(epoch!==P.searchSeq||P.step!==3)return;message.hidden=false;message.textContent='Не удалось загрузить группы'}
}
function optionsFromLessons(lessons,groupNumber){
 var subs=new Map(),langs=new Map();
 function add(map,name,value,teacher){
  if(!value)return;
  var m=map.get(name);if(!m){m=new Map();map.set(name,m)}
  if(!m.has(value))m.set(value,new Set());
  if(teacher)m.get(value).add(teacher);
 }
 lessons.forEach(function(l){
  var subject=String(l.subject||'').trim(),sub=String(l.subgroup||'').trim(),stream=String(l.stream||'').trim();
  if(!subject)return;
  var language=/иностранн.*язык|foreign language|немецк.*язык|английск.*язык/i.test(subject);
  if(language){
   if(sub)add(langs,subject,sub,l.teacher);
   if(stream&&!(stream.split(',').map(function(x){return x.trim()}).includes(groupNumber)&&stream.split(',').length>1))add(langs,subject,stream,l.teacher);
  }else{
   if(sub)add(subs,subject,sub,l.teacher);
   if(stream){
    var parts=stream.split(',').map(function(x){return x.trim()});
    var own=parts.filter(function(x){return x.indexOf(groupNumber+'_')===0});
    own.forEach(function(x){add(subs,subject,x,l.teacher)});
   }
  }
 });
 function convert(map){
  function streamNumber(value){
   var matches=String(value).match(/(?:_|№)[0-9]{1,3}(?=[^0-9]|$)/g);
   var last=matches&&matches[matches.length-1];
   return last?Number(last.replace(/[^0-9]/g,'')):Number.MAX_SAFE_INTEGER;
  }
  return Array.from(map.entries()).map(function(e){
   var options=Array.from(e[1].entries()).map(function(v){
     return {value:v[0],detail:Array.from(v[1]).sort(function(a,b){return a.localeCompare(b,'ru')}).join(', ')};
   });
   options.sort(function(a,b){return streamNumber(a.value)-streamNumber(b.value)||a.value.localeCompare(b.value,'ru',{numeric:true})});
   return {name:e[0],options:options};
  }).filter(function(c){return c.options.length>0});
 }
 return {sub:convert(subs),lang:convert(langs)};
}
async function loadLessons(){
 if(!P.group)return;
 var epoch=P.screenSeq;
 try{
  var res=await fetch('/api/v1/schedule?group_id='+encodeURIComponent(P.group.id),{cache:'no-store'});
  if(!res.ok)throw Error('schedule unavailable');
  var d=await res.json();
  if(epoch!==P.screenSeq||P.step!==4)return;
  P.sourceMissing=!(d&&String(d.group_id)===String(P.group.id)&&d.cached===true);
  P.lessons=!P.sourceMissing&&Array.isArray(d.periods)?d.periods.flatMap(function(p){return Array.isArray(p.lessons)?p.lessons:[]}):[];
  var choices=optionsFromLessons(P.lessons,String(P.group.number));
  P.subChoices=choices.sub;P.langChoices=choices.lang;
 }catch(e){if(epoch!==P.screenSeq||P.step!==4)return;P.lessons=[];P.subChoices=[];P.langChoices=[];P.sourceMissing=true}
 drawSubgroups();
}
function shortOption(value,kind){
 var text=String(value);
 if(kind==='sub'){
   var m=text.match(/_(\d{2})$/);
   return m?'Подгруппа '+Number(m[1]):text;
 }
 if(kind==='lang'){
   var g=text.match(/^ИЯ_Немецкий_(\d+)$/i);
   if(g)return 'Поток '+Number(g[1]);
   var v=text.match(/_№(\d+)/);
   if(v)return 'Поток №'+v[1];
 }
 return text;
}
function choiceSections(choices,prefix){
 return choices.map(function(c,i){
  return '<section class="p2-choice-section"><div class="p2-choice-name">'+esc2(c.name)+'</div><div class="p2-choice-options">'+c.options.map(function(o){
    var value=P.selected[c.name]===o.value;
    return '<button type="button" class="p2-pill '+(value?'selected':'')+'" data-'+prefix+'="'+esc2(i)+'" data-value="'+esc2(o.value)+'" aria-pressed="'+String(value)+'"><span class="p2-pill-label">'+esc2(shortOption(o.value,prefix))+'</span>'+(o.detail?'<span class="p2-pill-teacher">'+esc2(o.detail)+'</span>':'')+'</button>';
  }).join('')+'</div></section>';
 }).join('');
}
function bindChoices(type,choices,draw){
 frame.querySelectorAll('[data-'+type+']').forEach(function(b){b.onclick=function(){
  var c=choices[Number(b.getAttribute('data-'+type))];if(!c)return;
  P.selected[c.name]=b.dataset.value;
  draw();
 }});
}
function drawSubgroups(){
 if(P.step!==4)return;
 var host=el('p2Subgroups');if(!host)return;
 if(!P.subChoices.length)host.innerHTML=P.sourceMissing?'<p class="p2-note">Расписание этой группы ещё не загружено. Подгруппы можно указать позже.</p>':'<p class="p2-note">Отдельных подгрупп нет</p>';
 else host.innerHTML=choiceSections(P.subChoices,'sub');
 bindChoices('sub',P.subChoices,drawSubgroups);
 el('p2Next').disabled=!filled(P.selected,P.subChoices);
}
function drawLanguages(){
 if(P.step!==5)return;
 var host=el('p2Languages');
 if(!P.langChoices.length){
   host.innerHTML='<p class="p2-note">'+(P.sourceMissing?'Расписание ещё не загружено. Языковой поток можно выбрать позже.':'Отдельных языковых потоков нет')+'</p>';
 }else{
   var categories=[],categoryFor=function(value){
     return /немецк|deutsch/i.test(value)?'Немецкий':/английск|english/i.test(value)?'Английский':/француз|fran[cç]ais/i.test(value)?'Французский':'Другие потоки';
   };
   P.langChoices.forEach(function(c){c.options.forEach(function(o){var k=categoryFor(o.value);if(categories.indexOf(k)<0)categories.push(k)})});
   if(!P.languageCategory||categories.indexOf(P.languageCategory)<0)P.languageCategory=categories[0];
   var tabs='<div class="p2-language-tabs">'+categories.map(function(k){return '<button type="button" data-langcat="'+esc2(k)+'" class="p2-language-tab '+(P.languageCategory===k?'active':'')+'">'+esc2(k)+'</button>'}).join('')+'</div>';
   var sections=P.langChoices.map(function(c,i){
     var filtered=c.options.filter(function(o){return categoryFor(o.value)===P.languageCategory});
     if(!filtered.length)return '';
     return '<section class="p2-choice-section"><div class="p2-choice-name">'+esc2(c.name)+'</div><div class="p2-choice-options">'+filtered.map(function(o){
       var selected=P.selected[c.name]===o.value;
       return '<button type="button" data-lang="'+i+'" data-value="'+esc2(o.value)+'" aria-pressed="'+selected+'" class="p2-pill '+(selected?'selected':'')+'"><span class="p2-pill-label">'+esc2(shortOption(o.value,'lang'))+'</span>'+(o.detail?'<span class="p2-pill-teacher">'+esc2(o.detail)+'</span>':'')+'</button>';
     }).join('')+'</div></section>';
   }).join('');
   host.innerHTML=tabs+sections;
   host.querySelectorAll('[data-langcat]').forEach(function(b){b.onclick=function(){if(P.languageCategory!==b.dataset.langcat){P.langChoices.forEach(function(choice){delete P.selected[choice.name]});P.languageCategory=b.dataset.langcat}drawLanguages()}});
   bindChoices('lang',P.langChoices,drawLanguages);
 }
 el('p2Next').disabled=!filled(P.selected,P.langChoices);
}
async function finish(){
 if(!P.group)return;
 var btn=el('p2Next');btn.disabled=true;
 var old=String(S.settings.groupId||'');
 S.settings.group=String(P.group.number);
 S.settings.groupId=String(P.group.id);
 S.settings.institutionId=String(P.group.institution_id);
 S.settings.course=String(P.course||'');
 S.settings.streams=(old===String(P.group.id)?S.settings.streams:{})||{};
 Object.keys(P.selected).forEach(function(k){S.settings.streams[k]=P.selected[k]});
 if(old!==String(P.group.id)){R.lessons=[];R.groupSourceId=null;R.mode='demo'}
 persist();
 try{localStorage.setItem('para_onboarding_complete_v1','1')}catch(e){}
 window.PARA_SETUP_DONE=true;
 document.documentElement.classList.remove('para-first');
 root.classList.add('p2-leave');
 await fetchSchedule();
 if(typeof loadInstitutions==='function')loadInstitutions();
 setTimeout(function(){root.classList.remove('p2-leave');root.classList.add('hidden');tab('schedule')},250);
}
function reopen(){
 clearIntro();
 P.step=0;P.school=null;P.group=null;P.query='';P.subChoices=[];P.langChoices=[];
 P.selected={};P.languageCategory=null;P.sourceMissing=false;P.screenSeq++;P.searchSeq++;
 root.classList.remove('hidden','p2-leave');
 document.documentElement.classList.add('para-first');
 go(0);
}
window.paraOpenOnboarding=reopen;

var PARA_INLINE_INK = String.raw`<svg class="p2-big-logo p2-ink-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 796 190" role="img" aria-label="para.">
<title>para.</title>
<defs>
<mask id="ink-p" maskUnits="userSpaceOnUse" x="0" y="0" width="796" height="190"><path class="para-stroke p-stem" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M29 176 L29 10" fill="none" stroke="#fff" stroke-width="59" stroke-linecap="round" stroke-linejoin="round"/><path class="para-stroke p-bowl" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M35 71 C47 29 80 15 115 28 C146 39 159 66 146 94 C129 130 86 129 54 99" fill="none" stroke="#fff" stroke-width="73" stroke-linecap="round" stroke-linejoin="round"/></mask><mask id="ink-a1" maskUnits="userSpaceOnUse" x="0" y="0" width="796" height="190"><path class="para-stroke a1-arch" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M214 42 C225 19 265 13 302 28 C327 37 328 49 313 62" fill="none" stroke="#fff" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/><path class="para-stroke a1-bowl" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M305 78 C281 82 244 78 219 88 C205 95 219 120 250 120 C286 125 313 99 333 73" fill="none" stroke="#fff" stroke-width="67" stroke-linecap="round" stroke-linejoin="round"/><path class="para-stroke a1-spine" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M334 47 L334 131" fill="none" stroke="#fff" stroke-width="57" stroke-linecap="round" stroke-linejoin="round"/></mask><mask id="ink-r" maskUnits="userSpaceOnUse" x="0" y="0" width="796" height="190"><path class="para-stroke r-stem" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M398 131 L398 11" fill="none" stroke="#fff" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/><path class="para-stroke r-arch" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M398 69 C411 28 443 25 475 26" fill="none" stroke="#fff" stroke-width="67" stroke-linecap="round" stroke-linejoin="round"/></mask><mask id="ink-a2" maskUnits="userSpaceOnUse" x="0" y="0" width="796" height="190"><path class="para-stroke a2-arch" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M520 42 C531 19 571 13 608 28 C633 37 634 49 619 62" fill="none" stroke="#fff" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/><path class="para-stroke a2-bowl" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M611 78 C587 82 550 78 525 88 C511 95 525 120 556 120 C592 125 619 99 639 73" fill="none" stroke="#fff" stroke-width="67" stroke-linecap="round" stroke-linejoin="round"/><path class="para-stroke a2-spine" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M640 47 L640 131" fill="none" stroke="#fff" stroke-width="57" stroke-linecap="round" stroke-linejoin="round"/></mask><mask id="ink-dot" maskUnits="userSpaceOnUse" x="0" y="0" width="796" height="190"><path class="para-stroke dot-ink" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1" d="M744 139 C763 123 759 160 740 159 C719 158 720 130 743 120" fill="none" stroke="#fff" stroke-width="97" stroke-linecap="round" stroke-linejoin="round"/></mask>
</defs>

<g class="animated-mark"><path fill="#000" fill-rule="evenodd" transform="translate(0.5 0.5)" mask="url(#ink-p)" d="M3.0,177.1 L53.0,177.5 L55.1,177.0 L55.5,124.0 L56.0,121.5 L58.0,121.6 L64.0,126.0 L72.0,130.1 L81.0,133.4 L89.0,135.4 L101.0,136.6 L104.0,137.5 L122.0,137.5 L129.0,136.4 L138.0,133.5 L143.0,131.1 L155.0,122.9 L159.0,119.0 L167.0,108.0 L172.2,98.0 L174.4,91.0 L176.5,81.0 L176.5,62.0 L174.4,52.0 L171.5,43.0 L167.2,34.0 L159.9,24.0 L155.0,19.0 L150.0,15.0 L141.0,9.9 L132.0,6.6 L119.0,4.5 L106.0,4.5 L102.0,5.5 L95.0,5.6 L84.0,7.6 L75.0,10.5 L66.0,14.8 L55.0,22.7 L53.7,22.0 L52.6,19.0 L51.4,10.0 L50.0,7.8 L5.0,7.5 L2.9,8.0 L2.5,174.0Z  M90.0,107.5 L77.0,105.4 L70.0,101.9 L61.0,92.8 L57.9,87.0 L55.5,78.0 L55.6,63.0 L57.0,58.1 L61.0,50.1 L64.2,46.0 L71.1,40.0 L77.0,36.9 L88.0,34.5 L92.0,34.6 L102.0,36.6 L108.0,39.4 L116.9,48.0 L120.0,53.0 L122.4,59.0 L124.5,70.0 L124.4,75.0 L121.5,86.0 L119.6,90.0 L116.0,95.0 L110.0,100.9 L105.0,104.0 L98.0,106.4 L93.0,106.6Z "/><path fill="#000" fill-rule="evenodd" transform="translate(0.5 0.5)" mask="url(#ink-a1)" d="M190.4,118.0 L198.0,125.9 L204.0,129.1 L217.0,133.4 L228.0,135.5 L255.0,135.5 L274.0,132.4 L287.0,128.5 L293.0,125.6 L298.0,122.0 L302.0,117.5 L303.0,117.3 L304.4,119.0 L307.9,133.0 L309.0,133.5 L357.0,133.1 L357.5,131.0 L357.5,47.0 L355.4,37.0 L351.6,29.0 L347.9,24.0 L341.0,18.0 L329.0,11.8 L308.0,5.6 L288.0,2.5 L255.0,2.5 L252.0,3.4 L246.0,3.6 L227.0,7.6 L218.0,10.5 L208.0,15.4 L197.0,23.2 L192.0,29.0 L188.6,36.0 L186.6,45.0 L187.0,47.1 L238.0,47.5 L239.1,47.0 L241.0,41.0 L244.0,37.2 L253.0,31.9 L261.0,29.6 L266.0,29.4 L269.0,28.5 L275.0,28.5 L278.0,29.4 L284.0,29.6 L292.0,31.6 L299.0,35.0 L302.9,39.0 L304.0,41.0 L304.4,49.0 L301.7,53.0 L297.0,55.4 L292.0,55.6 L289.0,56.5 L273.0,56.5 L269.0,57.5 L225.0,57.5 L210.0,60.6 L202.1,64.0 L196.0,68.2 L191.8,73.0 L187.9,80.0 L186.6,84.0 L185.5,90.0 L185.5,103.0 L186.6,109.0Z  M238.6,90.0 L238.6,87.0 L241.0,82.1 L248.0,77.6 L259.0,75.5 L280.0,75.5 L284.0,74.5 L292.0,74.5 L303.0,71.8 L304.4,73.0 L304.4,78.0 L303.4,82.0 L300.6,88.0 L297.9,92.0 L294.0,95.9 L287.0,100.1 L283.0,101.4 L272.0,103.4 L266.0,103.5 L255.0,102.4 L247.1,100.0 L244.0,98.0 L241.0,94.8Z "/><path fill="#000" fill-rule="evenodd" transform="translate(0.5 0.5)" mask="url(#ink-r)" d="M371.0,133.1 L421.0,133.5 L423.1,133.0 L423.5,74.0 L426.5,62.0 L429.4,56.0 L433.1,51.0 L441.0,45.9 L447.0,44.5 L479.0,44.5 L481.1,44.0 L481.5,8.0 L481.0,5.9 L477.0,5.5 L470.0,6.6 L453.0,10.9 L437.0,18.4 L430.0,23.1 L424.0,28.7 L422.7,28.0 L421.6,25.0 L419.4,12.0 L418.0,7.9 L373.0,7.5 L370.9,8.0 L370.5,130.0Z "/><path fill="#000" fill-rule="evenodd" transform="translate(0.5 0.5)" mask="url(#ink-a2)" d="M496.4,118.0 L504.0,125.9 L510.0,129.1 L523.0,133.4 L534.0,135.5 L561.0,135.5 L580.0,132.4 L593.0,128.5 L599.0,125.6 L604.0,122.0 L608.0,117.5 L609.0,117.3 L610.4,119.0 L613.9,133.0 L615.0,133.5 L663.0,133.1 L663.5,131.0 L663.5,47.0 L661.4,37.0 L657.6,29.0 L653.9,24.0 L647.0,18.0 L635.0,11.8 L614.0,5.6 L594.0,2.5 L561.0,2.5 L558.0,3.4 L552.0,3.6 L533.0,7.6 L524.0,10.5 L514.0,15.4 L503.0,23.2 L498.0,29.0 L494.6,36.0 L492.6,45.0 L493.0,47.1 L544.0,47.5 L545.1,47.0 L547.0,41.0 L550.0,37.2 L559.0,31.9 L567.0,29.6 L572.0,29.4 L575.0,28.5 L581.0,28.5 L584.0,29.4 L590.0,29.6 L598.0,31.6 L605.0,35.0 L608.9,39.0 L610.0,41.0 L610.4,49.0 L607.7,53.0 L603.0,55.4 L598.0,55.6 L595.0,56.5 L579.0,56.5 L575.0,57.5 L531.0,57.5 L516.0,60.6 L508.1,64.0 L502.0,68.2 L497.8,73.0 L493.9,80.0 L492.6,84.0 L491.5,90.0 L491.5,103.0 L492.6,109.0Z  M544.6,90.0 L544.6,87.0 L547.0,82.1 L554.0,77.6 L565.0,75.5 L586.0,75.5 L590.0,74.5 L598.0,74.5 L609.0,71.8 L610.4,73.0 L610.4,78.0 L609.4,82.0 L606.6,88.0 L603.9,92.0 L600.0,95.9 L593.0,100.1 L589.0,101.4 L578.0,103.4 L572.0,103.5 L561.0,102.4 L553.1,100.0 L550.0,98.0 L547.0,94.8Z "/><path fill="#000" fill-rule="evenodd" transform="translate(0.5 0.5)" mask="url(#ink-dot)" d="M750.0,185.4 L760.0,183.4 L770.0,179.6 L778.0,173.8 L782.2,169.0 L787.1,161.0 L790.4,151.0 L791.5,145.0 L791.4,131.0 L789.1,121.0 L785.6,113.0 L779.9,105.0 L777.0,102.1 L770.0,97.0 L766.0,94.9 L756.0,91.6 L749.0,90.5 L739.0,90.6 L729.0,92.6 L720.0,96.4 L711.2,103.0 L707.1,108.0 L700.8,119.0 L699.6,123.0 L697.5,134.0 L697.6,144.0 L699.6,154.0 L703.0,162.8 L706.1,168.0 L715.0,176.9 L722.0,181.1 L733.0,184.4 L740.0,185.5Z"/></g>
<g class="static-mark" style="opacity:0"><path fill="#000" fill-rule="evenodd" transform="translate(0.5 0.5)" d="M190.4,118.0 L198.0,125.9 L204.0,129.1 L217.0,133.4 L228.0,135.5 L255.0,135.5 L274.0,132.4 L287.0,128.5 L293.0,125.6 L298.0,122.0 L302.0,117.5 L303.0,117.3 L304.4,119.0 L307.9,133.0 L309.0,133.5 L357.0,133.1 L357.5,131.0 L357.5,47.0 L355.4,37.0 L351.6,29.0 L347.9,24.0 L341.0,18.0 L329.0,11.8 L308.0,5.6 L288.0,2.5 L255.0,2.5 L252.0,3.4 L246.0,3.6 L227.0,7.6 L218.0,10.5 L208.0,15.4 L197.0,23.2 L192.0,29.0 L188.6,36.0 L186.6,45.0 L187.0,47.1 L238.0,47.5 L239.1,47.0 L241.0,41.0 L244.0,37.2 L253.0,31.9 L261.0,29.6 L266.0,29.4 L269.0,28.5 L275.0,28.5 L278.0,29.4 L284.0,29.6 L292.0,31.6 L299.0,35.0 L302.9,39.0 L304.0,41.0 L304.4,49.0 L301.7,53.0 L297.0,55.4 L292.0,55.6 L289.0,56.5 L273.0,56.5 L269.0,57.5 L225.0,57.5 L210.0,60.6 L202.1,64.0 L196.0,68.2 L191.8,73.0 L187.9,80.0 L186.6,84.0 L185.5,90.0 L185.5,103.0 L186.6,109.0Z  M496.4,118.0 L504.0,125.9 L510.0,129.1 L523.0,133.4 L534.0,135.5 L561.0,135.5 L580.0,132.4 L593.0,128.5 L599.0,125.6 L604.0,122.0 L608.0,117.5 L609.0,117.3 L610.4,119.0 L613.9,133.0 L615.0,133.5 L663.0,133.1 L663.5,131.0 L663.5,47.0 L661.4,37.0 L657.6,29.0 L653.9,24.0 L647.0,18.0 L635.0,11.8 L614.0,5.6 L594.0,2.5 L561.0,2.5 L558.0,3.4 L552.0,3.6 L533.0,7.6 L524.0,10.5 L514.0,15.4 L503.0,23.2 L498.0,29.0 L494.6,36.0 L492.6,45.0 L493.0,47.1 L544.0,47.5 L545.1,47.0 L547.0,41.0 L550.0,37.2 L559.0,31.9 L567.0,29.6 L572.0,29.4 L575.0,28.5 L581.0,28.5 L584.0,29.4 L590.0,29.6 L598.0,31.6 L605.0,35.0 L608.9,39.0 L610.0,41.0 L610.4,49.0 L607.7,53.0 L603.0,55.4 L598.0,55.6 L595.0,56.5 L579.0,56.5 L575.0,57.5 L531.0,57.5 L516.0,60.6 L508.1,64.0 L502.0,68.2 L497.8,73.0 L493.9,80.0 L492.6,84.0 L491.5,90.0 L491.5,103.0 L492.6,109.0Z  M3.0,177.1 L53.0,177.5 L55.1,177.0 L55.5,124.0 L56.0,121.5 L58.0,121.6 L64.0,126.0 L72.0,130.1 L81.0,133.4 L89.0,135.4 L101.0,136.6 L104.0,137.5 L122.0,137.5 L129.0,136.4 L138.0,133.5 L143.0,131.1 L155.0,122.9 L159.0,119.0 L167.0,108.0 L172.2,98.0 L174.4,91.0 L176.5,81.0 L176.5,62.0 L174.4,52.0 L171.5,43.0 L167.2,34.0 L159.9,24.0 L155.0,19.0 L150.0,15.0 L141.0,9.9 L132.0,6.6 L119.0,4.5 L106.0,4.5 L102.0,5.5 L95.0,5.6 L84.0,7.6 L75.0,10.5 L66.0,14.8 L55.0,22.7 L53.7,22.0 L52.6,19.0 L51.4,10.0 L50.0,7.8 L5.0,7.5 L2.9,8.0 L2.5,174.0Z  M371.0,133.1 L421.0,133.5 L423.1,133.0 L423.5,74.0 L426.5,62.0 L429.4,56.0 L433.1,51.0 L441.0,45.9 L447.0,44.5 L479.0,44.5 L481.1,44.0 L481.5,8.0 L481.0,5.9 L477.0,5.5 L470.0,6.6 L453.0,10.9 L437.0,18.4 L430.0,23.1 L424.0,28.7 L422.7,28.0 L421.6,25.0 L419.4,12.0 L418.0,7.9 L373.0,7.5 L370.9,8.0 L370.5,130.0Z  M90.0,107.5 L77.0,105.4 L70.0,101.9 L61.0,92.8 L57.9,87.0 L55.5,78.0 L55.6,63.0 L57.0,58.1 L61.0,50.1 L64.2,46.0 L71.1,40.0 L77.0,36.9 L88.0,34.5 L92.0,34.6 L102.0,36.6 L108.0,39.4 L116.9,48.0 L120.0,53.0 L122.4,59.0 L124.5,70.0 L124.4,75.0 L121.5,86.0 L119.6,90.0 L116.0,95.0 L110.0,100.9 L105.0,104.0 L98.0,106.4 L93.0,106.6Z  M238.6,90.0 L238.6,87.0 L241.0,82.1 L248.0,77.6 L259.0,75.5 L280.0,75.5 L284.0,74.5 L292.0,74.5 L303.0,71.8 L304.4,73.0 L304.4,78.0 L303.4,82.0 L300.6,88.0 L297.9,92.0 L294.0,95.9 L287.0,100.1 L283.0,101.4 L272.0,103.4 L266.0,103.5 L255.0,102.4 L247.1,100.0 L244.0,98.0 L241.0,94.8Z  M544.6,90.0 L544.6,87.0 L547.0,82.1 L554.0,77.6 L565.0,75.5 L586.0,75.5 L590.0,74.5 L598.0,74.5 L609.0,71.8 L610.4,73.0 L610.4,78.0 L609.4,82.0 L606.6,88.0 L603.9,92.0 L600.0,95.9 L593.0,100.1 L589.0,101.4 L578.0,103.4 L572.0,103.5 L561.0,102.4 L553.1,100.0 L550.0,98.0 L547.0,94.8Z  M750.0,185.4 L760.0,183.4 L770.0,179.6 L778.0,173.8 L782.2,169.0 L787.1,161.0 L790.4,151.0 L791.5,145.0 L791.4,131.0 L789.1,121.0 L785.6,113.0 L779.9,105.0 L777.0,102.1 L770.0,97.0 L766.0,94.9 L756.0,91.6 L749.0,90.5 L739.0,90.6 L729.0,92.6 L720.0,96.4 L711.2,103.0 L707.1,108.0 L700.8,119.0 L699.6,123.0 L697.5,134.0 L697.6,144.0 L699.6,154.0 L703.0,162.8 L706.1,168.0 L715.0,176.9 L722.0,181.1 L733.0,184.4 L740.0,185.5Z"/></g>
</svg>`;
var PARA_INK_STEPS = [["p-stem",0,460],["p-bowl",250,480],["a1-arch",610,440],["a1-bowl",820,410],["a1-spine",1020,300],["r-stem",1160,320],["r-arch",1330,360],["a2-arch",1590,390],["a2-bowl",1780,400],["a2-spine",1980,280],["dot-ink",2240,230]];
var PARA_INK_DURATION = 2490;
var paraIntroVersion=0,paraIntroFrame=0,paraIntroTimers=[];
function clearIntro(){
 paraIntroVersion++;
 if(paraIntroFrame)cancelAnimationFrame(paraIntroFrame);
 paraIntroFrame=0;
 paraIntroTimers.forEach(function(id){clearTimeout(id)});
 paraIntroTimers=[];
}
function introLater(fn,delay){
 var id=setTimeout(fn,delay);
 paraIntroTimers.push(id);
 return id;
}
function inkEase(x){
 x=Math.min(1,Math.max(0,x));
 return 1-Math.pow(1-x,3);
}
function boot(){
 clearIntro();
 var token=paraIntroVersion;
 var forced=new URLSearchParams(location.search).get('setup')==='1';
 var completed=false;
 try{completed=localStorage.getItem('para_onboarding_complete_v1')==='1'&&!!JSON.parse(localStorage.getItem('para_editorial_v02')||'null').groupId}catch(e){}
 var shouldSetup=!completed||forced;
 var reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 document.documentElement.classList.add('para-first');
 root.classList.remove('hidden','p2-intro-out','p2-leave');
 frame.className='p2-frame p2-splash';
 frame.innerHTML=PARA_INLINE_INK;
 var svg=frame.querySelector('svg.p2-ink-svg');
 var paths=PARA_INK_STEPS.map(function(step){
  var p=svg.querySelector('.'+step[0]);
  if(!p)throw Error('PARA ink stroke missing: '+step[0]);
  p.style.strokeDasharray='1';
  p.style.strokeDashoffset='1';
  return p;
 });
 var finished=svg.querySelector('.static-mark');
 finished.style.opacity='0';
 function endIntro(){
  if(token!==paraIntroVersion||!frame.classList.contains('p2-splash'))return;
  if(shouldSetup){
   frame.classList.add('p2-intro-leave');
   introLater(function(){
    if(token!==paraIntroVersion||!frame.classList.contains('p2-splash'))return;
    frame.classList.remove('p2-intro-leave');
    go(0);
   },reduced?0:230);
  }else{
   root.classList.add('p2-intro-out');
   introLater(function(){
    if(token!==paraIntroVersion)return;
    root.classList.add('hidden');
    root.classList.remove('p2-intro-out');
    document.documentElement.classList.remove('para-first');
   },reduced?0:350);
  }
 }
 if(reduced){
  paths.forEach(function(p){p.style.strokeDashoffset='0'});
  finished.style.opacity='1';
  introLater(endIntro,90);
  return;
 }
 // All strokes are driven by the host page on every load (not by an SVG image cache).
 var begun=null;
 function draw(now){
  if(token!==paraIntroVersion||!svg.isConnected)return;
  if(begun===null)begun=now;
  var elapsed=Math.max(0,now-begun);
  PARA_INK_STEPS.forEach(function(step,i){
   paths[i].style.strokeDashoffset=String(1-inkEase((elapsed-step[1])/step[2]));
  });
  if(elapsed>=PARA_INK_DURATION){
   paths.forEach(function(p){p.style.strokeDashoffset='0'});
   finished.style.opacity='1';
   introLater(endIntro,200);
  }else{
   paraIntroFrame=requestAnimationFrame(draw);
  }
 }
 paraIntroFrame=requestAnimationFrame(draw);
}
window.addEventListener('pageshow',function(e){
 if(e.persisted&&root.classList.contains('hidden'))boot();
});
boot();
})();