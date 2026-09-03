'use strict';

function finite(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

function firstFinite(...values){
  for(const value of values){
    const n=finite(value);
    if(n!==null)return n;
  }
  return null;
}

function ageMinutes(value,nowMs=Date.now()){
  if(!value)return null;
  const ms=new Date(value).getTime();
  if(!Number.isFinite(ms))return null;
  return Math.max(0,(nowMs-ms)/60000);
}

function etHour(nowMs=Date.now()){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{
      timeZone:'America/New_York',
      hour:'2-digit',
      hourCycle:'h23'
    }).formatToParts(new Date(nowMs));
    const raw=parts.find(p=>p.type==='hour')?.value;
    const hour=Number(raw);
    return Number.isFinite(hour)?hour:null;
  }catch{
    return null;
  }
}

function normalizedAlerts(auto){
  const rows=Array.isArray(auto?.alerts)?auto.alerts:[];
  return rows.slice(-4).map(item=>{
    if(typeof item==='string')return item;
    if(!item||typeof item!=='object')return String(item||'');
    return String(item.message||item.title||item.reason||item.type||'Operational alert');
  }).filter(Boolean);
}

function timestampMs(value){
  if(value===null||value===undefined||value==='')return null;
  let ms=null;
  if(typeof value==='number'){
    ms=value<1e12?value*1000:value;
  }else{
    ms=new Date(value).getTime();
  }
  return Number.isFinite(ms)?ms:null;
}

function canonicalSuccess(auto={},nowMs=Date.now()){
  const candidates=[];
  const seen=new Set();
  const futureAllowanceMs=5*60000;

  function add(value,source){
    const ms=timestampMs(value);
    if(ms===null||ms>nowMs+futureAllowanceMs)return;
    candidates.push({ms,source});
  }

  [
    ['auto.last_success_at',auto.last_success_at],
    ['auto.lastSuccessAt',auto.lastSuccessAt],
    ['auto.last_successful_run_at',auto.last_successful_run_at],
    ['auto.lastSuccessfulRunAt',auto.lastSuccessfulRunAt],
    ['auto.last_successful_tick_at',auto.last_successful_tick_at],
    ['auto.lastSuccessfulTickAt',auto.lastSuccessfulTickAt]
  ].forEach(([source,value])=>add(value,source));

  const topLevelFailure=Boolean(auto.last_error||auto.lastError);
  if(!topLevelFailure){
    [
      ['auto.last_run_at',auto.last_run_at],
      ['auto.lastRunAt',auto.lastRunAt],
      ['auto.last_tick_at',auto.last_tick_at],
      ['auto.lastTickAt',auto.lastTickAt],
      ['auto.last_completed_at',auto.last_completed_at],
      ['auto.lastCompletedAt',auto.lastCompletedAt]
    ].forEach(([source,value])=>add(value,source));
  }

  function walk(value,path='auto',depth=0){
    if(value===null||value===undefined||depth>4)return;
    if(typeof value!=='object')return;
    if(seen.has(value))return;
    seen.add(value);

    if(Array.isArray(value)){
      for(let i=0;i<Math.min(value.length,50);i++)walk(value[i],`${path}[${i}]`,depth+1);
      return;
    }

    const entries=Object.entries(value);

    for(const [key,item] of entries){
      if(item===null||item===undefined||typeof item==='object')continue;
      const normalized=String(key).toLowerCase().replace(/[^a-z0-9]/g,'');
      if(
        normalized.includes('success')&&
        (normalized.includes('at')||normalized.includes('time')||normalized.includes('date'))
      ){
        add(item,`${path}.${key}`);
      }
    }

    const state=String(
      value.status??value.state??value.conclusion??value.result??''
    ).trim().toLowerCase();

    const failed=
      value.ok===false||
      value.success===false||
      Boolean(value.error||value.last_error||value.lastError)||
      ['error','failed','failure','cancelled','canceled'].includes(state);

    const successful=
      !failed&&(
        value.ok===true||
        value.success===true||
        ['success','succeeded','ok','completed','complete','passed'].includes(state)
      );

    const operationalPath=/(run|tick|autopilot|history|recent|sport)/i.test(path);

    if(operationalPath&&!failed){
      const runKeys=[
        'last_run_at','lastRunAt','run_at','runAt',
        'finished_at','finishedAt','completed_at','completedAt',
        'ended_at','endedAt'
      ];
      for(const key of runKeys){
        if(Object.prototype.hasOwnProperty.call(value,key)){
          if(successful||key.startsWith('last_')||key.startsWith('lastR')){
            add(value[key],`${path}.${key}`);
          }
        }
      }

      if(successful){
        for(const key of ['at','timestamp','time','updated_at','updatedAt']){
          if(Object.prototype.hasOwnProperty.call(value,key)){
            add(value[key],`${path}.${key}`);
          }
        }
      }
    }

    for(const [key,item] of entries){
      if(item&&typeof item==='object')walk(item,`${path}.${key}`,depth+1);
    }
  }

  walk(auto);

  if(!candidates.length)return {at:null,source:null};
  candidates.sort((a,b)=>b.ms-a.ms);
  return {
    at:new Date(candidates[0].ms).toISOString(),
    source:candidates[0].source
  };
}

