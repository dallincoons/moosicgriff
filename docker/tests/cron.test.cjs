const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(t, jobs, extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moosicgraff-cron-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const run = path.join(root, 'run');
  const bin = path.join(root, 'bin');
  const cronFile = path.join(root, 'crontab');
  fs.mkdirSync(path.join(app, 'docker'), { recursive: true });
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  // Exercise setup without starting a daemon or requiring system directories.
  // The flock stub tests runner behavior; real Linux locking needs Docker.
  fs.writeFileSync(path.join(bin, 'cron'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'flock'), '#!/bin/sh\nexit "${TEST_FLOCK_STATUS:-0}"\n', { mode: 0o755 });
  for (const name of ['job-cron.sh', 'job-cron-exec.sh']) {
    const source = fs.readFileSync(path.join(__dirname, '..', name), 'utf8')
      .replaceAll('/etc/cron.d/moosicgraff', cronFile)
      .replaceAll('/run/moosicgraff', run)
      .replaceAll('/app', app);
    fs.writeFileSync(path.join(app, 'docker', name), source, { mode: 0o755 });
  }
  const jobsFile = path.join(root, 'jobs.conf');
  fs.writeFileSync(jobsFile, jobs);
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    CRON_JOBS_FILE: jobsFile,
    CRON_LOG_FILE: path.join(app, 'logs', 'cron.log'),
    NODE_PATH: path.join(app, 'build'),
    GOOSE_DBSTRING: "postgres://user:p'a$s@db/name\nsecond line",
    ...extraEnv,
  };
  const setup = spawnSync('/bin/sh', [path.join(app, 'docker', 'job-cron.sh')], {
    env, encoding: 'utf8', timeout: 5000,
  });
  return {
    app, run, cronFile, setup, env,
    execute(id = '1') {
      // Simulate cron's minimal environment and a different working directory.
      return spawnSync('/bin/sh', [path.join(app, 'docker', 'job-cron-exec.sh'), id], {
        cwd: root, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000,
      });
    },
    log() { return fs.readFileSync(env.CRON_LOG_FILE, 'utf8'); },
  };
}

test('jobs preserve quoted arguments, percent URLs, environment and relative output paths', t => {
  const command = `node probe.cjs "Artist's Label" "two  spaces" 'https://example.org/a%2Fb'`;
  const f = fixture(t, `# comment\n\n*/5 * * * * ${command}\n0 2 * * * exit 0`);
  assert.equal(f.setup.status, 0, f.setup.stderr);
  assert.equal(fs.readFileSync(path.join(f.run, 'job-1.sh'), 'utf8'), command + '\n');
  assert.match(fs.readFileSync(f.cronFile, 'utf8'), /\*\/5 \* \* \* \* root .*job-cron-exec.sh 1\n/);
  assert.ok(!fs.readFileSync(f.cronFile, 'utf8').includes('%2F'));
  assert.equal(fs.statSync(path.join(f.run, 'environment')).mode & 0o777, 0o600);
  fs.mkdirSync(path.join(f.app, 'build'));
  fs.writeFileSync(path.join(f.app, 'build', 'config.js'), 'module.exports = 42;');
  fs.writeFileSync(path.join(f.app, 'probe.cjs'), `
    require('node:fs').writeFileSync('tmp/result.json', JSON.stringify({
      args: process.argv.slice(2), db: process.env.GOOSE_DBSTRING, config: require('config')
    }));
  `);
  const result = f.execute();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.app, 'tmp', 'result.json'))), {
    args: ["Artist's Label", 'two  spaces', 'https://example.org/a%2Fb'],
    db: f.env.GOOSE_DBSTRING, config: 42,
  });
  assert.match(f.log(), /job=1 end=.* exit=0/);
});

test('runner logs and returns a failed command exit code', t => {
  const f = fixture(t, '* * * * * exit 7\n');
  assert.equal(f.setup.status, 0, f.setup.stderr);
  assert.equal(f.execute().status, 7);
  assert.match(f.log(), /exit=7/);
});

test('runner skips a job when flock reports an active run', t => {
  const f = fixture(t, '* * * * * touch tmp/should-not-exist\n', { TEST_FLOCK_STATUS: '1' });
  assert.equal(f.setup.status, 0, f.setup.stderr);
  assert.equal(f.execute().status, 0);
  assert.match(f.log(), /skipped=already_running/);
  assert.equal(fs.existsSync(path.join(f.app, 'tmp', 'should-not-exist')), false);
});

test('comment-only file uses the configured single-job fallback', t => {
  const f = fixture(t, '# no active jobs\n', { CRON_SCHEDULE: '15 2 * * *', CRON_COMMAND: 'exit 0' });
  assert.equal(f.setup.status, 0, f.setup.stderr);
  assert.match(fs.readFileSync(f.cronFile, 'utf8'), /15 2 \* \* \* root /);
  assert.equal(fs.readFileSync(path.join(f.run, 'job-1.sh'), 'utf8'), 'exit 0\n');
});

test('malformed jobs fail setup instead of falling back to artist scraping', t => {
  const f = fixture(t, 'not a valid job\n');
  assert.equal(f.setup.status, 1);
  assert.match(f.setup.stderr, /invalid job/);
});
