(async()=>{
  const el=document.getElementById('status');
  const fmt=x=>Number.isFinite(Number(x))?Number(x).toFixed(3):'—';
  const cls=s=>String(s||'').includes('HIGH_INTEREST')?'good':String(s||'').includes('BLOCKED')?'bad':'warn';
  try{
    const r=await fetch('/data/nfl-shadow-status.json',{cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const x=await r.json();
    const h=x.historical_report||{};
    const c=h.challenger||{};
    const m=h.market_challenger||{};
    const sr=h.shadow_readiness||{};
    el.innerHTML=`
      <div class="card wide"><div class="k">Shadow Readiness</div><div class="v ${cls(sr.status)}">${sr.status||'UNKNOWN'}</div><div class="muted">Real betting release: ${sr.real_betting_release_allowed?'ALLOWED':'BLOCKED'} · Manual verification: ${sr.manual_verification_required?'REQUIRED':'OPTIONAL'}</div></div>
      <div class="card"><div class="k">Holdout Games</div><div class="v">${h.holdout_games??'—'}</div></div>
      <div class="card"><div class="k">Internal Margin MAE</div><div class="v">${fmt(c.margin_mae)}</div></div>
      <div class="card"><div class="k">Market Margin MAE</div><div class="v">${fmt(m.margin_mae)}</div></div>
      <div class="card"><div class="k">Internal Total MAE</div><div class="v">${fmt(c.total_mae)}</div></div>
      <div class="card"><div class="k">Market Total MAE</div><div class="v">${fmt(m.total_mae)}</div></div>
      <div class="card"><div class="k">ATS Brier</div><div class="v">${fmt(c.cover_brier)}</div></div>
      <div class="card"><div class="k">Total Brier</div><div class="v">${fmt(c.over_brier)}</div></div>
      <div class="card"><div class="k">Feature Count</div><div class="v">${h.feature_count??'—'}</div></div>
      <div class="card wide"><div class="k">Leakage Guard</div><div class="v ${h.leakage_guard?.market_lines_in_internal_features===false?'good':'bad'}">${h.leakage_guard?.market_lines_in_internal_features===false?'PASS':'CHECK REQUIRED'}</div><div class="muted">Sportsbook spread/total are evaluated as an independent Market Challenger, not internal model features.</div></div>
    `;
  }catch(e){
    el.innerHTML=`<div class="card wide"><div class="k">Shadow Data</div><div class="v warn">Not generated yet</div><p>Run the AEGIS NFL historical workflow to publish the first real shadow report.</p><code>${String(e.message||e)}</code></div>`;
  }
})();
