// Verify the public PARA website and every published timetable before release.
// No external requests or extra npm dependencies.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length >= 2, 'Embedded preview and app scripts must exist');
for (const [i, match] of scripts.entries()) {
  new vm.Script(match[1], {filename: 'index-inline-' + i + '.js'});
}
const setup = fs.readFileSync('onboarding-v2.js','utf8');
const setupCss = fs.readFileSync('onboarding-v2.css','utf8');
const appCss = fs.readFileSync('para-ui-v6.css','utf8');
new vm.Script(setup,{filename:'onboarding-v2.js'});
const logo = fs.readFileSync('para-logo.svg','utf8');
assert.ok(logo.includes('viewBox="0 0 796 190"') && logo.includes('fill-rule="evenodd"'),'Approved logo vector is missing');
assert.equal((html.match(/class="logo para-logo"/g)||[]).length,3,'Every app tab must use the approved logo');
assert.ok(setup.includes('frame.innerHTML=PARA_INLINE_INK'), 'Splash must render the vector inline on every visit');
assert.ok(setup.includes('class="p2-mini-logo" src="./para-logo.svg?v=4"'),'First-run navigation uses approved logo');
assert.ok(html.includes('onboarding-v2.js?v=18'),'Staged onboarding script must be included');
assert.ok(html.includes('onboarding-v2.css?v=6'),'Staged onboarding CSS must be included');
assert.ok(html.includes('para-ui-v6.css?v=7'),'Bounded app stylesheet must be included');
assert.ok(html.includes('Сменить учебную группу'), 'Profile must clearly label change-group action');
assert.ok(html.includes("$('editStudy').onclick=editStudy;"), 'Change-group must launch onboarding, not expand a duplicate form');
assert.ok(html.includes('aria-current="page"'), 'Active tab must have accessibility state');
assert.ok(html.includes("e.setAttribute('aria-current','page')"),'Tab switches must update accessibility state');
assert.ok(html.includes('aria-pressed='),'Day selection must expose state');
assert.ok(html.includes('monthFmt.format(b)'),'Compact week range must use month name');
assert.ok(appCss.includes('para-tab-in'),'Tab transitions must use a stable opacity animation');
assert.ok(setup.includes("var shouldSetup=!completed||forced"),"Completed users must see a logo intro without losing their schedule");
assert.ok(setup.includes("root.classList.add('p2-intro-out')"),"Returning users must dismiss intro");
const drawLogo = fs.readFileSync('para-logo-draw.svg','utf8');
assert.ok(setup.includes('requestAnimationFrame(draw)'), 'Intro must be controlled by a fresh page animation clock');
assert.ok(setup.includes('stroke-dashoffset:1') && setup.includes('stroke-dasharray:1'), 'Inline logo masks must initialize at the first stroke');
assert.ok(setup.includes('mask="url(#ink-p)"') && setup.includes('mask="url(#ink-dot)"'), 'Inline glyphs must retain independent masks');
assert.ok(setup.includes("if(reduced){") && setup.includes("window.addEventListener('pageshow'"), 'Motion and bfcache restoration must be handled');
assert.ok(!appCss.includes('para-wordmark-reveal'),'Horizontal wipe animation must not return');
assert.ok(appCss.includes("body:has(#onboard.p2-intro-out) .shell"),"Background must be visible during fade");
assert.ok(logo.includes('translate(0.5 0.5)'),"Smoothed vector contour must use subpixel alignment");

assert.ok(appCss.includes('prefers-reduced-motion:reduce'),'Motion must respect accessibility settings');
assert.ok(html.includes('<meta name="theme-color" content="#fafaf8">'),'Safari theme must match app surface');
assert.ok(!html.includes('app-shell-v3.css?v=2') && !html.includes('mobile-layout-v5.css?v=1'),'Conflicting old layouts must be disabled');
assert.ok(html.includes("if(window.PARA_SETUP_DONE){tab('schedule');fetchSchedule()}"),
 'Default schedule must not load before first-run selection');
