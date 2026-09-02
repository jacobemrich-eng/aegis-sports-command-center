const pkg = require('../package.json');

const APP_VERSION = String(pkg.version || 'unknown');
const PLATFORM_NAME = 'AEGIS Sports Command Center';
const GOVERNANCE_VERSION = 'SB101 AEGIS v1.1 — September Daily-Use Freeze';

function env(name){
  const value = String(process.env[name] || '').trim();
  return value || null;
}

function deployment(){
  const render = env('RENDER') === 'true';

  return {
    provider: render ? 'render' : 'local',
    render,
    environment: env('NODE_ENV') || 'development',
    git_commit: env('RENDER_GIT_COMMIT'),
    git_branch: env('RENDER_GIT_BRANCH'),
    repo_slug: env('RENDER_GIT_REPO_SLUG'),
    service_id: env('RENDER_SERVICE_ID'),
    instance_id: env('RENDER_INSTANCE_ID'),
    external_url: env('RENDER_EXTERNAL_URL'),
    external_hostname: env('RENDER_EXTERNAL_HOSTNAME')
  };
}

function evaluateHealth({
  storage={},
  auto={},
  oddsReady=false,
  cfbdReady=false,
  autopilotSecretReady=false,
  releaseSports=[],
  deploy=deployment()
}={}){
  const failures = [];
  const warnings = [];
  const production = deploy.environment === 'production';

  if(!storage.ok)
    failures.push('storage_unhealthy');

  if(production && !storage.persistent)
    failures.push('persistent_storage_required');

  if(production && auto.enabled && !autopilotSecretReady)
    failures.push('autopilot_secret_missing');

  if(!oddsReady)
    warnings.push('sportsbook_feed_not_ready');

  if(
    releaseSports.includes('americanfootball_ncaaf') &&
    !cfbdReady
  )
    warnings.push('cfbd_feed_not_ready');

  if(auto.last_error)
    warnings.push('autopilot_last_run_error');

  if(deploy.render && !deploy.git_commit)
    warnings.push('render_commit_unknown');

  const status =
    failures.length
      ? 'RED'
      : warnings.length
        ? 'DEGRADED'
        : 'GREEN';

  return {
    status,
    ok: status !== 'RED',
    failures,
    warnings
  };
}

function buildHealth({
  storage={},
  auto={},
  oddsReady=false,
  cfbdReady=false,
  autopilotSecretReady=false,
  releaseSports=[],
  engineVersion='unknown'
}={}){
  const deploy = deployment();

  const gate = evaluateHealth({
    storage,
    auto,
    oddsReady,
    cfbdReady,
    autopilotSecretReady,
    releaseSports,
    deploy
  });

  return {
    ok: gate.ok,
    status: gate.status,

    platform: PLATFORM_NAME,

    release_version: APP_VERSION,
    engine_version: engineVersion,
    governance_version: GOVERNANCE_VERSION,

    generated_at: new Date().toISOString(),

    deploy,

    failures: gate.failures,
    warnings: gate.warnings
  };
}

module.exports = {
  APP_VERSION,
  PLATFORM_NAME,
  GOVERNANCE_VERSION,
  deployment,
  evaluateHealth,
  buildHealth
};
