const engine = require('./engine');
const store = require('./store');

const ENABLED = String(process.env.AEGIS_AUTOPILOT_ENABLED || 'true').toLowerCase() !== 'false';
const TIMEZONE = String(process.env.AEGIS_TIMEZONE || 'America/New_York');
const AUTO_SPORTS = String(process.env.AEGIS_AUTOPILOT_SPORTS || 'baseball_mlb,americanfootball_ncaaf').split(',').map(s=>s.trim()).filter(Boolean);
const RELEASE_SPORTS = new Set(String(process.env.AEGIS_RELEASE_SPORTS || 'baseball_mlb,americanfootball_ncaaf').split(',').map(s=>s.trim()).filter(Boolean));
const DAILY_BUDGET = Math.max(2, Number(process.env.AEGIS_DAILY_ODDS_CREDIT_BUDGET || process.env.AEGIS_DAILY_ODDS_CALL_BUDGET || 18));
const MONTHLY_BUDGET = Math.max(30, Number(process.env.AEGIS_MONTHLY_ODDS_CREDIT_BUDGET || process.env.AEGIS_MONTHLY_ODDS_CALL_BUDGET || 450));
const MAX_FULL_ODDS_REFRESHES = Math.max(1, Math.min(4, Number(process.env.AEGIS_MAX_FULL_ODDS_REFRESHES_PER_SPORT_DAY || 2)));
const MAX_TARGETED_REFRESHES = Math.max(0, Math.min(8, Number(process.env.AEGIS_MAX_TARGETED_REFRESHES_PER_SPORT_DAY || 3)));
const AUTO_DEEP_CREDIT_CAP = Math.max(0, Math.min(6, Number(process.env.AEGIS_AUTOPILOT_DEEP_CREDIT_CAP || 3)));
const AUTO_DEEP_WINDOW_HOURS = Math.max(1, Math.min(12, Number(process.env.AEGIS_AUTOPILOT_DEEP_WINDOW_HOURS || 4)));
const MAX_SPORTS_PER_TICK = Math.max(1, Math.min(5, Number(process.env.AEGIS_MAX_SPORTS_PER_TICK || 2)));
const AUTO_LOCK_MINUTES = Math.max(5, Math.min(120, Number(process.env.AEGIS_AUTO_LOCK_MINUTES || 30)));
const GRADE_DELAY_HOURS = Math.max(1, Math.min(12, Number(process.env.AEGIS_GRADE_DELAY_HOURS || 2)));

const SPORT_MONTHS = {
  baseball_mlb: new Set([3,4,5,6,7,8,9,10,11]),
  baseball_kbo: new Set([3,4,5,6,7,8,9,10,11]),
  baseball_npb: new Set([3,4,5,6,7,8,9,10,11]),
  americanfootball_ncaaf: new Set([8,9,10,11,12,1]),
  americanfootball_nfl: new Set([9,10,11,12,1,2]),
  americanfootball_nfl_preseason: new Set([8]),
  basketball_wnba: new Set([5,6,7,8,9,10])
};
const SPORT_PRIORITY={baseball_mlb:100,americanfootball_ncaaf:95,americanfootball_nfl:85,basketball_wnba:78,americanfootball_nfl_preseason:68,baseball_kbo:58,baseball_npb:58};

