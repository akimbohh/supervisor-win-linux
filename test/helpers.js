// Shared test helpers. Every test file sets an isolated SUPERVISOR_DATA_DIR
// BEFORE requiring any app module (see each *.test.js header).
const fs = require('fs');
const os = require('os');
const path = require('path');

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sup-test-'));
}

function writeSettings(dataDir, obj) {
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(obj, null, 2));
}

// Extract a named top-level function's source out of a browser file (web/*.js)
// so it can be eval'd and unit-tested in Node without a DOM.
function extractFunction(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp('function ' + name + '\\(');
  const start = src.search(re);
  if (start < 0) throw new Error('function ' + name + ' not found in ' + file);
  // Walk braces from the first '{' after the signature.
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

module.exports = { tmpDataDir, writeSettings, extractFunction };
