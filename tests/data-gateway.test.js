const test = require('node:test');
const assert = require('node:assert/strict');
const gateway = require('../src/data-gateway');

test('shared board is fresh inside max age',()=>{
  const now=Date.parse('2026-09-11T12:00:00Z');
  const state={board_snapshots:{baseball_mlb:{
    odds_fetched_at:'2026-09-11T11:55:00Z',
    events:[{id:'g1'}]
  }}};
  const s=gateway.boardSnapshot(state,'baseball_mlb',{nowMs:now,maxAgeMs:10*60e3,maxStaleMs:60*60e3});
  assert.equal(s.available,true);
  assert.equal(s.fresh,true);
  assert.equal(s.stale,false);
  assert.equal(s.events.length,1);
});

test('shared board may be stale but still reusable',()=>{
  const now=Date.parse('2026-09-11T12:00:00Z');
  const state={board_snapshots:{baseball_mlb:{
    odds_fetched_at:'2026-09-11T11:30:00Z',
    events:[{id:'g1'}]
  }}};
  const s=gateway.boardSnapshot(state,'baseball_mlb',{nowMs:now,maxAgeMs:10*60e3,maxStaleMs:60*60e3});
  assert.equal(s.available,true);
  assert.equal(s.fresh,false);
  assert.equal(s.stale,true);
  assert.equal(gateway.shouldUseShared(s,'shared_first'),true);
});

test('snapshot beyond max stale is not reused',()=>{
  const now=Date.parse('2026-09-11T12:00:00Z');
  const state={board_snapshots:{baseball_mlb:{
    odds_fetched_at:'2026-09-11T05:00:00Z',
    events:[{id:'g1'}]
  }}};
  const s=gateway.boardSnapshot(state,'baseball_mlb',{nowMs:now,maxAgeMs:10*60e3,maxStaleMs:6*60*60e3});
  assert.equal(s.available,false);
});

test('browser force cannot bypass shared-first mode',()=>{
  assert.equal(gateway.publicProviderForceRequested(true,'shared_first'),false);
  assert.equal(gateway.publicProviderForceRequested(true,'legacy'),true);
});

test('invalid mode falls back to shared_first',()=>{
  const c=gateway.config({AEGIS_PUBLIC_ODDS_MODE:'anything'});
  assert.equal(c.mode,'shared_first');
});
