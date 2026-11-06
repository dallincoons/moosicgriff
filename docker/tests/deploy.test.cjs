const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { paused } = require('../yearly-scheduler.cjs');
const { idle } = require('../deploy-state.cjs');

test('deployment waits for both worker acknowledgements, including an empty historical lane', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-drain-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(idle(root), false);
  for (const lane of ['current', 'historical']) {
    fs.mkdirSync(path.join(root, lane));
    fs.writeFileSync(path.join(root, lane, 'pause'), '');
  }
  assert.equal(paused(root, 'current'), true);
  assert.equal(idle(root), false);
  assert.equal(paused(root, 'historical'), true);
  assert.equal(idle(root), true);
  fs.writeFileSync(path.join(root, 'current/state.json'), JSON.stringify({ running: true }));
  assert.equal(idle(root), false);
  fs.writeFileSync(path.join(root, 'current/state.json'), JSON.stringify({ running: false }));
  fs.writeFileSync(path.join(root, 'historical/state.json'), JSON.stringify({ jobs: { 2025: { running: true } } }));
  assert.equal(idle(root), false);
});

test('removing the pause request resumes the worker and clears stale acknowledgements', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'current'));
  fs.writeFileSync(path.join(root, 'current/pause'), '');
  assert.equal(paused(root, 'current'), true);
  fs.rmSync(path.join(root, 'current/pause'));
  assert.equal(paused(root, 'current'), false);
  assert.equal(fs.existsSync(path.join(root, 'current/paused')), false);
});

test('initial legacy image can drain only after its recorded command finishes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-legacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'current'));
  fs.writeFileSync(path.join(root, 'current/state.json'), JSON.stringify({ running: true }));
  assert.equal(idle(root, true), false);
  fs.writeFileSync(path.join(root, 'current/state.json'), JSON.stringify({ running: false }));
  assert.equal(idle(root, true), true);
});
