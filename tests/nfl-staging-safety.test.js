'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const safety = require('../src/deployment-safety');
const ROOT = path.join(__dirname, '..');

function safeEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    AEGIS_DEPLOYMENT_ENV: 'nfl-shadow-staging',
    AEGIS_STATE_ID: 'nfl-shadow-staging',
    AEGIS_AUTOPILOT_ENABLED: 'false',
    AEGIS_RELEASE_SPORTS: 'none',
    NFL_SIM_ENABLED: 'true',
    NFL_SIM_SHADOW_ONLY: 'true',
    AEGIS_NEW_ENGINE_AUTO_RELEASE: 'false',
    ...overrides
  };
}

test('NFL staging identity is isolated and cannot release production output', () => {
  const identity = safety.assertStagingConfiguration(safeEnv());
  assert.equal(identity.environment, 'nfl-shadow-staging');
  assert.equal(identity.state_id, 'nfl-shadow-staging');
  assert.equal(identity.shadow_only, true);
  assert.equal(identity.production_release_allowed, false);
  assert.equal(identity.autopilot_enabled, false);
  assert.equal(identity.auto_release_enabled, false);
});

test('NFL staging refuses main state, Autopilot, automatic release, or live release sports', () => {
  assert.throws(() => safety.assertStagingConfiguration(safeEnv({ AEGIS_STATE_ID: 'main' })), /must be nfl-shadow-staging/);
  assert.throws(() => safety.assertStagingConfiguration(safeEnv({ AEGIS_AUTOPILOT_ENABLED: 'true' })), /must be false/);
  assert.throws(() => safety.assertStagingConfiguration(safeEnv({ AEGIS_NEW_ENGINE_AUTO_RELEASE: 'true' })), /must be false/);
  assert.throws(() => safety.assertStagingConfiguration(safeEnv({ AEGIS_RELEASE_SPORTS: 'baseball_mlb' })), /live sport/);
});

test('staging blueprint is separate while production Render settings remain unchanged', () => {
  const staging = fs.readFileSync(path.join(ROOT, 'render-nfl-shadow-staging.yaml'), 'utf8');
  assert.match(staging, /name: aegis-nfl-shadow-staging/);
  assert.match(staging, /branch: feat\/nfl-integration/);
  assert.match(staging, /key: AEGIS_STATE_ID\s+value: nfl-shadow-staging/);
  assert.match(staging, /key: AEGIS_AUTOPILOT_ENABLED\s+value: "false"/);
  assert.match(staging, /key: AEGIS_RELEASE_SPORTS\s+value: none/);
  assert.match(staging, /key: AEGIS_NEW_ENGINE_AUTO_RELEASE\s+value: "false"/);

  const production = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
  assert.match(production, /key: AEGIS_STATE_ID\s+value: main/);
  assert.match(production, /key: AEGIS_AUTOPILOT_ENABLED\s+value: "true"/);
  assert.match(production, /value: baseball_mlb,americanfootball_ncaaf/);
});

test('Supabase state storage resolves the staging row instead of the production row', () => {
  const probe = spawnSync(process.execPath, ['-e', "process.stdout.write(require('./src/store').STATE_ID)"], {
    cwd: ROOT,
    env: { ...process.env, AEGIS_STATE_ID: 'nfl-shadow-staging' },
    encoding: 'utf8'
  });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, 'nfl-shadow-staging');
  const source = fs.readFileSync(path.join(ROOT, 'src', 'store.js'), 'utf8');
  assert.match(source, /aegis_state\?id=eq\.\$\{encodeURIComponent\(STATE_ID\)\}/);
  assert.match(source, /payload=\{id:STATE_ID/);
});

test('workflow endpoint is configurable, missing publish config fails, and schedules are opt-in', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'nfl-shadow-validation.yml'), 'utf8');
  assert.match(workflow, /AEGIS_SHADOW_ENDPOINT: \$\{\{ vars\.AEGIS_SHADOW_ENDPOINT \}\}/);
  assert.match(workflow, /test -n "\$AEGIS_SHADOW_ENDPOINT"/);
  assert.match(workflow, /aegis_nfl_staging_readiness\.py/);
  assert.match(workflow, /NFL_SHADOW_SCHEDULED_PUBLISH/);
  assert.doesNotMatch(workflow, /aegis-sports-command-center\.onrender\.com/);
});

test('server exposes staging identity and protected non-mutating readiness', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(source, /assertStagingConfiguration\(process\.env\)/);
  assert.match(source, /GET'&&u\.pathname==='\/api\/shadow\/readiness'/);
  assert.match(source, /Shadow readiness authorization failed/);
  assert.match(source, /persistent staging storage is unhealthy/);
});
