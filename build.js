// Vendor build: copy prebuilt JS/CSS from node_modules into web/vendor/ at install time.
// Idempotent; safe to re-run. If a source file is missing (e.g. user hasn't run npm install
// yet, or an optional dep failed), we log a warning and continue.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'web', 'vendor');

function copy(src, dst) {
  const from = path.join(NM, src);
  const to = path.join(OUT, dst);
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn('[build] missing: ' + src + ' (skipped)');
    } else {
      console.warn('[build] failed copy ' + src + ': ' + e.message);
    }
    return false;
  }
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // CodeMirror 5 (UMD prebuilt bundle, no build step needed)
  copy('codemirror/lib/codemirror.js', 'codemirror/codemirror.js');
  copy('codemirror/lib/codemirror.css', 'codemirror/codemirror.css');
  for (const m of [
    'addon/edit/closebrackets.js', 'addon/edit/matchbrackets.js',
    'addon/search/search.js', 'addon/search/searchcursor.js',
    'addon/dialog/dialog.js', 'addon/dialog/dialog.css',
    'addon/selection/active-line.js',
    'addon/comment/comment.js',
    'addon/scroll/simplescrollbars.js', 'addon/scroll/simplescrollbars.css',
    'addon/mode/simple.js',
    'mode/javascript/javascript.js',
    'mode/xml/xml.js', 'mode/css/css.js', 'mode/htmlmixed/htmlmixed.js',
    'mode/markdown/markdown.js', 'mode/yaml/yaml.js',
    'mode/python/python.js', 'mode/rust/rust.js',
    'mode/shell/shell.js', 'mode/sql/sql.js',
    'mode/clike/clike.js', 'mode/go/go.js',
    'theme/material-darker.css',
  ]) {
    copy('codemirror/' + m, 'codemirror/' + m);
  }

  // xterm.js
  copy('xterm/lib/xterm.js', 'xterm/xterm.js');
  copy('xterm/css/xterm.css', 'xterm/xterm.css');
  copy('xterm-addon-fit/lib/xterm-addon-fit.js', 'xterm/xterm-addon-fit.js');

  // PDF.js
  copy('pdfjs-dist/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs');
  copy('pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs');

  // highlight.js — single common bundle (covers common languages for previews)
  copy('highlight.js/lib/index.js', 'highlight/index.js');
  // For browser, prefer prebuilt:
  // We try multiple known locations across versions.
  const hlTried = [
    ['highlight.js/lib/common.js', 'highlight/common.js'],
    ['highlight.js/styles/atom-one-dark.css', 'highlight/atom-one-dark.css'],
    ['highlight.js/styles/github.css', 'highlight/github.css'],
  ];
  for (const [s, d] of hlTried) copy(s, d);

  console.log('[build] vendor assets prepared in web/vendor/');
}

main();
