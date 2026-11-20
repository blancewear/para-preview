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
