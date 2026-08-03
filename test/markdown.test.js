const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { extractFunction } = require('./helpers');

// Load renderMarkdown out of the browser file and run it in a DOM-less context.
global.window = {};
const fnSrc = extractFunction(path.join(__dirname, '..', 'web', 'views', 'files.js'), 'renderMarkdown');
eval(fnSrc + '\nglobal.__renderMarkdown = renderMarkdown;');
const render = global.__renderMarkdown;

// A rendered fragment is "live-dangerous" only if it contains a REAL (unescaped)
// dangerous tag, a javascript: href, or a live on*= handler outside escaped text.
function live(html) {
  const stripped = html.replace(/&lt;[^]*?&gt;/g, '');
  return /<\s*(img|script|svg|iframe|object|embed|link|style|meta|base|form)\b/i.test(html)
    || /href\s*=\s*"javascript:/i.test(html)
    || /\son\w+\s*=/i.test(stripped);
}

const PAYLOADS = [
  '# Hi <img src=x onerror=alert(1)>',
  '<script>alert(2)</script>',
  '[click](javascript:alert(3))',
  '> quote <b>x</b>',
  '```js\nconst s = "<img onerror=1>";\n```',
  'text <svg onload=alert(4)> more',
  '<a href="javascript:alert(5)">x</a>',
  '**bold** <iframe src=//evil></iframe>',
  '<body onload=alert(6)>',
  '![img](https://x/y.png"onerror="alert(7))',
];

test('markdown renderer neutralizes every XSS payload', () => {
  for (const p of PAYLOADS) {
    const out = render(p);
    assert.ok(!live(out), 'payload produced live markup: ' + JSON.stringify(p) + ' -> ' + out);
  }
});

test('markdown still renders benign formatting', () => {
  assert.match(render('# Title'), /<h1>Title<\/h1>/);
  assert.match(render('**b**'), /<strong>b<\/strong>/);
  assert.match(render('[ok](https://example.com)'), /href="https:\/\/example\.com"/);
});
