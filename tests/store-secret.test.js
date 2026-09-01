const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function probe(env){
  const script = `
    global.fetch = async (url, options={}) => {
      process.stdout.write(JSON.stringify({url, headers: options.headers || {}}));
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    };
    const store = require('./src/store');
    store.load().catch(e => { console.error(e); process.exit(2); });
  `;
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    env: {...process.env, SUPABASE_URL:'https://example.supabase.co', ...env},
    encoding:'utf8'
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('modern Supabase sb_secret key uses apikey header without Bearer auth', () => {
  const out = probe({SUPABASE_SECRET_KEY:'sb_secret_test_value', SUPABASE_SERVICE_ROLE_KEY:''});
  assert.equal(out.headers.apikey, 'sb_secret_test_value');
  assert.equal(out.headers.Authorization, undefined);
});

test('legacy Supabase service_role JWT remains supported as fallback', () => {
  const out = probe({SUPABASE_SECRET_KEY:'', SUPABASE_SERVICE_ROLE_KEY:'legacy.jwt.value'});
  assert.equal(out.headers.apikey, 'legacy.jwt.value');
  assert.equal(out.headers.Authorization, 'Bearer legacy.jwt.value');
});
