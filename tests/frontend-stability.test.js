const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const active = [
  'public/app.js',
  'public/app-v8_2.js',
  'public/app-v8_3.js',
  'public/app-v8_3_1.js',
  'public/app-v8_3_2.js',
  'public/app-v8_6.js'
];

test('all active browser bundles parse', () => {
  for (const rel of active) {
    const js = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotThrow(() => new vm.Script(js), rel);
  }
});

test('overlay bundles do not use aggressive sub-5-second polling', () => {
  for (const rel of active.slice(1)) {
    const js = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(
      js,
      /setInterval\s*\([^,]+,\s*(?:[0-4]?\d{0,3}|4\d{3})\s*\)/,
      rel
    );
  }
});

test('compatibility observers are scoped instead of watching the whole body', () => {
  for (const rel of ['public/app-v8_3_1.js','public/app-v8_3_2.js']) {
    const js = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(js, /observer\.observe\s*\(\s*document\.body/, rel);
  }
});

test('active overlay source contains no common mojibake literals', () => {
  const bad = ['Ã¢â¬â','Ã¢â¬â','Ã¢â¬Â¢','Ã¢â â','Ã¢â â','Ã¢â°Â¥','Ã¢â°Â¤','Ãâ','Ã¢Åâ','ÃÂ°','Ã¢â¬Â¦'];
  for (const rel of ['public/app-v8_3.js','public/app-v8_6.js']) {
    const js = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const token of bad) {
      assert.equal(js.includes(token), false, `${rel} contains ${token}`);
    }
  }
});

test('index declares UTF-8 and v8.7 cache-busted active overlays', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /v8\.7 â¢ STABILITY & INTEGRITY/);
  for (const name of ['app-v8_2.js','app-v8_3.js','app-v8_3_1.js','app-v8_3_2.js','app-v8_6.js']) {
    assert.match(html, new RegExp('/' + name.replace('.', '\\.') + '\\?v=8\\.7\\.0'));
  }
});