function zonedParts(date=new Date()){
  const p=new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date).reduce((o,x)=>(o[x.type]=x.value,o),{});
  return {year:Number(p.year),month:Number(p.month),day:Number(p.day),hour:Number(p.hour)%24,minute:Number(p.minute),dateKey:`${p.year}-${p.month}-${p.day}`,monthKey:`${p.year}-${p.month}`};
}
function hoursUntil(iso){return (new Date(iso).getTime()-Date.now())/36e5;}
function minutesUntil(iso){return (new Date(iso).getTime()-Date.now())/60000;}
function stableKey(r){return [r.event_id||r.event?.id,r.market||'',r.selection||'',r.point==null?'':r.point].join('|');}
function seasonActive(sport,month){const s=SPORT_MONTHS[sport];return !s||s.has(month);}
function marketsFor(){return 'h2h,spreads,totals';}
function oddsEndpoint(sport,markets=marketsFor()){
  const c=engine.config();
  return `sports/${encodeURIComponent(sport)}/odds?bookmakers=${encodeURIComponent(c.bookmakers)}&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`;
}
function cardNearestHours(card){
  const times=(card?.analyses||[]).map(a=>hoursUntil(a.event?.commence_time)).filter(x=>Number.isFinite(x)&&x>-1);
  return times.length?Math.min(...times):Infinity;
}
function dueIntervalMinutes(card){
  const h=cardNearestHours(card);
  if(!Number.isFinite(h))return 360;
  if(h>18)return 360;
  if(h>6)return 180;
  if(h>3)return 90;
  if(h>1)return 45;
  if(h>0.25)return 20;
  return 12;
}
function usage(state){
  const z=zonedParts(),d=Number(state.autopilot.daily_usage?.[z.dateKey]||0),m=Number(state.autopilot.monthly_usage?.[z.monthKey]||0);
  return {z,d,m,dRemaining:Math.max(0,DAILY_BUDGET-d),mRemaining:Math.max(0,MONTHLY_BUDGET-m)};
}
function bumpUsage(state,n=1){
  const {z}=usage(state);
  state.autopilot.daily_usage[z.dateKey]=Number(state.autopilot.daily_usage[z.dateKey]||0)+n;
  state.autopilot.monthly_usage[z.monthKey]=Number(state.autopilot.monthly_usage[z.monthKey]||0)+n;
  for(const k of Object.keys(state.autopilot.daily_usage))if(k<z.dateKey.slice(0,8)+'01')delete state.autopilot.daily_usage[k];
  for(const k of Object.keys(state.autopilot.monthly_usage))if(k<`${z.year-1}-01`)delete state.autopilot.monthly_usage[k];
}
function nullableNumber(v){ if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null; }
function providerCost(meta,fallback=0){ if(meta?.cached)return 0; const n=nullableNumber(meta?.last); return n!=null&&n>=0?n:fallback; }
function providerUsed(){ return nullableNumber(engine.config().lastOddsMeta?.used); }
function runCount(run,field,dateKey){ return Number(run?.[field]?.[dateKey]||0); }
function bumpRunCount(run,field,dateKey,n=1){ run[field]=run[field]||{};run[field][dateKey]=Number(run[field][dateKey]||0)+n; for(const k of Object.keys(run[field]))if(k<dateKey.slice(0,8)+'01')delete run[field][k]; }
function eventNearestHours(events){ const v=(events||[]).map(e=>hoursUntil(e.commence_time)).filter(x=>Number.isFinite(x)&&x>-1);return v.length?Math.min(...v):Infinity; }
function needsFullOddsRefresh(state,sport,events){
  const z=zonedParts(),run=state.autopilot.sport_runs?.[sport]||{},count=runCount(run,'full_odds_refreshes',z.dateKey);
  if(!events?.length||!run.last_odds_refresh_at)return {yes:true,reason:'board discovery',count};
  if(count>=MAX_FULL_ODDS_REFRESHES)return {yes:false,reason:'daily full-board refresh cap reached',count};
  const age=(Date.now()-new Date(run.last_odds_refresh_at).getTime())/60000,h=eventNearestHours(events);
  const lastDay=zonedParts(new Date(run.last_odds_refresh_at)).dateKey;
  if(lastDay!==z.dateKey)return {yes:true,reason:'new-day board discovery',count};
  if(h<=3&&age>=75)return {yes:true,reason:'final-window full-board refresh',count};
  if(h<=8&&age>=240)return {yes:true,reason:'midday full-board refresh',count};
  return {yes:false,reason:'reuse saved odds; refresh public evidence only',count};
}
async function targetedPriceRefresh(state,sport,events){
  const z=zonedParts(),run=state.autopilot.sport_runs?.[sport]||{},count=runCount(run,'targeted_odds_refreshes',z.dateKey);
  if(count>=MAX_TARGETED_REFRESHES||usage(state).dRemaining<=0)return {events,count:0,cost:0};
  const card=state.latest_cards?.[sport],seen=new Set(),targets=[];
  for(const p of card?.plays||[]){
    const mins=minutesUntil(p.event?.commence_time||p.commence_time),qAge=p.last_update?Math.max(0,(Date.now()-new Date(p.last_update).getTime())/60000):Infinity;
    const k=`${p.event_id}|${p.market}`;
    if(mins>0&&mins<=120&&qAge>=25&&!seen.has(k)&&['CORE','SECONDARY','WATCH'].includes(p.tier)){seen.add(k);targets.push(p);if(targets.length>=Math.min(2,MAX_TARGETED_REFRESHES-count))break;}
  }
  let out=[...(events||[])],spent=0,done=0;
  for(const p of targets){
    if(usage(state).dRemaining<=0)break;
    const i=out.findIndex(e=>e.id===p.event_id);if(i<0)continue;
    const before=providerUsed();
    try{out[i]=await engine.refreshEventMarkets(out[i],[p.market]);}catch{continue;}
    const after=providerUsed();let cost=(before!=null&&after!=null&&after>=before)?after-before:providerCost(engine.config().lastOddsMeta,1);
    cost=Math.max(0,Number(cost)||0);if(cost)bumpUsage(state,cost);spent+=cost;done++;
  }
  if(done){bumpRunCount(run,'targeted_odds_refreshes',z.dateKey,done);run.last_targeted_refresh_at=new Date().toISOString();}
  return {events:out,count:done,cost:spent};
}
function addAlert(state,code,message,severity='warning',meta={}){
  const now=Date.now(),recent=(state.alerts||[]).find(a=>a.code===code&&now-new Date(a.at).getTime()<6*3600e3);
  if(recent){recent.at=new Date().toISOString();recent.message=message;recent.severity=severity;recent.meta=meta;return;}
  state.alerts.push({id:`${code}-${now}`,code,message,severity,at:new Date().toISOString(),meta});
  state.alerts=state.alerts.slice(-250);
}
function clearAlert(state,code){state.alerts=(state.alerts||[]).filter(a=>a.code!==code);}
function recordTransitions(state,sport,card){
  const prev=state.latest_cards?.[sport];
  const before=new Map((prev?.plays||[]).map(p=>[stableKey(p),p.tier]));
  const after=new Map((card?.plays||[]).map(p=>[stableKey(p),p.tier]));
  const keys=new Set([...before.keys(),...after.keys()]);
  for(const k of keys){const a=before.get(k)||'PASS',b=after.get(k)||'PASS';if(a!==b){const p=(card.plays||[]).find(x=>stableKey(x)===k)||(prev?.plays||[]).find(x=>stableKey(x)===k);state.tier_history.push({at:card.generated_at,sport,event_id:p?.event_id,matchup:p?.event?`${p.event.away_team} @ ${p.event.home_team}`:'',market:p?.market,selection:p?.selection,point:p?.point,from:a,to:b,reason:p?.final_verification||''});state.autopilot.transitions.push({at:card.generated_at,sport,key:k,from:a,to:b});}}
}
function recordAudit(state,card){
  const by=new Map((state.audit||[]).map(r=>[stableKey(r),r]));
  for(const a of card.analyses||[]){
    const candidates=a.market?.all||[];
    const best=a.market?.best;
    for(const c of candidates){
      const rec={event_id:a.event.id,sport_key:a.event.sport_key,away_team:a.event.away_team,home_team:a.event.home_team,commence_time:a.event.commence_time,market:c.market,selection:c.selection,point:c.point,price:c.price,book:c.book,book_key:c.book_key,tier:c.tier||'PASS',units:c.tier==='CORE'?1:c.tier==='SECONDARY'?.5:0,fair_probability:c.fair_probability??null,adjusted_edge:c.adjusted_edge??null,estimated_ev:c.estimated_ev??null,support:c.market_support_strength??0,quality:c.decision_quality??0,stress_score:c.stress_test?.score??null,stress_secondary_survivals:c.stress_test?.secondary_survivals??null,stress_core_robust:c.stress_test?.core_robust??null,market_selection_score:c.market_selection_score??null,execution_state:c.execution_state||null,data_quality_grade:c.data_quality_grade||null,play_to:c.play_to||null,downgrade_at:c.downgrade_at||null,pass_at:c.pass_at||null,selected_market:!!(best&&best.market===c.market&&best.selection===c.selection&&best.book===c.book&&Number(best.point??0)===Number(c.point??0)),projected_home:Number((c.market_projection_score||a.projection?.projected_score||{}).home),projected_away:Number((c.market_projection_score||a.projection?.projected_score||{}).away),projected_total:Number(c.market_projection_total??a.projection?.projected_total),projected_margin_home:Number(c.market_projection_margin_home??a.projection?.projected_margin_home),model_version:card.version,first_seen_at:card.generated_at,last_seen_at:card.generated_at,result:null,home_score:null,away_score:null,period_scores:null,graded_at:null,snapshots:[]};
      const k=stableKey(rec),old=by.get(k),snap={at:card.generated_at,price:rec.price,book:rec.book,fair_probability:rec.fair_probability,edge:rec.adjusted_edge,ev:rec.estimated_ev,tier:rec.tier,data_quality_grade:rec.data_quality_grade,play_to:rec.play_to};
      if(old){Object.assign(old,rec,{first_seen_at:old.first_seen_at||rec.first_seen_at,result:old.result,home_score:old.home_score,away_score:old.away_score,period_scores:old.period_scores,graded_at:old.graded_at,result_source:old.result_source,locked:old.locked||false,locked_at:old.locked_at||null,locked_price:old.locked_price??null,locked_tier:old.locked_tier||null,locked_units:old.locked_units??null,locked_model_version:old.locked_model_version||null,withdrawn_at:old.withdrawn_at||null,snapshots:(old.snapshots||[]).concat([snap]).slice(-120)});by.set(k,old);}else{rec.snapshots=[snap];by.set(k,rec);}
      state.market_history[k]=((state.market_history[k]||[]).concat([snap])).slice(-120);
    }
  }
  state.audit=Array.from(by.values());
}
function lockEligible(state,card){
  const existing=new Map((state.locks||[]).map(r=>[stableKey(r),r]));
  for(const p of card.plays||[]){
    const k=stableKey(p),mins=minutesUntil(p.event?.commence_time),eligible=['CORE','SECONDARY'].includes(p.tier)&&p.units>0&&p.data_quality_grade!=='C'&&/^BET NOW/i.test(p.timing||'')&&mins>0&&mins<=AUTO_LOCK_MINUTES;
    if(eligible&&!existing.has(k)){
      const lock={...p,stable_key:k,locked_at:new Date().toISOString(),locked_tier:p.tier,locked_units:p.units,locked_price:p.price,locked_book:p.book,locked_model_version:card.version,status:'LOCKED',result:null};
      state.locks.push(lock);existing.set(k,lock);
      const ar=(state.audit||[]).find(x=>stableKey(x)===k);if(ar){ar.locked=true;ar.locked_at=lock.locked_at;ar.locked_price=lock.locked_price;ar.locked_tier=lock.locked_tier;ar.locked_units=lock.locked_units;ar.locked_model_version=lock.locked_model_version;}
    }
  }
  // If a previously locked play is later invalidated before start, preserve history but mark the withdrawal.
  const analyzedIds=new Set((card.analyses||[]).map(a=>a.event?.id).filter(Boolean));
  for(const lock of state.locks||[]){
    const start=lock.event?.commence_time||lock.commence_time;
    if(lock.status!=='LOCKED'||minutesUntil(start)<=0)continue;
    const current=(card.plays||[]).find(p=>stableKey(p)===stableKey(lock));
    const invalid=current&&!['CORE','SECONDARY'].includes(current.tier), vanished=!current&&analyzedIds.has(lock.event_id);
    if(invalid||vanished){lock.status='WITHDRAWN';lock.withdrawn_at=new Date().toISOString();lock.withdrawal_reason=current?.final_verification||current?.timing||'The latest verification no longer carries this exact market through Core/Secondary release gates.';}
  }
}
function setCard(state,sport,card,events,reason,meta={}){
  recordTransitions(state,sport,card);
  recordAudit(state,card);
  if(RELEASE_SPORTS.has(sport))lockEligible(state,card);
  state.latest_cards[sport]={...card,autopilot_reason:reason,release_enabled:RELEASE_SPORTS.has(sport)};
  const old=state.board_snapshots[sport]||{};
  state.board_snapshots[sport]={odds_fetched_at:meta.oddsFetchedAt||old.odds_fetched_at||null,analyzed_at:card.generated_at,events:(events||old.events||[]).slice(0,40)};
}
async function gradeDue(state){
  const due=(state.audit||[]).filter(r=>!r.result&&new Date(r.commence_time).getTime()<Date.now()-GRADE_DELAY_HOURS*3600e3).slice(0,240);
  const groups=new Map();
  for(const r of due){const k=`${r.sport_key}|${r.event_id}`;(groups.get(k)||groups.set(k,[]).get(k)).push(r);}
  let graded=0,eventsChecked=0;
  for(const rows of groups.values()){
    if(eventsChecked>=50)break;eventsChecked++;
    const score=await engine.resolveFinalScore(rows[0]);
    if(!score.final)continue;
    for(const r of rows){
      const outcome=engine.settledBetOutcome(r,score);if(!outcome)continue;
      r.result=outcome;r.home_score=score.home_score;r.away_score=score.away_score;r.period_scores=score.period_scores||null;r.graded_at=new Date().toISOString();r.result_source=score.source||'';graded++;
      const lock=(state.locks||[]).find(x=>stableKey(x)===stableKey(r));if(lock){lock.result=outcome;lock.home_score=score.home_score;lock.away_score=score.away_score;lock.graded_at=r.graded_at;}
    }
  }
  state.autopilot.grading={last_run_at:new Date().toISOString(),last_graded:graded,events_checked:eventsChecked};
  return graded;
}

