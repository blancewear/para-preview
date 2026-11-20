/* PARA fast setup: choose university, group, subject-specific streams once. */
(()=>{
'use strict';
const box=document.createElement('div');
box.className='para-onboard';box.id='para-onboard';box.hidden=true;
box.innerHTML=`<div class="ob-wrap"><header class="ob-top"><strong class="ob-logo">para.</strong><span class="ob-count" id="obCounter">01 / 02</span><button type="button" class="ob-cancel" id="obCancel" hidden aria-label="Закрыть выбор группы">×</button></header><div class="ob-main">
<section id="obChoose"><h1>Твои пары.<br>Без лишнего.</h1><p class="ob-intro">Один раз выбери группу и потоки. Потом PARA сразу открывает твои пары.</p>
<div class="ob-field"><label class="ob-label" for="obUniversity">Университет</label><select class="ob-select" id="obUniversity"><option value="safu">САФУ</option></select></div>
<div class="ob-field"><label class="ob-label" for="obSchool">Высшая школа / институт</label><select class="ob-select" id="obSchool"><option value="">Все подразделения САФУ</option></select></div>
<div class="ob-field"><label class="ob-label" for="obQuery">Номер группы</label><input class="ob-input" id="obQuery" type="search" autocomplete="off" spellcheck="false" placeholder="Например, 171605 или 1.5.15"><p class="ob-muted" id="obCount">Загружаем каталог…</p></div>
<div class="ob-results" id="obResults"></div><p class="ob-note" id="obHint" role="status"></p></section>
<section id="obStreamsStep" hidden><h1>Только твои<br>занятия.</h1><p class="ob-intro">Выбери подгруппу и языковой поток. Остальное PARA запомнит.</p><div class="ob-choice" id="obChoice"></div><div id="obStreams" aria-live="polite"></div><p class="ob-note">Настройки сохраняются на устройстве. Позже их можно изменить.</p></section></div>
<footer class="ob-actions"><button class="ob-action" type="button" id="obNext" disabled>Продолжить</button><button class="ob-back" type="button" id="obBack" hidden>← Выбрать другую группу</button></footer></div>`;
document.body.appendChild(box);
const e=id=>document.getElementById(id);
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let schoolData=[],groupData=[],group=null,stage=1,ticket=0;
function switchStage(n){
 stage=n;e('obChoose').hidden=n!==1;e('obStreamsStep').hidden=n!==2;
 e('obCounter').textContent=n===1?'01 / 02':'02 / 02';
 e('obNext').textContent=n===1?'Продолжить':'Открыть расписание';
 e('obNext').disabled=n!==1||!group;
 e('obBack').hidden=n!==2;
 window.scrollTo(0,0);
}
function listGroups(){
 const school=e('obSchool').value,q=e('obQuery').value.trim().toLocaleLowerCase('ru');
 const items=groupData.filter(g=>(!school||String(g.institution_id)===school)&&
  (!q||(String(g.number)+' '+String(g.program||'')).toLocaleLowerCase('ru').includes(q)));
 const relevance=g=>!q?1:String(g.number).toLowerCase()===q?0:String(g.number).toLowerCase().startsWith(q)?1:2;
 items.sort((a,b)=>relevance(a)-relevance(b)||String(a.number).localeCompare(String(b.number),'ru',{numeric:true}));
 const active=Boolean(q||school);
 e('obCount').textContent=!groupData.length?'Каталог временно недоступен.':(!active?`${groupData.length} групп САФУ. Введи номер, чтобы найти свою.`:`${items.length} из ${groupData.length} групп найдено.${items.length>12?' Уточни номер в поиске.':''}`);
 e('obResults').innerHTML=(active?items.slice(0,12):[]).map(g=>`<button type="button" class="ob-row" data-ob-id="${safe(g.id)}" aria-pressed="${Boolean(group&&String(group.id)===String(g.id))}"><span><span class="ob-number">${safe(g.number)}</span><span class="ob-program">${safe(g.program||g.institution||'САФУ')}</span></span><span class="ob-available">${PARA_SCHEDULE_IDS.has(String(g.id))?'Есть расписание':'Пока нет данных'}</span></button>`).join('')||(groupData.length?'<p class="ob-note">Ничего не найдено. Проверь номер или выбери все подразделения.</p>':'');
 for(const button of e('obResults').querySelectorAll('[data-ob-id]')){
   button.addEventListener('click',()=>{
     group=groupData.find(g=>String(g.id)===button.dataset.obId)||null;
     if(!group)return;
     e('obQuery').value=String(group.number);e('obSchool').value=String(group.institution_id);
     e('obHint').textContent='Выбрана группа '+group.number;
     e('obNext').disabled=false;listGroups();
   });
 }
}
async function readCatalogue(){
 const index=ensureScheduleIndex();
 await ensureCatalog();
 groupData=PARA_STATIC_DATA['/api/v1/groups']||[];
 schoolData=PARA_STATIC_DATA['/api/v1/institutions']||[];
 e('obSchool').innerHTML='<option value="">Все подразделения САФУ</option>'+schoolData.map(i=>`<option value="${safe(i.id)}">${safe(i.name)}</option>`).join('');
 listGroups();
 index.then(listGroups).catch(()=>{});
}
async function loadStreams(){
 const seq=++ticket,selected=group;
 window.PARA_SETUP_PAYLOAD=null;
 e('obStreams').innerHTML='<p class="ob-note">Получаем доступные потоки…</p>';
 e('obChoice').innerHTML=`<strong>${safe(selected.number)}</strong><p>${safe(selected.program||selected.institution||'САФУ')}</p>`;
 let data=null;
 const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),7000);
 try{
   const response=await PARA_ORIGINAL_FETCH(new URL('./data/schedules/'+encodeURIComponent(selected.id)+'.json',location.href),{signal:ctl.signal,cache:'default'});
   if(response.ok)data=await response.json();
 }catch(_){}finally{clearTimeout(timeout)}
 if(seq!==ticket)return;
 if(data&&(String(data.group_id)!==String(selected.id)||(data.group_number&&data.group_number!==selected.number)||!Array.isArray(data.periods)))data=null;
 if(!data&&String(selected.id)==='21096')data=PARA_STATIC_DATA['/api/v1/schedule'];
 const lessons=Array.isArray(data?.periods)?data.periods.flatMap(p=>Array.isArray(p.lessons)?p.lessons:[]):[];
 if(!lessons.length){
    e('obStreams').innerHTML='<p class="ob-note">Занятия этой группы пока не загружены. Сохраним группу — потоки станут доступны после синхронизации.</p>';
    e('obNext').disabled=false;return;
 }
 window.PARA_SETUP_PAYLOAD=data;
 const subjects=new Map();
 for(const l of lessons){
   const v=l.subgroup||l.stream;
   if(!v)continue;
   if(!l.subgroup&&l.stream&&l.stream.split(',').map(s=>s.trim()).includes(String(selected.number)))continue;
   const name=String(l.subject||'Дисциплина');
   const vals=subjects.get(name)||new Set();vals.add(String(v));subjects.set(name,vals);
 }
 const options=[...subjects].filter(([_,v])=>v.size>1).sort((a,b)=>a[0].localeCompare(b[0],'ru'));
 if(!options.length){
  e('obStreams').innerHTML='<p class="ob-note">Несколько вариантов подгрупп в загруженном расписании не обнаружено. Можно сразу продолжить.</p>';
  e('obNext').disabled=false;return;
 }
 e('obStreams').innerHTML=options.map(([course,values],i)=>`<div class="ob-stream"><label for="obStream${i}">${safe(course)}</label><select id="obStream${i}" data-course="${safe(course)}"><option value="all">Все потоки</option>${[...values].sort((a,b)=>a.localeCompare(b,'ru')).map(v=>`<option value="${safe(v)}">${safe(v)}</option>`).join('')}</select></div>`).join('');
 for(const sel of e('obStreams').querySelectorAll('[data-course]')){
   const old=String(S.settings.groupId)===String(selected.id)?S.settings.streams?.[sel.dataset.course]:null;
   if(old&&[...sel.options].some(x=>x.value===old))sel.value=old;
 }
 e('obNext').disabled=false;
}
async function finish(){
 if(!group)return;
 const oldId=String(S.settings.groupId||''),newId=String(group.id);
 S.settings.group=String(group.number);
 S.settings.groupId=newId;S.settings.institutionId=String(group.institution_id);
 if(oldId!==newId){
  S.settings.streams={};
  // Never render the previous group's classes while the new schedule loads.
  R.mode='demo';R.lessons=[];R.groupSourceId=null;R.lastSuccess=null;R.sourceStatus='unknown';
 }
 for(const sel of e('obStreams').querySelectorAll('[data-course]'))S.settings.streams[sel.dataset.course]=sel.value;
 try{
   localStorage.setItem('para_editorial_v02',JSON.stringify(S.settings));
   localStorage.setItem('para_onboarding_complete_v1','1');
 }catch(_){}
 window.PARA_SETUP_DONE=true;
 document.documentElement.classList.remove('para-first');
 box.hidden=true;document.querySelector('.shell').style.display='';
 S.week=0;S.expanded=null;tab('schedule');
 await fetchSchedule();renderCourseStreams();
}
e('obQuery').addEventListener('input',()=>{
 if(group&&e('obQuery').value.trim()!==group.number){group=null;e('obNext').disabled=true;e('obHint').textContent='';}
 listGroups();
});
e('obSchool').addEventListener('change',()=>{
 if(group&&String(group.institution_id)!==e('obSchool').value){group=null;e('obNext').disabled=true;e('obHint').textContent='';}
 listGroups();
});
e('obNext').addEventListener('click',async()=>{
 if(stage===1){if(!group)return;switchStage(2);await loadStreams();}
 else await finish();
});
e('obBack').addEventListener('click',()=>{ticket++;switchStage(1);});
e('obCancel').addEventListener('click',()=>{if(!window.PARA_SETUP_DONE)return;ticket++;box.hidden=true;document.documentElement.classList.remove('para-first');document.querySelector('.shell').style.display='';});
async function open(){
 ticket++;group=null;window.PARA_SETUP_PAYLOAD=null;
 box.hidden=false;document.documentElement.classList.add('para-first');
 document.querySelector('.shell').style.display='none';
 e('obCancel').hidden=!window.PARA_SETUP_DONE;
 switchStage(1);e('obQuery').value='';e('obSchool').value='';e('obHint').textContent='';
 await readCatalogue();e('obQuery').focus({preventScroll:true});
}
window.paraOpenOnboarding=open;
if(!window.PARA_SETUP_DONE)open();
})();