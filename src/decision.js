'use strict';

function num(v, d=0){
  const n=Number(v);
  return Number.isFinite(n)?n:d;
}
function clamp(v, lo=0, hi=100){
  return Math.max(lo,Math.min(hi,num(v,lo)));
}
function marketBase(market){
  const s=String(market||'');
  if(s.startsWith('totals'))return 'totals';
  if(s.startsWith('spreads'))return 'spreads';
  return 'h2h';
}
function periodInnings(market){
  const m=String(market||'').match(/_1st_(\d+)_innings/);
  return m?Number(m[1]):null;
}
function tierValue(tier){
  return ({CORE:4,SECONDARY:3,WATCH:2,PASS:1}[String(tier||'').toUpperCase()]||0);
}
function gradeFor(q){
  q=num(q,0);
  return q>=85?'ELITE':q>=75?'STRONG':q>=65?'SOLID':q>=55?'FRAGILE':'LOW';
}
function executionState(c){
  if(!c?.hard_rock)return {state:'WAIT_TARGET_BOOK',ready:false,price_ok:false};
  if(String(c.data_quality_grade||'').toUpperCase()==='C')return {state:'WAIT_FRESHNESS',ready:false,price_ok:false};
  const price=Number(c.price),play=Number(c.play_to),down=Number(c.downgrade_at),pass=Number(c.pass_at);
  if(![price,play,down,pass].every(Number.isFinite))return {state:'WAIT_PRICE_BANDS',ready:false,price_ok:false};
  if(price>=play)return {state:'CORE_BAND',ready:true,price_ok:true};
  if(price>=down)return {state:'SECONDARY_BAND',ready:true,price_ok:true};
  if(price>=pass)return {state:'WATCH_BAND',ready:false,price_ok:true};
  return {state:'PASS_PRICE',ready:false,price_ok:false};
}
function stressCandidate(c,proj={},event={}){
  const edge=num(c?.adjusted_edge,0),cushion=Math.max(.0001,num(c?.cushion,0));
  const ev=num(c?.estimated_ev,-1),secondaryReq=cushion*.72,coreReq=cushion;
  const grade=String(c?.data_quality_grade||'C').toUpperCase();
  const period=periodInnings(c?.market)!=null,base=marketBase(c?.market);
  let infoPenalty=.0025;
  if(grade==='B')infoPenalty+=.002;
  if(grade==='C')infoPenalty+=.006;
  if(event?.sport_key==='baseball_mlb'){
    if(!proj?.lineups_confirmed)infoPenalty+=.002;
    if(!period&&!proj?.bullpen_verified)infoPenalty+=.0015;
    if(base==='totals'&&!proj?.probable_starters_confirmed)infoPenalty+=.004;
  }
  const scenarios=[
    {key:'normal_variance',label:'Normal variance',haircut:Math.max(.0025,cushion*.10)},
    {key:'efficiency_regression',label:'Modest efficiency regression',haircut:Math.max(.0035,cushion*.14)},
    {key:'matchup_weakening',label:'One key matchup assumption weakens',haircut:Math.max(.004,cushion*.18)},
    {key:'information_downgrade',label:'Information / lineup downgrade',haircut:infoPenalty}
  ].map(s=>{
    const stressedEdge=edge-s.haircut;
    const stressedEv=ev-s.haircut*1.25;
    return {...s,stressed_edge:stressedEdge,stressed_ev:stressedEv,secondary_survives:stressedEdge>=secondaryReq&&stressedEv>0,core_survives:stressedEdge>=coreReq&&stressedEv>=.005};
  });
  const secondarySurvivals=scenarios.filter(s=>s.secondary_survives).length;
  const coreSurvivals=scenarios.filter(s=>s.core_survives).length;
  const edgeHeadroom=clamp(100*(edge-secondaryReq)/Math.max(.006,cushion*.5));
  const supportHeadroom=clamp(100*(num(c?.market_support_strength,0)-42)/28);
  const quality=clamp(c?.decision_quality,0,100);
  const score=clamp(
    30*(secondarySurvivals/4)+
    20*(coreSurvivals/4)+
    .20*edgeHeadroom+
    .15*supportHeadroom+
    .15*quality
  );
  const worst=scenarios.slice().sort((a,b)=>(a.stressed_edge-secondaryReq)-(b.stressed_edge-secondaryReq))[0];
  const coreRobust=secondarySurvivals>=3&&coreSurvivals>=1&&score>=65&&num(c?.market_support_strength,0)>=70&&num(c?.market_coverage,0)>=76&&num(c?.market_effective_agreement,0)>=69&&grade!=='C';
  return {score:+score.toFixed(1),scenarios,secondary_survivals:secondarySurvivals,core_survivals:coreSurvivals,core_robust:coreRobust,worst_case:worst?{key:worst.key,label:worst.label,stressed_edge:worst.stressed_edge,stressed_ev:worst.stressed_ev,secondary_survives:worst.secondary_survives}:null,secondary_required_edge:secondaryReq,core_required_edge:coreReq};
}
function selectionScore(c){
  if(!c)return 0;
  const tierBase={CORE:52,SECONDARY:40,WATCH:24,PASS:6}[String(c.tier||'').toUpperCase()]??0;
  const edgeOver=num(c.adjusted_edge,0)-num(c.cushion,0);
  let score=tierBase;
  score+=clamp(c.decision_quality)*.15;
  score+=clamp(c.stress_test?.score)*.12;
  score+=clamp(c.market_support_strength)*.06;
  score+=clamp(c.market_coverage)*.04;
  score+=clamp(edgeOver*400,-5,6);
  score+=clamp(num(c.estimated_ev,0)*140,-5,5);
  score+=c.hard_rock?4:-7;
  score+=num(c.market_consensus_books,0)>=3?2:0;
  score-=clamp(num(c.independent_disagreement,0)*60,0,8);
  if(c.market_inside_fair_range)score-=4;
  if(periodInnings(c.market)!=null)score-=1;
  if(marketBase(c.market)==='totals')score-=.5;
  return +clamp(score,0,100).toFixed(2);
}

