/* PARA onboarding v2 — data-driven study preferences. */
(function(){
'use strict';
var root=document.getElementById('onboard'),frame=document.getElementById('obFrame');
if(!root||!frame)return;
var P={step:0,schools:[],school:null,course:null,group:null,query:'',searchSeq:0,screenSeq:0,lessons:[],subChoices:[],langChoices:[],selected:{},languageCategory:null,loading:false};
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
 frame.innerHTML='<div class="p2-top"><div class="p2-top-left">'+(back?'<button type="button" id="p2Back" class="p2-back" aria-label="Назад">←</button>':'<span class="p2-mini-logo">para.</span>')+'</div></div>'+
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
  return Array.from(map.entries()).map(function(e){return {name:e[0],options:Array.from(e[1].entries()).map(function(v){return {value:v[0],detail:Array.from(v[1]).join(', ')}})}}).filter(function(c){return c.options.length>0});
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
  P.lessons=String(d.group_id)===String(P.group.id)&&Array.isArray(d.periods)?d.periods.flatMap(function(p){return Array.isArray(p.lessons)?p.lessons:[]}):[];
  var choices=optionsFromLessons(P.lessons,String(P.group.number));
  P.subChoices=choices.sub;P.langChoices=choices.lang;
 }catch(e){if(epoch!==P.screenSeq||P.step!==4)return;P.lessons=[];P.subChoices=[];P.langChoices=[]}
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
    return '<button type="button" class="p2-pill '+(value?'selected':'')+'" data-'+prefix+'="'+esc2(i)+'" data-value="'+esc2(o.value)+'" aria-pressed="'+String(value)+'"><span>'+esc2(shortOption(o.value,prefix))+'</span></button>';
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
 if(!P.subChoices.length)host.innerHTML='<p class="p2-note">Подгруппы не найдены</p>';
 else host.innerHTML=choiceSections(P.subChoices,'sub');
 bindChoices('sub',P.subChoices,drawSubgroups);
 el('p2Next').disabled=!filled(P.selected,P.subChoices);
}
function drawLanguages(){
 if(P.step!==5)return;
 var host=el('p2Languages');
 if(!P.langChoices.length){
   host.innerHTML='<p class="p2-note">Потоки не найдены</p>';
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
       return '<button type="button" data-lang="'+i+'" data-value="'+esc2(o.value)+'" aria-pressed="'+selected+'" class="p2-pill '+(selected?'selected':'')+'"><span>'+esc2(shortOption(o.value,'lang'))+'</span></button>';
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
 P.step=0;P.school=null;P.group=null;P.query='';P.subChoices=[];P.langChoices=[];
 P.selected={};P.languageCategory=null;P.screenSeq++;P.searchSeq++;
 root.classList.remove('hidden','p2-leave');
 document.documentElement.classList.add('para-first');
 go(0);
}
window.paraOpenOnboarding=reopen;
function boot(){
 var forced=new URLSearchParams(location.search).get('setup')==='1';
 var completed=false;
 try{completed=localStorage.getItem('para_onboarding_complete_v1')==='1'&&!!JSON.parse(localStorage.getItem('para_editorial_v02')||'null').groupId}catch(e){}
 if(completed&&!forced)return;
 document.documentElement.classList.add('para-first');
 root.classList.remove('hidden');
 frame.className='p2-frame p2-splash';
 frame.innerHTML='<div class="p2-big-logo">para.</div>';
 setTimeout(function(){if(root.classList.contains('hidden'))return;go(0)},window.matchMedia('(prefers-reduced-motion: reduce)').matches?150:1250);
}
boot();
})();