const fs = require('node:fs');
const path = require('node:path');

function idle(root, legacy = false) {
  for (const lane of ['current', 'historical']) {
    const filename = path.join(root, lane, 'state.json');
    const state = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename)) : {};
    if (state.running || Object.values(state.jobs || {}).some(job => job.running)) return false;
    if (!legacy && !fs.existsSync(path.join(root, lane, 'paused'))) return false;
  }
  return true;
}

module.exports = { idle };
if (require.main === module) process.exitCode = idle('output/yearly', process.argv.includes('--legacy')) ? 0 : 1;
