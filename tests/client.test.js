const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('browser script parses', () => {
  const js = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(js));
});

test('period-market cards use period projection and audit storage', () => {
  const js = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  assert.match(js, /p\.market_period_innings\?'F'\+p\.market_period_innings\+' projection':'Projection'/);
  assert.match(js, /p\.market_projection_score\|\|p\.projection\?\.projected_score/);
});
