// Platform adapter selector. This module and the files it requires are the ONLY
// places in the server that may branch on process.platform (§3.1). Everything
// else imports the resolved adapter and calls its methods.
const platform = process.platform;

let adapter;
if (platform === 'win32') adapter = require('./win32');
else if (platform === 'linux') adapter = require('./linux');
else adapter = require('./base'); // darwin / other → POSIX base (best-effort)

adapter.platform = platform;
module.exports = adapter;