function evaluate({
  auto={},
  storage={},
  config={},
  production=false,
  nowMs=Date.now(),
  uptimeSeconds=null
}={}){
  const scheduleMinutes=firstFinite(config.scheduleMinutes,15)??15;
  const staleAfter=firstFinite(config.staleAfterMinutes,35)??35;
  const actionAfter=firstFinite(config.actionAfterMinutes,75)??75;
  const hour=etHour(nowMs);
  const insideWindow=hour===null?true:(hour>=7&&hour<23);
  const successInfo=canonicalSuccess(auto,nowMs);
  const lastSuccess=successInfo.at;
  const lastAge=ageMinutes(lastSuccess,nowMs);
  const enabled=auto.enabled!==false&&config.autopilotEnabled!==false;
  const dailyBudget=firstFinite(config.dailyBudget,auto.daily_budget,auto.usage?.daily_budget);
  const monthlyBudget=firstFinite(config.monthlyBudget,auto.monthly_budget,auto.usage?.monthly_budget);
  const dailyUsed=firstFinite(auto.usage?.today,auto.usage?.daily,auto.today_usage,auto.daily_usage);
  const monthlyUsed=firstFinite(auto.usage?.month,auto.usage?.monthly,auto.month_usage,auto.monthly_usage);
  const gradeDelayHours=firstFinite(config.gradeDelayHours,2)??2;
  const autoLockMinutes=firstFinite(config.autoLockMinutes,30)??30;
  const redundancy=config.schedulerRedundancy&&typeof config.schedulerRedundancy==='object'?config.schedulerRedundancy:null;

  const checks=[];
  const alerts=normalizedAlerts(auto);
  let severity=0; // 0 green, 1 degraded, 2 red
  let mode=insideWindow?'AUTONOMOUS':'SLEEP_WINDOW';
  let recoveryArmed=false;
  let interventionRequired=false;

  function check(key,ok,level,message){
    checks.push({key,ok:!!ok,level:ok?'OK':level,message});
    if(!ok){
      if(level==='RED')severity=Math.max(severity,2);
      else severity=Math.max(severity,1);
      if(message&&!alerts.includes(message))alerts.push(message);
    }
  }

  check('storage_health',storage.ok!==false,production?'RED':'DEGRADED','Persistent state backend is reporting an error.');
  check('persistent_storage',!production||storage.persistent===true,production?'RED':'DEGRADED','Production persistence is not confirmed.');
  check('autopilot_enabled',enabled,'RED','Autopilot is disabled.');

  if(redundancy){
    const backupReady=redundancy.ready===true;
    const backupStatus=String(redundancy.status||'UNCONFIGURED').toUpperCase();
    const backupHealthy=backupReady&&['HEALTHY','STARTING','RECOVERY_RUNNING'].includes(backupStatus);

    if(!backupReady){
      severity=Math.max(severity,1);
      recoveryArmed=true;
      if(severity<2)mode='RECOVERY_ARMED';
      checks.push({key:'scheduler_redundancy',ok:false,level:'DEGRADED',message:'Backup heartbeat is not configured; GitHub Actions is currently the only scheduler.'});
      alerts.push('Scheduler redundancy setup is incomplete: configure the backup heartbeat secret and external cron.');
    }else if(insideWindow&&!backupHealthy){
      severity=Math.max(severity,1);
      recoveryArmed=true;
      if(severity<2)mode='RECOVERY_ARMED';
      checks.push({key:'scheduler_redundancy',ok:false,level:'DEGRADED',message:backupStatus==='STALE'?'Backup heartbeat has stopped checking in on schedule.':'Backup heartbeat is configured but has not completed its first check-in yet.'});
      alerts.push(backupStatus==='STALE'?'Backup scheduler heartbeat is stale.':'Backup scheduler is awaiting its first heartbeat check-in.');
    }else{
      checks.push({key:'scheduler_redundancy',ok:true,level:insideWindow?'OK':'SLEEP',message:backupReady?'Independent backup heartbeat is configured and available.':'Backup scheduler is outside its operating window.'});
    }
  }

  if(insideWindow&&enabled){
    if(lastAge===null){
      const uptime=finite(uptimeSeconds);
      const grace=uptime!==null&&uptime<scheduleMinutes*2*60;
      check('scheduler_freshness',grace,'RED',grace?'Awaiting the first scheduled tick after deployment.':'No successful Autopilot tick is recorded during the operating window.');
      if(grace){
        severity=Math.max(severity,1);
        recoveryArmed=true;
        mode='RECOVERY_ARMED';
      }
    }else if(lastAge<=staleAfter){
      checks.push({key:'scheduler_freshness',ok:true,level:'OK',message:`Last successful tick was ${Math.round(lastAge)} minutes ago.`});
    }else if(lastAge<=actionAfter){
      severity=Math.max(severity,1);
      recoveryArmed=true;
      mode='RECOVERY_ARMED';
      checks.push({key:'scheduler_freshness',ok:false,level:'DEGRADED',message:`Autopilot is ${Math.round(lastAge)} minutes stale; the next scheduler run is armed for recovery.`});
      alerts.push(`Missed-run recovery armed: last successful tick was ${Math.round(lastAge)} minutes ago.`);
    }else{
      severity=2;
      interventionRequired=true;
      mode='ACTION_REQUIRED';
      checks.push({key:'scheduler_freshness',ok:false,level:'RED',message:`Autopilot is ${Math.round(lastAge)} minutes stale, beyond the automatic recovery window.`});
      alerts.push(`Action required: no successful Autopilot tick for ${Math.round(lastAge)} minutes.`);
    }
  }else{
    checks.push({key:'scheduler_freshness',ok:true,level:'SLEEP',message:'Outside the 07:00–23:00 ET operating window; scheduler staleness is not treated as a fault.'});
  }

  if(auto.last_error){
    severity=Math.max(severity,1);
    if(severity<2)mode='RECOVERY_ARMED';
    recoveryArmed=true;
    checks.push({key:'last_run_error',ok:false,level:'DEGRADED',message:'The most recent Autopilot state contains an error; automatic retry/recovery remains armed.'});
    alerts.push('Autopilot reported an error on its latest recorded run; recovery is armed.');
  }else{
    checks.push({key:'last_run_error',ok:true,level:'OK',message:'No current Autopilot error is recorded.'});
  }

  let quotaProtected=false;
  if(dailyBudget!==null&&dailyUsed!==null&&dailyBudget>0&&dailyUsed>=dailyBudget){
    quotaProtected=true;
    severity=Math.max(severity,1);
    if(severity<2)mode='QUOTA_PROTECTED';
    checks.push({key:'daily_budget',ok:false,level:'PROTECTED',message:`Daily sportsbook budget is protected at ${dailyUsed}/${dailyBudget}; nonessential refreshes should pause until reset.`});
    alerts.push('Daily sportsbook budget reached; quota protection is active.');
  }else{
    checks.push({key:'daily_budget',ok:true,level:'OK',message:dailyBudget!==null&&dailyUsed!==null?`Daily usage ${dailyUsed}/${dailyBudget}.`:'Daily usage telemetry is not available in this status payload.'});
  }

  if(monthlyBudget!==null&&monthlyUsed!==null&&monthlyBudget>0&&monthlyUsed>=monthlyBudget){
    quotaProtected=true;
    severity=Math.max(severity,1);
    if(severity<2)mode='QUOTA_PROTECTED';
    checks.push({key:'monthly_budget',ok:false,level:'PROTECTED',message:`Monthly sportsbook budget is protected at ${monthlyUsed}/${monthlyBudget}.`});
    alerts.push('Monthly sportsbook budget reached; quota protection is active.');
  }else{
    checks.push({key:'monthly_budget',ok:true,level:'OK',message:monthlyBudget!==null&&monthlyUsed!==null?`Monthly usage ${monthlyUsed}/${monthlyBudget}.`:'Monthly usage telemetry is not available in this status payload.'});
  }

  if(severity===2){
    mode='ACTION_REQUIRED';
    interventionRequired=true;
  }else if(!insideWindow&&severity===0){
    mode='SLEEP_WINDOW';
  }else if(severity===0){
    mode='AUTONOMOUS';
  }

  const status=severity===2?'RED':severity===1?'DEGRADED':'GREEN';
  const redundancyNeedsSetup=redundancy&&redundancy.ready!==true;
  const redundancyUnhealthy=redundancy&&redundancy.ready===true&&insideWindow&&!['HEALTHY','STARTING','RECOVERY_RUNNING'].includes(String(redundancy.status||'').toUpperCase());

  const nextAction=status==='RED'
    ?'Open Command Center diagnostics and restore the failed scheduler, persistence, or Autopilot dependency.'
    :redundancyNeedsSetup
      ?'Configure the independent backup heartbeat to restore redundant hands-off scheduling.'
      :redundancyUnhealthy
        ?'Primary Autopilot may still be operating, but the backup heartbeat needs attention if it does not recover on its next check.'
    :quotaProtected
      ?'No manual action required unless you intentionally want to change quota policy; AEGIS is protecting the remaining API budget.'
      :recoveryArmed
        ?'No manual action yet. The next scheduled workflow will retry/recover automatically; intervene only if status becomes RED.'
        :insideWindow
          ?'No action required. AEGIS is operating autonomously.'
          :'No action required. AEGIS is outside its scheduled operating window.';

  return {
    status,
    mode,
    intervention_required:interventionRequired,
    recovery_armed:recoveryArmed,
    quota_protected:quotaProtected,
    operating_window_et:'07:00–23:00',
    inside_operating_window:insideWindow,
    expected_schedule_minutes:scheduleMinutes,
    stale_after_minutes:staleAfter,
    action_after_minutes:actionAfter,
    last_success_at:lastSuccess,
    last_success_source:successInfo.source,
    last_success_age_minutes:lastAge===null?null:+lastAge.toFixed(1),
    usage:{today:dailyUsed,daily_budget:dailyBudget,month:monthlyUsed,monthly_budget:monthlyBudget},
    safeguards:{
      scheduler_recovery:redundancy&&redundancy.ready===true?'redundant':'primary-only',
      scheduler_redundancy:redundancy,
      persistent_state:storage.persistent===true,
      auto_lock_minutes:autoLockMinutes,
      grade_delay_hours:gradeDelayHours,
      quota_governor:true,
      release_sports:Array.isArray(config.releaseSports)?config.releaseSports:[]
    },
    checks,
    alerts:Array.from(new Set(alerts)).slice(-8),
    next_action:nextAction,
    evaluated_at:new Date(nowMs).toISOString()
  };
}

module.exports={ageMinutes,etHour,evaluate};