function sportIsDue(state,sport){
  const z=zonedParts(),run=state.autopilot.sport_runs?.[sport]||{},last=run.last_scan_at?new Date(run.last_scan_at).getTime():0,card=state.latest_cards?.[sport];
  if(!seasonActive(sport,z.month))return {due:false,reason:'off-season'};
  if(!last)return {due:true,reason:'daily discovery'};
  const elapsed=(Date.now()-last)/60000,interval=dueIntervalMinutes(card);
  if(elapsed>=interval)return {due:true,reason:`scheduled ${interval}m refresh`};
  return {due:false,reason:`next refresh in ${Math.ceil(interval-elapsed)}m`};
}
async function scanSport(state,sport,reason){
  const z=zonedParts(),run=state.autopilot.sport_runs[sport]||(state.autopilot.sport_runs[sport]={}),saved=state.board_snapshots[sport]||{};
  let events=engine.pregameOnly(saved.events||[]).map(engine.sanitizeEvent),full=needsFullOddsRefresh(state,sport,events),fullCost=0,targeted={count:0,cost:0};
  run.last_attempt_at=new Date().toISOString();
  if(full.yes){
    const u=usage(state),providerRemaining=nullableNumber(engine.config().lastOddsMeta?.remaining),reserve=Number(engine.config().oddsQuotaReserve||0);
    if(Number.isFinite(providerRemaining)&&providerRemaining<=reserve){if(!events.length)throw new Error(`Provider quota reserve reached (${providerRemaining} credits remain; reserve ${reserve}).`);full={yes:false,reason:'provider quota reserve deferred full-board refresh',count:full.count};}
    else if(u.dRemaining<3||u.mRemaining<3){if(!events.length)throw new Error(`Odds budget is too low for board discovery (${u.dRemaining} daily / ${u.mRemaining} monthly credits remain).`);full={yes:false,reason:'quota governor deferred full-board refresh',count:full.count};}
  }
  if(full.yes){
    const r=await engine.oddsFetch(oddsEndpoint(sport),{force:true});fullCost=providerCost(r.meta,3);if(fullCost)bumpUsage(state,fullCost);
    events=engine.pregameOnly(r.data).map(engine.sanitizeEvent);run.last_odds_meta=r.meta||null;run.last_odds_refresh_at=r.meta?.fetched_at||new Date().toISOString();bumpRunCount(run,'full_odds_refreshes',z.dateKey,1);
  }else if(events.length){targeted=await targetedPriceRefresh(state,sport,events);events=targeted.events;}
  if(!events.length){run.last_scan_at=run.last_attempt_at;run.last_result='NO_EVENTS';run.last_error=null;return {sport,events:0,reason,odds_refresh:full.reason};}
  const nearest=eventNearestHours(events),uBeforeDeep=usage(state),providerBefore=providerUsed();
  const allowDeep=sport==='baseball_mlb'&&full.yes&&nearest<=AUTO_DEEP_WINDOW_HOURS&&AUTO_DEEP_CREDIT_CAP>0&&uBeforeDeep.dRemaining>=AUTO_DEEP_CREDIT_CAP&&uBeforeDeep.mRemaining>=AUTO_DEEP_CREDIT_CAP;
  const deepCap=allowDeep?Math.min(AUTO_DEEP_CREDIT_CAP,uBeforeDeep.dRemaining,uBeforeDeep.mRemaining):0;
  const card=await engine.scanSlate(events,{allowDeepMarkets:allowDeep,deepCreditCap:deepCap,deepGameCap:1});
  const providerAfter=providerUsed();let deepCost=0;if(allowDeep){deepCost=(providerBefore!=null&&providerAfter!=null&&providerAfter>=providerBefore)?providerAfter-providerBefore:Math.max(0,Number(card.deep_market_scan?.credits_attempted||0));if(deepCost)bumpUsage(state,deepCost);}
  card.autopilot={generated:true,reason,release_enabled:RELEASE_SPORTS.has(sport),storage_backend:store.persistent?'persistent':'ephemeral',odds_refresh:full.yes?full.reason:'saved board + public-data recheck',full_odds_cost:fullCost,targeted_refreshes:targeted.count,targeted_cost:targeted.cost,deep_cost:deepCost,budget_units_used:fullCost+targeted.cost+deepCost};
  setCard(state,sport,card,events,reason,{oddsFetchedAt:run.last_odds_refresh_at});
  run.last_scan_at=card.generated_at;run.last_result=card.slate_grade;run.last_error=null;run.games=(card.analyses||[]).length;
  return {sport,events:events.length,grade:card.slate_grade,plays:(card.plays||[]).length,reason,odds_refresh:card.autopilot.odds_refresh,budget_units_used:card.autopilot.budget_units_used};
}

