'use strict';

function argument(name) {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const index = process.argv.findIndex(value => value === exact || value.startsWith(prefix));
  if (index < 0) return '';
  if (process.argv[index].startsWith(prefix)) return process.argv[index].slice(prefix.length);
  return process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : 'true';
}

function booleanInput(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

async function main() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) throw new Error('persistent_storage_not_configured');

  const store = require('../src/store');
  const autopilot = require('../src/autopilot');
  if (!store.persistent) throw new Error('persistent_storage_not_configured');

  const sport = String(argument('sport') || process.env.AEGIS_DIRECT_SPORT || '').trim();
  const force = booleanInput(argument('force') || process.env.AEGIS_DIRECT_FORCE);
  const reason = String(argument('reason') || process.env.AEGIS_DIRECT_REASON || 'cloudflare direct validation').trim().slice(0, 160);
  if (sport && !autopilot.config.AUTO_SPORTS.includes(sport)) throw new Error('unsupported_sport');

  const result = await autopilot.tick({
    force,
    sports: sport ? [sport] : undefined,
    reason
  });
  const [status, storage] = await Promise.all([autopilot.status(), store.health()]);

  const failures = [];
  if (result?.ok !== true) failures.push('tick_failed');
  if (result?.persistent !== true) failures.push('tick_persistence_unconfirmed');
  if (store.persistent !== true || storage?.persistent !== true || storage?.ok !== true || storage?.backend !== 'supabase') failures.push('durable_storage_unavailable');
  if (status?.persistent !== true) failures.push('status_persistence_unconfirmed');
  if (status?.enabled !== true) failures.push('autopilot_disabled');
  if (status?.last_error) failures.push('autopilot_error');
  if (failures.length) throw new Error(failures.join(','));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    runs: Array.isArray(result.runs) ? result.runs.length : 0,
    graded: Number(result.graded || 0),
    persistent: true,
    last_success_at: status.last_success_at || null,
    usage: result.usage || status.usage || null
  })}\n`);
}

main().catch(error => {
  const allowed = new Set([
    'persistent_storage_not_configured',
    'unsupported_sport',
    'tick_failed',
    'tick_persistence_unconfirmed',
    'durable_storage_unavailable',
    'status_persistence_unconfirmed',
    'autopilot_disabled',
    'autopilot_error'
  ]);
  const codes = String(error?.message || '').split(',').filter(code => allowed.has(code));
  process.stderr.write(`${JSON.stringify({ ok: false, code: codes.join(',') || 'direct_autopilot_failed' })}\n`);
  process.exitCode = 1;
});
