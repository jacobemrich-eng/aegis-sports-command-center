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
    const js = fs.readFileSync(
      path.join(ROOT, rel),
      'utf8'
    );

    assert.doesNotThrow(
      () => new vm.Script(js),
      rel
    );
  }
});

test(
  'overlay bundles do not use aggressive sub-5-second polling',
  () => {
    for (const rel of active.slice(1)) {
      const js = fs.readFileSync(
        path.join(ROOT, rel),
        'utf8'
      );

      assert.doesNotMatch(
        js,
        /setInterval\s*\([^,]+,\s*(?:[0-4]?\d{0,3}|4\d{3})\s*\)/,
        rel
      );
    }
  }
);

test(
  'compatibility observers are scoped instead of watching the whole body',
  () => {
    for (
      const rel of [
        'public/app-v8_3_1.js',
        'public/app-v8_3_2.js'
      ]
    ) {
      const js = fs.readFileSync(
        path.join(ROOT, rel),
        'utf8'
      );

      assert.doesNotMatch(
        js,
        /observer\.observe\s*\(\s*document\.body/,
        rel
      );
    }
  }
);

test(
  'all served UI source is free of mojibake markers and control-byte artifacts',
  () => {
    const sources = [
      ...active,
      'public/index.html'
    ];

    const bad =
      /[ÃÂ�â]|[\u0080-\u009f]/u;

    for (const rel of sources) {
      const text = fs.readFileSync(
        path.join(ROOT, rel),
        'utf8'
      );

      assert.doesNotMatch(
        text,
        bad,
        rel
      );
    }
  }
);

test(
  'presentation symbols render as intended UTF-8 characters',
  () => {
    const gates = fs.readFileSync(
      path.join(
        ROOT,
        'public/app-v8_6.js'
      ),
      'utf8'
    );

    const intel = fs.readFileSync(
      path.join(
        ROOT,
        'public/app-v8_3.js'
      ),
      'utf8'
    );

    assert.match(
      gates,
      /WATCH • /
    );

    assert.match(
      gates,
      /≥/
    );

    assert.match(
      gates,
      /✓/
    );

    assert.match(
      intel,
      /QUALIFIED — REDUCED EXPOSURE/
    );

    assert.match(
      intel,
      / → /
    );

    assert.match(
      intel,
      / • /
    );
  }
);

test(
  'index declares UTF-8, v8.9.2 true-failover operations shell, and v8.8 core bundle cache keys',
  () => {
    const html = fs.readFileSync(
      path.join(
        ROOT,
        'public/index.html'
      ),
      'utf8'
    );

    assert.match(
      html,
      /<meta charset="utf-8">/i
    );

    assert.match(
      html,
      /v8\.9\.2 • TRUE FAILOVER/
    );

    for (
      const name of [
        'app.js',
        'app-v8_2.js',
        'app-v8_3.js',
        'app-v8_3_1.js',
        'app-v8_3_2.js',
        'app-v8_6.js'
      ]
    ) {
      assert.match(
        html,
        new RegExp(
'/' +
name.replace(
  '.',
  '\\.'
) +
'\\?v=8\\.8\\.0'
        )
      );
    }
  }
);