async function tick({force=false,sports=null,reason='scheduled autopilot'}={}){
  if(!ENABLED&&!force)return {ok:false,disabled:true};
  const started=new Date().toISOString();
  const out=await store.mutate(async state=>{
    state.autopilot.enabled=ENABLED;state.autopilot.last_tick_at=started;state.autopilot.last_error=null;
    try{
      const q=await engine.oddsQuotaProbe();
      const used=nullableNumber(q?.used),z=zonedParts();
      if(used!=null)state.autopilot.monthly_usage[z.monthKey]=Math.max(Number(state.autopilot.monthly_usage[z.monthKey]||0),used);
      state.autopilot.provider_quota=q||null;
      const remaining=nullableNumber(q?.remaining),reserve=Number(engine.config().oddsQuotaReserve||0);
      if(remaining!=null&&remaining<=reserve)addAlert(state,'PROVIDER_QUOTA_RESERVE',`Sportsbook API reserve is active: ${remaining} credits remain. Paid-odds refreshes are being protected.`, 'warning',{remaining,reserve});else clearAlert(state,'PROVIDER_QUOTA_RESERVE');
    }catch(e){addAlert(state,'ODDS_QUOTA_PROBE',`Could not verify sportsbook API quota: ${e.message}`,'warning');}
    const selected=(Array.isArray(sports)&&sports.length?sports:AUTO_SPORTS).filter(s=>engine.SPORTS.some(x=>x.key===s));
    const due=selected.map(s=>({sport:s,...sportIsDue(state,s)})).filter(x=>force||x.due).sort((a,b)=>(SPORT_PRIORITY[b.sport]||0)-(SPORT_PRIORITY[a.sport]||0));
    const runs=[],errs=[];
    const u0=usage(state);
    if(u0.dRemaining<=0||u0.mRemaining<=0)addAlert(state,'ODDS_BUDGET','AEGIS autopilot paused odds refreshes because the configured free-tier budget is exhausted.','warning',u0);else clearAlert(state,'ODDS_BUDGET');
    for(const item of due.slice(0,MAX_SPORTS_PER_TICK)){
      try{runs.push(await scanSport(state,item.sport,force?'forced scan':item.reason));clearAlert(state,`SPORT_${item.sport}`);}catch(e){errs.push({sport:item.sport,error:e.message});const run=state.autopilot.sport_runs[item.sport]||(state.autopilot.sport_runs[item.sport]={});run.last_attempt_at=new Date().toISOString();run.last_error=e.message;addAlert(state,`SPORT_${item.sport}`,`${item.sport} automatic refresh failed: ${e.message}`,'error');}
    }
    let graded=0;try{graded=await gradeDue(state);clearAlert(state,'GRADING');}catch(e){addAlert(state,'GRADING',`Automatic grading failed: ${e.message}`,'error');errs.push({sport:'grading',error:e.message});}
    const sh=await store.health();if(!sh.persistent)addAlert(state,'EPHEMERAL_STORAGE','Persistent cloud storage is not configured. Render free instances lose local state on spin-down/redeploy; configure Supabase before relying on hands-off history.','warning');else clearAlert(state,'EPHEMERAL_STORAGE');
    state.autopilot.last_success_at=errs.length===0?new Date().toISOString():state.autopilot.last_success_at;
    state.autopilot.last_error=errs.length?errs.map(x=>`${x.sport}: ${x.error}`).join(' | '):null;
    const u=usage(state);
    return {ok:errs.length===0,started_at:started,finished_at:new Date().toISOString(),runs,errors:errs,graded,usage:{today:u.d,daily_budget:DAILY_BUDGET,month:u.m,monthly_budget:MONTHLY_BUDGET},persistent:store.persistent};
  });
  return out.result;
}
async function status(){
  const state=await store.load(),u=usage(state);
  const cards=Object.entries(state.latest_cards||{}).map(([sport,c])=>({sport,generated_at:c.generated_at,slate_grade:c.slate_grade,core:(c.plays||[]).filter(p=>p.tier==='CORE').length,secondary:(c.plays||[]).filter(p=>p.tier==='SECONDARY').length,watch:(c.plays||[]).filter(p=>p.tier==='WATCH').length,pass:(c.passes||[]).length,release_enabled:c.release_enabled!==false,nearest_game_hours:cardNearestHours(c)}));
  return {enabled:ENABLED,timezone:TIMEZONE,persistent:store.persistent,storage_backend:store.persistent?'supabase':'local-ephemeral',auto_sports:AUTO_SPORTS,refresh_policy:{max_full_per_sport_day:MAX_FULL_ODDS_REFRESHES,max_targeted_per_sport_day:MAX_TARGETED_REFRESHES,deep_credit_cap:AUTO_DEEP_CREDIT_CAP,deep_window_hours:AUTO_DEEP_WINDOW_HOURS},last_tick_at:state.autopilot.last_tick_at,last_success_at:state.autopilot.last_success_at,last_error:state.autopilot.last_error,usage:{today:u.d,daily_budget:DAILY_BUDGET,month:u.m,monthly_budget:MONTHLY_BUDGET,daily_remaining:u.dRemaining,monthly_remaining:u.mRemaining},provider_quota:state.autopilot.provider_quota||engine.config().lastOddsMeta||null,release_sports:[...RELEASE_SPORTS],cards,alerts:(state.alerts||[]).slice(-20).reverse(),locks:(state.locks||[]).filter(x=>!x.result).slice(-20).reverse(),grading:state.autopilot.grading,sport_runs:state.autopilot.sport_runs};
}
async function latestCard(sport){const s=await store.load();return sport?s.latest_cards?.[sport]||null:s.latest_cards||{};}
async function results(){const s=await store.load();return {audit:s.audit||[],locks:s.locks||[],tier_history:s.tier_history||[]};}
async function manualLock(keys=[]){
  return (await store.mutate(async state=>{const set=new Set(keys);let n=0;for(const r of state.audit||[]){if(set.has(stableKey(r))&&!r.locked&&['CORE','SECONDARY'].includes(r.tier)){r.locked=true;r.locked_at=new Date().toISOString();r.locked_price=r.price;r.locked_tier=r.tier;r.locked_units=r.units;r.locked_model_version=r.model_version;state.locks.push({...r,stable_key:stableKey(r),status:'LOCKED'});n++;}}return {locked:n};})).result;
}
async function captureScan(sport,card,events=[],reason='manual scan'){
  return (await store.mutate(async state=>{setCard(state,sport,card,events,reason,{oddsFetchedAt:new Date().toISOString()});const run=state.autopilot.sport_runs[sport]||(state.autopilot.sport_runs[sport]={});run.last_scan_at=card.generated_at;run.last_odds_refresh_at=card.generated_at;run.last_odds_meta=engine.config().lastOddsMeta||null;run.last_result=card.slate_grade;run.last_error=null;run.games=(card.analyses||[]).length;return {saved:true,persistent:store.persistent};})).result;
}
async function gradeNow(){return (await store.mutate(async state=>({graded:await gradeDue(state)}))).result;}

module.exports={tick,status,latestCard,results,manualLock,captureScan,gradeNow,stableKey,config:{ENABLED,TIMEZONE,AUTO_SPORTS,RELEASE_SPORTS:[...RELEASE_SPORTS],DAILY_BUDGET,MONTHLY_BUDGET,AUTO_LOCK_MINUTES,MAX_FULL_ODDS_REFRESHES,MAX_TARGETED_REFRESHES,AUTO_DEEP_CREDIT_CAP}};
