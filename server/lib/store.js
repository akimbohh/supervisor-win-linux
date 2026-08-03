// Atomic JSON-file persistence for small bits of state.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Data dir defaults to <repo>/data but can be redirected with SUPERVISOR_DATA_DIR
// (useful for isolated tests and for running multiple instances on one host).
const DATA_DIR = process.env.SUPERVISOR_DATA_DIR
  ? path.resolve(process.env.SUPERVISOR_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function dataPath(name) {
  ensureDataDir();
  return path.join(DATA_DIR, name);
}

function readJSON(name, fallback) {
  try {
    const raw = fs.readFileSync(dataPath(name), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJSON(name, value) {
  ensureDataDir();
  const file = dataPath(name);
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readBuf(name) {
  try {
    return fs.readFileSync(dataPath(name));
  } catch (e) {
    return null;
  }
}

function writeBuf(name, buf) {
  ensureDataDir();
  const file = dataPath(name);
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

module.exports = { DATA_DIR, dataPath, readJSON, writeJSON, readBuf, writeBuf, ensureDataDir };
