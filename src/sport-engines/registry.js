'use strict';

const nfl = require('./adapters/nfl-adapter');
const ncaaf = require('./adapters/ncaaf-adapter');
const mlb = require('./adapters/mlb-adapter');

const ADAPTERS = new Map([
  [nfl.SPORT_KEY, nfl],
  [ncaaf.SPORT_KEY, ncaaf],
  [mlb.SPORT_KEY, mlb]
]);

function adapterFor(sport) {
  const adapter = ADAPTERS.get(String(sport || ''));
  if (!adapter) throw new Error(`No sport-engine adapter registered for ${sport || 'missing sport'}`);
  return adapter;
}

function adapt(sport, raw, context) {
  const adapter = adapterFor(sport);
  if (adapter.SPORT_KEY !== sport) throw new Error(`Sport adapter routing violation: ${sport}`);
  return adapter.adapt(raw, { ...(context || {}), sport });
}

function registrations() {
  return Array.from(ADAPTERS, ([sport, adapter]) => ({ sport, adapter: adapter.SPORT_KEY }));
}

module.exports = { adapterFor, adapt, registrations };