function appendFlag(c,message){
  const flags=Array.isArray(c.sanity_flags)?c.sanity_flags.slice():[];
  if(!flags.includes(message))flags.push(message);
  c.sanity_flags=flags;
}
function enrichCandidate(candidate,proj={},event={}){
  const c={...candidate,sanity_flags:Array.isArray(candidate?.sanity_flags)?candidate.sanity_flags.slice():[]};
  c.pre_decision_tier=c.tier;
  c.stress_test=stressCandidate(c,proj,event);
  const exec=executionState(c);
  c.execution_state=exec.state;
  c.execution_ready=exec.ready;

  if(!c.hard_rock&&['CORE','SECONDARY'].includes(c.tier)){
    c.tier='WATCH';
    appendFlag(c,'Target-book firewall: Hard Rock Florida price is not verified; reference only until the target-book quote is available.');
  }

  if(c.tier==='CORE'&&!c.stress_test.core_robust){
    c.tier='SECONDARY';
    appendFlag(c,`Core Distinction / Stress-Test Gate v2: only ${c.stress_test.secondary_survivals}/4 adverse scenarios retained Secondary-level economics with stress score ${c.stress_test.score}/100; Core downgraded.`);
  }

  if(c.hard_rock&&['CORE','SECONDARY'].includes(c.tier)){
    if(exec.state==='PASS_PRICE'){
      c.tier='PASS';
      appendFlag(c,'Execution-price firewall: the current Hard Rock price is beyond the published pass threshold; automatic CUT.');
    }else if(exec.state==='WATCH_BAND'){
      c.tier='WATCH';
      appendFlag(c,'Execution-price firewall: the current Hard Rock price is outside the Secondary execution band; wait for a better number.');
    }else if(c.tier==='CORE'&&exec.state==='SECONDARY_BAND'){
      c.tier='SECONDARY';
      appendFlag(c,'Execution-price downgrade: model quality cleared Core, but the current Hard Rock number is only inside the Secondary band.');
    }
  }

  const caps={CORE:100,SECONDARY:88,WATCH:74,PASS:49};
  c.intrinsic_decision_quality=num(c.decision_quality,0);
  c.decision_quality=Math.min(num(c.decision_quality,0),caps[c.tier]??49);
  c.decision_grade=gradeFor(c.decision_quality);
  c.market_selection_score=selectionScore(c);
  return c;
}
function sameSelection(a,b){return String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();}
function chooseBestExpression(candidates,event={},proj={}){
  const rows=(candidates||[]).filter(Boolean).slice().sort((a,b)=>selectionScore(b)-selectionScore(a));
  if(!rows.length)return null;
  const best=rows[0];
  const bestBase=marketBase(best.market),bestPeriod=periodInnings(best.market);
  if(bestBase!=='totals'&&(best.market!=='h2h'||bestPeriod!=null)){
    const primary=rows.find(c=>c.market==='h2h'&&sameSelection(c.selection,best.selection)&&c.hard_rock===best.hard_rock&&c.tier===best.tier);
    if(primary){
      const gap=selectionScore(best)-selectionScore(primary);
      const bullpenReason=event?.sport_key==='baseball_mlb'&&bestPeriod!=null&&!proj?.bullpen_verified;
      const tolerance=bullpenReason?1.5:4.5;
      if(gap<=tolerance){
        primary.market_selection_note=`Primary-expression preference: ${primary.market} chosen because the derivative improved decision score by only ${gap.toFixed(1)} points.`;
        return primary;
      }
    }
  }
  best.market_selection_note='Best expression selected by tier, stress survival, execution quality, support, consensus and edge economics.';
  return best;
}
function recalcQualityForTier(p){
  const caps={CORE:100,SECONDARY:88,WATCH:74,PASS:49};
  p.decision_quality=Math.min(num(p.decision_quality,0),caps[p.tier]??49);
  p.decision_grade=gradeFor(p.decision_quality);
}
function applySlateDiscipline(plays){
  const rows=(plays||[]).filter(Boolean);
  rows.forEach(p=>{p.market_selection_score=selectionScore(p);p.pre_slate_tier=p.tier;});
  rows.sort((a,b)=>selectionScore(b)-selectionScore(a));
  rows.forEach((p,i)=>{p.slate_rank=i+1;});

  let coreCount=0;
  for(const p of rows){
    if(p.tier==='CORE'){
      coreCount++;
      if(coreCount>2){
        p.tier='SECONDARY';p.units=.5;
        appendFlag(p,'Precision Mode Core cap: only the top two Core-qualified plays may remain Core on one slate.');
        p.final_verification=(p.final_verification||'')+' Precision Mode Core cap downgraded this play.';
        recalcQualityForTier(p);
      }
    }
  }

  const actionable=rows.filter(p=>['CORE','SECONDARY'].includes(p.tier)).sort((a,b)=>selectionScore(b)-selectionScore(a));
  actionable.forEach((p,i)=>{p.action_rank=i+1;});
  for(const p of actionable.slice(3)){
    p.tier='WATCH';p.units=0;p.slate_cut=true;p.timing='WAIT — outside the Top-3 actionable slate after cross-slate comparison';
    appendFlag(p,'Cross-slate Top-3 scarcity gate: three stronger standalone exposures already qualified, so this play is held at WATCH rather than forcing additional bankroll exposure.');
    p.final_verification=(p.final_verification||'')+' Cross-slate Top-3 scarcity gate moved this otherwise qualified play to WATCH.';
    recalcQualityForTier(p);
  }
  rows.forEach(p=>{
    p.top_slate=['CORE','SECONDARY'].includes(p.tier)&&num(p.action_rank,99)<=3;
    p.card_role=p.tier==='CORE'?`CORE #${p.action_rank||p.slate_rank}`:p.tier==='SECONDARY'?`SECONDARY #${p.action_rank||p.slate_rank}`:p.tier==='WATCH'?'WATCH':'PASS';
    p.market_selection_score=selectionScore(p);
  });
  rows.sort((a,b)=>selectionScore(b)-selectionScore(a));
  rows.forEach((p,i)=>{p.slate_rank=i+1;});
  return rows;
}
function decimalFromAmerican(price){
  price=Number(price);
  if(!Number.isFinite(price)||price===0)return null;
  return price>0?1+price/100:1+100/(-price);
}
function parlayEligible(p){
  return !!p&&['CORE','SECONDARY'].includes(p.tier)&&p.units>0&&p.top_slate===true&&p.hard_rock&&p.execution_ready&&['CORE_BAND','SECONDARY_BAND'].includes(p.execution_state)&&String(p.data_quality_grade||'').toUpperCase()!=='C'&&num(p.stress_test?.score,0)>=55&&num(p.stress_test?.secondary_survivals,0)>=2&&num(p.decision_quality,0)>=65&&num(p.independent_disagreement,0)<.08&&!p.market_inside_fair_range&&/^BET NOW/i.test(String(p.timing||''));
}
function buildParlay(plays){
  const eligible=(plays||[]).filter(parlayEligible).sort((a,b)=>selectionScore(b)-selectionScore(a));
  const legs=[];
  const events=new Set();
  for(const p of eligible){
    if(events.has(p.event_id))continue;
    const dec=decimalFromAmerican(p.price);if(!dec)continue;
    legs.push(p);events.add(p.event_id);
    if(legs.length===2)break;
  }
  if(legs.length<2)return null;
  const dec=legs.reduce((m,l)=>m*decimalFromAmerican(l.price),1);
  const american=dec>=2?Math.round((dec-1)*100):Math.round(-100/(dec-1));
  return {units:.25,legs:legs.map(l=>({event_id:l.event_id,selection:l.selection,point:l.point,market:l.market,price:l.price,book:l.book,stress_score:l.stress_test?.score,decision_score:l.market_selection_score})),approx_american:american,firewall:'CLEARED',rationale:'Optional only: both legs are standalone Core/Secondary plays, top-slate exposures, inside executable Hard Rock bands, outside the calibrated uncertainty overlap, stress-tested, and from distinct games.'};
}
function lossPaths(candidate,projectionRisks=[]){
  const out=[];
  const worst=candidate?.stress_test?.worst_case;
  if(worst&&!worst.secondary_survives)out.push(`${worst.label}: the stressed edge falls below the Secondary survival threshold.`);
  if(candidate?.execution_state==='SECONDARY_BAND')out.push(`Price sensitivity: further movement beyond ${candidate.downgrade_at} removes the current execution quality.`);
  else if(candidate?.execution_state==='CORE_BAND')out.push(`Price sensitivity: movement past the published Play-To/Downgrade bands can erase the release edge.`);
  if(num(candidate?.independent_disagreement,0)>=.06)out.push('Market disagreement: the sportsbook consensus may be correctly identifying information the independent model is underweighting.');
  for(const r of projectionRisks||[])if(r&&!out.includes(r))out.push(r);
  return out.slice(0,4);
}
function summary(plays,parlay){
  const rows=plays||[];
  const actionable=rows.filter(p=>['CORE','SECONDARY'].includes(p.tier));
  return {policy:'CORE_CAP_2_TOP_3_ACTIONABLE',actionable_count:actionable.length,core_count:rows.filter(p=>p.tier==='CORE').length,secondary_count:rows.filter(p=>p.tier==='SECONDARY').length,watch_count:rows.filter(p=>p.tier==='WATCH').length,top_decision_score:rows.length?Math.max(...rows.map(selectionScore)):0,avg_stress_score:rows.length?+(rows.reduce((s,p)=>s+num(p.stress_test?.score,0),0)/rows.length).toFixed(1):0,parlay_status:parlay?'QUALIFIED':'NO QUALIFIED PARLAY',rules:['Core must survive adverse-scenario stress testing.','Actual Hard Rock price must remain inside the published execution band.','Only the top three standalone exposures may remain actionable.','Parlay legs must independently qualify and pass the parlay firewall.']};
}
module.exports={marketBase,periodInnings,executionState,stressCandidate,selectionScore,enrichCandidate,chooseBestExpression,applySlateDiscipline,parlayEligible,buildParlay,lossPaths,summary};