assert.ok(setup.includes('para_onboarding_complete_v1'),'Onboarding must persist completion');
assert.ok(setup.includes('S.settings.groupId=String(P.group.id)'),'Selection must save exact RUZ ID');
assert.ok(setup.includes('S.settings.streams'),'Per-subject stream choices must be stored');
assert.ok(setup.includes('queryGroups('),'Client-side catalogue lookup is required');
assert.ok(setup.includes('P.course=null;P.group=null'), 'Reopening group setup must reset old course');
assert.ok(setup.includes("if(typeof ensureCatalog==='function'&&!(await ensureCatalog()))"),'Onboarding must fail closed when full school catalogue is unavailable');
assert.ok(setup.includes("P.searchSeq++;el('p2Next').disabled=true;el('p2Matches').innerHTML=''"), 'Typing must immediately clear stale suggestions');
assert.ok(setup.includes('Курс сохраним в профиле'), 'Course selector must not imply an unsupported RUZ filter');
assert.ok(setup.includes('Копия расписания загружена'), 'Real cached group availability must be shown');
assert.ok(html.includes('PARA_SCHEDULE_INDEX_READY=true'), 'Availability status should only be shown after verified index loads');
assert.ok(html.includes('if(!PARA_CATALOG_READY)PARA_CATALOG_PROMISE=null'), 'Transient catalogue failures must be retryable');
assert.ok(setup.includes('window.paraOpenOnboarding=reopen'),'Changing groups must reopen setup');
assert.ok(setup.includes('optionsFromLessons'),'Subgroups must come from the real schedule');
assert.ok(setup.includes('p2-pill-teacher'), 'RUZ teacher name must be present in option cards');
assert.ok(appCss.includes('.p2-pill-teacher'), 'Teacher labels must be styled and readable');
assert.ok(!logo.includes('data:image/png') && !logo.includes('<image'), 'Wordmark must be real vector paths, not a raster image');
assert.ok(setupCss.includes('max-width:650px'),'Mobile onboarding must remain responsive');
assert.ok(appCss.includes('max-width:var(--para-width)'),'App must be width-bounded');
assert.ok(appCss.includes('overscroll-behavior-x:none'),'Horizontal browser overscroll must be disabled');
assert.ok(appCss.includes('grid-template-columns:repeat(3,minmax(0,1fr))'),'Tabs must stay in their grid');
assert.ok(html.includes('id="fill"') && html.includes('id="users"'),'Beta counter must remain available');
assert.ok(html.includes('id="reminders"') && html.includes('id="courseStreams"'),'Profile settings must remain available');
assert.ok(html.includes('PARA_SCHEDULE_REQUEST'), 'Group switches must invalidate stale requests');
assert.ok(html.includes('if(!current())return'), 'Async responses must check the latest group request');
assert.ok(html.includes('String(saved.groupId)===String(id)'), 'Offline cache must be tied to RUZ ID');
assert.ok(html.includes('keyFor(gid)'), 'Cache writes must use resolved RUZ IDs');
assert.ok(html.includes('legacyMatches.length===1'), 'Unverified or ambiguous RUZ group must never be substituted');
assert.ok(!html.includes("if(!found && typeof PARA_STATIC_DATA==='undefined')"), 'Preview must not accept unknown group numbers');
assert.ok(html.includes("if(!found){notice.textContent='Группа не найдена"), 'Study profile must reject unknown group numbers');
assert.ok(html.includes('function jumpToSavedWeek()'), 'Uncovered dates need a usable saved-week action');
assert.ok(html.includes('./data/schedules/'), 'Timetables must load by individual group ID');
assert.ok(!html.includes('id="sourceBanner"'), 'Removed schedule banner must not return');
assert.ok(!html.includes('195.226.92.83'), 'Never publish the VPS address in static HTML');
assert.ok(!html.includes('DB_PASSWORD'), 'Never publish database environment keys');

const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const byId = new Map(catalog.groups.map(g => [String(g.id), String(g.number)]));
assert.ok(byId.size >= 150);
const status = JSON.parse(fs.readFileSync('data/status.json', 'utf8'));
const folder = 'data/schedules';
const files = fs.readdirSync(folder).filter(n => /^\d+\.json$/.test(n)).sort();
const published = [...new Set(status.cached_ids)].map(id => String(id) + '.json').sort();
assert.deepEqual(published, files, 'Status must match actual published files');
assert.equal(status.groups_cached_total, files.length);
const coveredInstitutions=new Set(status.cached_ids.map(id=>{
  const record=catalog.groups.find(g=>String(g.id)===String(id));
  return record&&String(record.institution_id);
}).filter(Boolean));
assert.ok(coveredInstitutions.size>=3,'Bounded mirror must reach several SAFU schools, not only the pilot school');
for(const gid of ['20727','20572','21096']) {
  const group=catalog.groups.find(g=>String(g.id)===gid);
  assert.ok(group, gid+': missing group in full catalogue');
  const file=path.join('data/schedules',gid+'.json');
  assert.ok(fs.existsSync(file),gid+': representative school snapshot missing');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(String(doc.group_number),group.number);
}
assert.ok(html.includes('function scheduleEmptyState()'), 'Uncached groups must have an explicit empty state');
assert.ok(html.includes('https://ruz.narfu.ru/?group='), 'Uncached groups must link to their official timetable');
assert.ok(html.includes('Array.isArray(R.periods)'), 'Uncovered dates must not be mistaken for no lessons');

let lessonCount = 0;
for (const name of files) {
  const id = path.basename(name, '.json');
  const obj = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
  assert.equal(String(obj.group_id), id, name + ': group ID mismatch');
  assert.equal(String(obj.group_number), byId.get(id), name + ': group number mismatch');
  assert.equal(obj.cached, true, name + ': must be verified snapshot');
  assert.ok(Array.isArray(obj.periods) && obj.periods.length > 0, name + ': periods missing');
  for (const period of obj.periods) {
    assert.ok(period.start <= period.end, name + ': invalid date range');
    assert.ok(Array.isArray(period.lessons) && period.lessons.length > 0, name + ': empty period');
    const seen = new Set();
    for (const lesson of period.lessons) {
      assert.ok(lesson.date >= period.start && lesson.date <= period.end, name + ': invalid lesson date');
      assert.ok(lesson.start < lesson.end, name + ': invalid lesson time');
      assert.ok(typeof lesson.subject === 'string' && lesson.subject.trim(), name + ': empty subject');
      const dedup = JSON.stringify(lesson);
      assert.ok(!seen.has(dedup), name + ': duplicate lesson row');
      seen.add(dedup);
      lessonCount++;
    }
  }
}
console.log('PARA validated:', files.length, 'groups and', lessonCount, 'lessons. UI scripts OK.');
