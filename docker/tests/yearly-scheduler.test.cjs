const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { INTERVAL_MS, calendarYear, plan, readSettings, saveState, tick, runCommand } = require('../yearly-scheduler.cjs');

const date = value => new Date(value);
const start = date('2026-11-06T12:00:00Z');
const timezone = 'America/Denver';
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yearly-scheduler-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test('current year runs immediately and changes automatically in the configured timezone', () => {
  assert.deepEqual(plan('current', {}, {}, start, timezone), { year: 2026 });
  assert.equal(calendarYear(date('2027-01-01T01:00:00Z'), timezone), 2026);
  assert.equal(calendarYear(date('2027-01-01T08:00:00Z'), timezone), 2027);
  const state = { year: 2026, next_run: '2027-01-01T18:00:00Z' };
  assert.deepEqual(plan('current', state, {}, date('2027-01-01T08:00:00Z'), timezone), { year: 2027 });
});

test('current cadence is 12 hours from start and survives a scheduler restart', async t => {
  const filename = path.join(fixture(t), 'current/state.json');
  let clock = start;
  const state = {};
  await tick('current', state, {}, {
    timezone, now: () => clock, save: value => saveState(filename, value),
    run: async year => { assert.equal(year, 2026); clock = date(+start + 2 * 3600000); return { code: 0 }; },
  });
  const restored = JSON.parse(fs.readFileSync(filename));
  assert.equal(Date.parse(restored.next_run), +start + INTERVAL_MS);
  assert.equal(plan('current', restored, {}, date(+start + 11 * 3600000), timezone), null);
  assert.deepEqual(plan('current', restored, {}, date(+start + INTERVAL_MS), timezone), { year: 2026 });
});

test('an interrupted run is retried on restart; overdue ticks coalesce into one run', () => {
  assert.deepEqual(plan('current', { running: true, year: 2026, next_run: '2026-11-07T00:00:00Z' }, {}, start, timezone), { year: 2026 });
  assert.deepEqual(plan('current', { year: 2026, next_run: '2026-11-01T00:00:00Z' }, {}, start, timezone), { year: 2026 });
});

test('historical years retain configured order, remove duplicates, and exclude current/future years', () => {
  const settings = { historical_years: [2026, 2027, 2021, 2021, 2019] };
  assert.equal(plan('historical', {}, settings, start, timezone).year, 2021);
  assert.equal(plan('historical', { jobs: { 2021: { exit_code: 0 } } }, settings, start, timezone).year, 2019);
  assert.equal(plan('historical', {}, { historical_years: [2026, 2027] }, start, timezone), null);
});

test('historical years run once by default and repeating mode begins another sequential cycle', () => {
  const state = { jobs: { 2025: { exit_code: 0 }, 2024: { exit_code: 0 } } };
  const settings = { historical_years: [2025, 2024] };
  assert.equal(plan('historical', state, settings, start, timezone), null);
  assert.deepEqual(plan('historical', state, { ...settings, historical_repeat: true }, start, timezone), { year: 2025, newCycle: true });
});

test('failures let later historical years proceed while preserving a retry', async () => {
  const state = {};
  const settings = { historical_years: [2025, 2024] };
  await tick('historical', state, settings, {
    timezone, now: () => start, save() {}, run: async () => { throw new Error('network unavailable'); },
  });
  assert.equal(state.jobs[2025].exit_code, 1);
  assert.equal(state.jobs[2025].error, 'network unavailable');
  assert.equal(plan('historical', state, settings, start, timezone).year, 2024);
  assert.equal(plan('historical', state, settings, date(+start + 3600000), timezone).year, 2025);
});

test('historical queue is sequential while a current-year command can run alongside it', async () => {
  let releaseCurrent;
  const currentGate = new Promise(resolve => { releaseCurrent = resolve; });
  const seen = [];
  const dependencies = { timezone, now: () => start, save() {} };
  const current = tick('current', {}, {}, { ...dependencies, run: async year => {
    seen.push(`start-${year}`); await currentGate; seen.push(`end-${year}`); return { code: 0 };
  } });
  const state = {};
  const settings = { historical_years: [2025, 2024] };
  const run = async year => { seen.push(`start-${year}`); await Promise.resolve(); seen.push(`end-${year}`); return { code: 0 }; };
  await tick('historical', state, settings, { ...dependencies, run });
  await tick('historical', state, settings, { ...dependencies, run });
  releaseCurrent();
  await current;
  assert.deepEqual(seen, ['start-2026', 'start-2025', 'end-2025', 'start-2024', 'end-2024', 'end-2026']);
});

test('state is recorded before launch and busy locks retry soon rather than skipping 12 hours', async () => {
  const state = {};
  let saved;
  await tick('current', state, {}, {
    timezone, now: () => start, save: value => { saved = structuredClone(value); },
    run: async () => { assert.equal(saved.running, true); return { code: 75 }; },
  });
  assert.equal(state.running, false);
  assert.equal(Date.parse(state.next_run), +start + 30000);
});

test('empty historical queue stays idle; malformed configuration is rejected', t => {
  assert.equal(plan('historical', {}, { historical_years: [] }, start, timezone), null);
  const filename = path.join(fixture(t), 'jobs.json');
  for (const settings of [{ historical_years: ['2025'] }, { historical_years: [2025], historical_repeat: 'yes' }]) {
    fs.writeFileSync(filename, JSON.stringify(settings));
    assert.throws(() => readSettings(filename));
  }
});

test('Linux year locks prevent duplicate years while allowing different years together', { skip: process.platform !== 'linux' }, async t => {
  const root = fixture(t);
  const entrypoint = path.join(root, 'fixture.cjs');
  fs.writeFileSync(entrypoint, `
    const fs = require('node:fs');
    const year = process.argv[3];
    fs.writeFileSync(${JSON.stringify(root)} + '/started-' + year, 'yes');
    console.log(JSON.stringify(process.argv.slice(2)));
    if (year === '2025') setTimeout(() => {}, 500);
  `);
  const first = runCommand(2025, { root, entrypoint, lane: 'historical', onChild() {} });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(path.join(root, 'started-2025'))) {
    assert.ok(Date.now() < deadline, 'first command did not start');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const duplicate = await runCommand(2025, { root, entrypoint, lane: 'current', onChild() {} });
  assert.equal(duplicate.code, 75);
  const different = await runCommand(2024, { root, entrypoint, lane: 'current', onChild() {} });
  assert.equal(different.code, 0);
  assert.match(fs.readFileSync(different.log, 'utf8'), /\["yearly.albums.missing","2024","full"\]/);
  assert.equal((await first).code, 0);
});
