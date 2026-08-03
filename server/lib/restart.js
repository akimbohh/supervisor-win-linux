// Programmatic supervisor restart. Delegates to the platform adapter so the
// mechanism is correct per host: Windows respawns via start.bat; systemd/pm2
// hosts just exit and let the supervisor restart them; an unsupervised POSIX
// run re-execs itself after releasing the port (fixes P-1).
const platform = require('../platform');

function selfRestart() {
  return platform.selfRestart();
}

module.exports = { selfRestart };
