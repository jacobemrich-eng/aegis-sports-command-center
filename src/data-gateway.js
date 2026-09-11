'use strict';

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_MAX_STALE_MS = 6 * 60 * 60 * 1000;
const MODES = new Set(['shared_first','legacy']);

function finiteMs(value,fallback){
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:fallback;
}

function config(env=process.env){
  const raw=String(env.AEGIS_PUBLIC_ODDS_MODE||'shared_first').trim().toLowerCase();
  return {
    mode:MODES.has(raw)?raw:'shared_first',
    maxAgeMs:finiteMs(env.AEGIS_SHARED_BOARD_MAX_AGE_MS,DEFAULT_MAX_AGE_MS),
    maxStaleMs:finiteMs(env.AEGIS_SHARED_BOARD_MAX_STALE_MS,DEFAULT_MAX_STALE_MS)
  };
}

function boardSnapshot(state,sport,{nowMs=Date.now(),maxAgeMs=DEFAULT_MAX_AGE_MS,maxStaleMs=DEFAULT_MAX_STALE_MS}={}){
  const row=state?.board_snapshots?.[sport]||null;
  const events=Array.isArray(row?.events)?row.events:[];
  const fetchedAt=row?.odds_fetched_at||row?.analyzed_at||null;
  const t=fetchedAt?new Date(fetchedAt).getTime():NaN;
  const ageMs=Number.isFinite(t)?Math.max(0,nowMs-t):Infinity;
  const available=events.length>0&&Number.isFinite(ageMs)&&ageMs<=maxStaleMs;
  const fresh=available&&ageMs<=maxAgeMs;
  return {
    available,
    fresh,
    stale:available&&!fresh,
    events,
    fetched_at:fetchedAt,
    age_ms:Number.isFinite(ageMs)?ageMs:null,
    source:'persistent_shared_board'
  };
}

function shouldUseShared(snapshot,mode='shared_first'){
  return mode==='shared_first'&&!!snapshot?.available;
}

function publicProviderForceRequested(queryForce,mode='shared_first'){
  return mode==='legacy'&&!!queryForce;
}

module.exports={
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_STALE_MS,
  config,
  boardSnapshot,
  shouldUseShared,
  publicProviderForceRequested
};
