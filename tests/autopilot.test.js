const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'aegis-store-'));
process.env.AEGIS_DATA_DIR = tmp;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const store = require('../src/store');
const autopilot = require('../src/autopilot');

test('local store fallback persists state mutations for development', async () => {
  await store.mutate(async s => { s.autopilot.test_marker='ok'; return {done:true}; });
  store.resetMemory();
  const s=await store.load();
  assert.equal(s.autopilot.test_marker,'ok');
  assert.equal(store.persistent,false);
});

test('autopilot stable key separates markets and points', () => {
  const a=autopilot.stableKey({event_id:'g1',market:'spreads',selection:'A',point:-3.5});
  const b=autopilot.stableKey({event_id:'g1',market:'spreads',selection:'A',point:-4.5});
  const c=autopilot.stableKey({event_id:'g1',market:'h2h',selection:'A'});
  assert.notEqual(a,b);
  assert.notEqual(a,c);
});

test('production release defaults remain limited to validated MLB and NCAAF engines', () => {
  assert.deepEqual(new Set(autopilot.config.RELEASE_SPORTS),new Set(['baseball_mlb','americanfootball_ncaaf']));
});
