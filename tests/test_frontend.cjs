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
const setup = fs.readFileSync('onboarding.js','utf8');
const setupCss = fs.readFileSync('onboarding.css','utf8');
new vm.Script(setup,{filename:'onboarding.js'});
assert.ok(html.includes('onboarding.js'), 'First-run setup script is not included');
assert.ok(html.includes('onboarding.css'), 'First-run setup CSS is not included');
assert.ok(html.includes("if(window.PARA_SETUP_DONE){loadInstitutions();tab('schedule');fetchSchedule()}"),
  'The default group must not be loaded before a student chooses their group');
assert.ok(setup.includes("para_onboarding_complete_v1"),'Onboarding must persist its completion');
assert.ok(setup.includes('S.settings.groupId=newId'),'Selection must save exact RUZ ID');
assert.ok(setup.includes('S.settings.streams'),'Per-subject stream choices must be stored');
assert.ok(setup.includes('groupData.filter'),'Client-side group lookup is required for speed');
assert.ok(setup.includes('window.PARA_SETUP_PAYLOAD'),'Setup should reuse the verified snapshot');
assert.ok(setup.includes('obCancel'),'Changing groups must be cancellable');
assert.ok(setupCss.includes('max-width:649px'),'Mobile sizing must be separate from desktop');
assert.ok(html.includes('PARA_SCHEDULE_REQUEST'), 'Group switches must invalidate stale requests');
assert.ok(html.includes('if(!current())return'), 'Async responses must check the latest group request');
assert.ok(html.includes('String(saved.groupId)===String(id)'), 'Offline cache must be tied to RUZ ID');
assert.ok(html.includes('keyFor(gid)'), 'Cache writes must use resolved RUZ IDs');
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
