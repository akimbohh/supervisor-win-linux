// Programmatic supervisor restart. Spawns start.bat in a new console window
// (detached), then exits the current process so the new boot can bind the port.
// start.bat reads data/supervisor.pid and taskkills any leftover process.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { dataPath } = require('./store');

function selfRestart() {
  const repoRoot = path.join(__dirname, '..', '..');
  const startBat = path.join(repoRoot, 'start.bat');
  if (!fs.existsSync(startBat)) {
    throw new Error('start.bat not found at ' + startBat);
  }
  spawn('cmd', ['/c', 'start', '""', '/D', repoRoot, startBat], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref();
  // Let the HTTP response flush, then exit. start.bat in the new console will
  // taskkill us if we're still alive.
  setTimeout(() => {
    try { fs.unlinkSync(dataPath('supervisor.pid')); } catch (e) {}
    process.exit(0);
  }, 500);
}

module.exports = { selfRestart };
