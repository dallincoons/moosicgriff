const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const INTERVAL_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const POLL_MS = 30 * 1000;
const DRAIN_VERSION = 1;

function paused(root, lane) {
  const folder = path.join(root, lane);
  const acknowledgement = path.join(folder, 'paused');
  if (fs.existsSync(path.join(folder, 'pause'))) {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(acknowledgement, 'idle\n');
    return true;
  }
  fs.rmSync(acknowledgement, { force: true });
  return false;
}

function calendarYear(now, timezone = 'America/Denver') {
  return Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: timezone }).format(now));
}

function readSettings(filename) {
  const settings = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!Array.isArray(settings.historical_years)
      || settings.historical_years.some(year => !Number.isInteger(year) || year < 1900 || year > 2100)
      || (settings.historical_repeat !== undefined && typeof settings.historical_repeat !== 'boolean')) {
    throw new Error('Expected historical_years: [year, ...] and optional historical_repeat: true/false');
  }
  return settings;
}

function plan(lane, state, settings, now, timezone) {
  const currentYear = calendarYear(now, timezone);
  if (lane === 'current') {
    if (state.running || state.year !== currentYear || !state.next_run || Date.parse(state.next_run) <= +now) {
      return { year: currentYear };
    }
    return null;
  }
  const years = [...new Set(settings.historical_years)].filter(year => year < currentYear);
  if (!years.length) return null;
  const jobs = state.jobs || {};
  // Repeat only when every configured eligible year has succeeded.
  const newCycle = settings.historical_repeat && years.every(year => jobs[year]?.exit_code === 0);
  const year = years.find(year => newCycle || (!jobs[year] || jobs[year].running
    || (jobs[year].exit_code !== 0 && Date.parse(jobs[year].retry_at || 0) <= +now)));
  return year === undefined ? null : { year, newCycle: Boolean(newCycle) };
}

function saveState(filename, state) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

async function tick(lane, state, settings, { now, run, save, timezone }) {
  const started = now();
  const job = plan(lane, state, settings, started, timezone);
  if (!job) return false;
  if (job.newCycle) state.jobs = {};
  const record = { year: job.year, running: true, started_at: started.toISOString() };
  if (lane === 'current') Object.assign(state, record);
  else (state.jobs ||= {})[job.year] = record;
  save(state);
  let result;
  try {
    result = await run(job.year);
  } catch (error) {
    result = { code: 1, error: error.message };
  }
  Object.assign(record, {
    running: false, finished_at: now().toISOString(), exit_code: result.code,
    log: result.log, error: result.error,
  });
  if (lane === 'current') {
    // A busy year lock gets retried soon; normal runs keep start-to-start cadence.
    record.next_run = new Date(result.code === 75 ? +now() + POLL_MS : +started + INTERVAL_MS).toISOString();
    Object.assign(state, record);
  } else {
    record.retry_at = new Date(+now() + (result.code === 75 ? POLL_MS : RETRY_MS)).toISOString();
  }
  save(state);
  return true;
}

function runCommand(year, { lane, root, entrypoint, onChild }) {
  fs.mkdirSync(path.join(root, 'locks'), { recursive: true });
  const folder = path.join(root, lane, String(year));
  fs.mkdirSync(folder, { recursive: true });
  const log = path.join(folder, new Date().toISOString().replaceAll(':', '-') + '.log');
  const descriptor = fs.openSync(log, 'ax', 0o600);
  const args = ['yearly.albums.missing', String(year), 'full'];
  fs.writeSync(descriptor, `[yearly-scheduler] command=node ${entrypoint} ${args.join(' ')}\n`);
  console.log(`[yearly-scheduler] lane=${lane} year=${year} start=${new Date().toISOString()} log=${log}`);
  return new Promise(resolve => {
    const child = spawn('flock', [
      '--no-fork', '--nonblock', '--conflict-exit-code', '75',
      path.join(root, 'locks', `year-${year}.lock`), process.execPath, entrypoint, ...args,
    ], { stdio: ['ignore', descriptor, descriptor], detached: true });
    onChild(child);
    let error;
    child.on('error', failure => { error = failure.message; });
    child.on('close', (code, signal) => {
      const exit = code ?? 1;
      fs.writeSync(descriptor, `\n[yearly-scheduler] exit=${exit} signal=${signal || 'none'} finished=${new Date().toISOString()}\n`);
      fs.closeSync(descriptor);
      onChild(null);
      console.log(`[yearly-scheduler] lane=${lane} year=${year} exit=${exit} log=${log}`);
      resolve({ code: exit, log, error });
    });
  });
}

async function main() {
  const lane = process.argv[2];
  if (!['current', 'historical'].includes(lane)) throw new Error('Usage: yearly-scheduler.cjs current|historical');
  const root = process.env.YEARLY_OUTPUT_DIR || '/app/tmp/yearly';
  const timezone = process.env.YEARLY_TIMEZONE || 'America/Denver';
  const filename = path.join(root, lane, 'state.json');
  let state = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {};
  let stopping = false;
  let activeChild;
  let wake;
  const stop = () => {
    stopping = true;
    if (activeChild) {
      try { process.kill(-activeChild.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (wake) wake();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log(`[yearly-scheduler] lane=${lane} interval_hours=12 timezone=${timezone}`);
  while (!stopping) {
    try {
      if (paused(root, lane)) {
        await new Promise(resolve => {
          const timer = setTimeout(() => { wake = null; resolve(); }, POLL_MS);
          wake = () => { clearTimeout(timer); wake = null; resolve(); };
        });
        continue;
      }
      const settings = lane === 'current' ? {} : readSettings(process.env.YEARLY_JOBS_FILE || '/app/job-config/jobs.json');
      // On a stop, leave running=true so a restart retries the interrupted run.
      await tick(lane, state, settings, {
        now: () => new Date(), timezone,
        save: value => { if (!stopping) saveState(filename, value); },
        run: year => runCommand(year, {
          lane, root, entrypoint: process.env.YEARLY_CLI_PATH || '/app/build/index.js',
          onChild: child => { activeChild = child; },
        }),
      });
    } catch (error) {
      console.error(`[yearly-scheduler] lane=${lane} error=${error.message}`);
    }
    if (!stopping) await new Promise(resolve => {
      const timer = setTimeout(() => { wake = null; resolve(); }, POLL_MS);
      wake = () => { clearTimeout(timer); wake = null; resolve(); };
    });
  }
}

module.exports = { DRAIN_VERSION, INTERVAL_MS, calendarYear, readSettings, plan, saveState, tick, runCommand, paused };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
