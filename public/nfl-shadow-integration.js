(function(){
  'use strict';

  var NFL='americanfootball_nfl', cache={sport:null,games:[],scoreboard:null,loaded:false,error:null}, loading=null;
  var baseRenderLab=window.renderLab;
  var baseRenderModels=window.renderModels;

  function e(value){return typeof window.esc==='function'?window.esc(value):String(value==null?'':value)}
  function n(value,digits){if(value==null||value==='')return '—';var x=Number(value);return Number.isFinite(x)?x.toFixed(digits==null?1:digits):'—'}
  function p(value){if(value==null||value==='')return '—';var x=Number(value);return Number.isFinite(x)?(x*100).toFixed(1)+'%':'—'}
  function textList(items,empty){return Array.isArray(items)&&items.length?'<ul>'+items.map(function(x){return '<li>'+e(x)+'</li>'}).join('')+'</ul>':'<p class="subtle small">'+e(empty)+'</p>'}
  function norm(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'')}

  function currentSport(){var select=document.querySelector('#sport');return select?select.value:null}
  function currentAnalysis(){
    var id=document.querySelector('#labGame')?.value||window.ACTIVE_GAME;
    return (window.LAST?.analyses||[]).find(function(row){return row.event?.id===id})||null;
  }
  function matches(game,analysis){
    if(!analysis)return false;
    var event=analysis.event||{};
    return game.game_id===event.id || (
      norm(game.home_team)===norm(event.home_team) && norm(game.away_team)===norm(event.away_team)
    );
  }
  function findShadow(analysis){return cache.games.find(function(game){return matches(game,analysis)})||null}

  function fetchShadow(){
    if(currentSport()!==NFL){cache={sport:currentSport(),games:[],scoreboard:null,loaded:true,error:null};return Promise.resolve(cache)}
    if(cache.loaded&&cache.sport===NFL)return Promise.resolve(cache);
    if(loading)return loading;
    loading=Promise.all([
      fetch('/api/shadow/games?sport='+encodeURIComponent(NFL),{cache:'no-store'}).then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json()}),
      fetch('/api/shadow/scoreboard?sport='+encodeURIComponent(NFL),{cache:'no-store'}).then(function(response){return response.ok?response.json():null}).catch(function(){return null})
    ])
      .then(function(rows){var data=rows[0];cache={sport:NFL,games:data.games||[],scoreboard:rows[1],loaded:true,error:null,flags:data.flags||{}};return cache})
      .catch(function(error){cache={sport:NFL,games:[],scoreboard:null,loaded:true,error:error.message||String(error)};return cache})
      .finally(function(){loading=null});
    return loading;
  }

  function projection(score){return e(score?.away==null?'—':n(score.away))+' – '+e(score?.home==null?'—':n(score.home))}
  function expressionLabel(x){
    if(!x)return 'No qualified expression';
    return [x.name||x.selection||x.market_type||x.market,x.point,x.odds==null?x.price:x.odds,x.book].filter(function(v){return v!=null&&v!==''}).join(' ');
  }

  function shadowPanel(analysis,shadow){
    var production=analysis.projection||{}, market=shadow.market||{}, challenger=market.challenger_projection||{};
    var firewall=shadow.governance?.disagreement_firewall||shadow.diagnostics?.sport_specific?.disagreement_firewall||{};
    var expression=shadow.decision?.best_market_expression;
    return '<div class="panel nfl-shadow-panel" id="nflShadowComparison">'+
      '<div class="sectionhead"><div><div class="eyebrow">NFL SHADOW / CHALLENGER</div><h2>Three-way projection comparison</h2><p class="subtle small">Research-only. This output cannot enter the official Final Card or bankroll ledger.</p></div><span class="shadow-lock">SHADOW ONLY</span></div>'+
      '<div class="shadow-compare">'+
        '<div class="shadow-source production"><span>PRODUCTION</span><b>CURRENT AEGIS</b><strong>'+projection(production.projected_score)+'</strong><small>Margin '+n(production.projected_margin_home)+' · Total '+n(production.projected_total)+'</small></div>'+
        '<div class="shadow-source challenger"><span>SHADOW / CHALLENGER</span><b>NFL SIMULATOR</b><strong>'+projection(shadow.projection?.projected_score)+'</strong><small>Margin '+n(shadow.projection?.margin)+' · Total '+n(shadow.projection?.total)+'</small></div>'+
        '<div class="shadow-source market"><span>INDEPENDENT MARKET</span><b>MARKET PROJECTION</b><strong>Margin '+n(challenger.margin)+'</strong><small>Total '+n(challenger.total)+' · Post-model '+n(market.post_model_projection?.margin)+' / '+n(market.post_model_projection?.total)+'</small></div>'+
      '</div>'+
      '<div class="shadow-metrics">'+
        '<div><span>MODEL AGREEMENT</span><b>'+e(shadow.quality?.ensemble_agreement||'—')+'</b></div>'+
        '<div><span>UNCERTAINTY</span><b>'+n(shadow.quality?.uncertainty,2)+'</b></div>'+
        '<div><span>DISPERSION</span><b>'+n(shadow.quality?.model_dispersion,2)+'</b></div>'+
        '<div><span>FIREWALL</span><b class="'+(firewall.status==='NORMAL'?'good':firewall.status==='PASS'?'bad':'warn')+'">'+e(firewall.status||'—')+'</b></div>'+
      '</div>'+
      '<div class="shadow-grid">'+
        '<div><h3>Best market expression</h3><p><b>'+e(expressionLabel(expression))+'</b></p><p class="small">Shadow decision: <b>'+e(shadow.decision?.status||'PASS')+'</b> · '+e(shadow.decision?.execution_status||'PASS')+'</p><p class="small">Fair '+p(market.fair_probability)+' · EV '+p(market.ev)+' · Play-to '+e(market.play_to==null?'—':market.play_to)+'</p></div>'+
        '<div><h3>Distribution / tail risk</h3><pre>'+e(JSON.stringify(shadow.projection?.percentiles||{},null,2))+'</pre>'+textList(shadow.diagnostics?.tail_risks,'No tail-risk narrative supplied by the simulator.')+'</div>'+
        '<div><h3>Why it wins</h3>'+textList(shadow.diagnostics?.why_it_wins,'No win-path narrative supplied by the simulator.')+'</div>'+
        '<div><h3>How it loses</h3>'+textList(shadow.diagnostics?.how_it_loses,'No loss-path narrative supplied by the simulator.')+'</div>'+
      '</div>'+
      '<div class="notice warning"><b>Disagreement firewall:</b> '+e(firewall.reason||'Unavailable')+'. Large disagreement is uncertainty, not automatic edge.</div>'+
    '</div>';
  }

  function renderShadowLab(){
    var root=document.querySelector('#labContent');
    if(!root||currentSport()!==NFL)return;
    root.querySelector('#nflShadowComparison')?.remove();
    var analysis=currentAnalysis();
    if(!analysis)return;
    if(!cache.loaded){
      root.insertAdjacentHTML('beforeend','<div class="panel nfl-shadow-panel" id="nflShadowComparison"><div class="eyebrow">NFL SHADOW / CHALLENGER</div><p class="subtle">Loading isolated simulator output…</p></div>');
      fetchShadow().then(renderShadowLab);
      return;
    }
    var game=findShadow(analysis);
    if(!game){
      root.insertAdjacentHTML('beforeend','<div class="panel nfl-shadow-panel" id="nflShadowComparison"><div class="eyebrow">NFL SHADOW / CHALLENGER</div><h2>No matching shadow projection</h2><p class="subtle">Current AEGIS remains fully available. Missing or failed shadow data falls back cleanly and never affects the Final Card.</p></div>');
      return;
    }
    root.insertAdjacentHTML('beforeend',shadowPanel(analysis,game));
  }

  function record(value){return ['WIN','LOSS','PUSH'].map(function(key){return key[0]+': '+Number(value?.[key]||0)}).join(' · ')}
  function scoreboardHtml(board){
    if(!board)return '<div class="notice warning"><b>Shadow scoreboard unavailable.</b> Projection ingestion remains isolated and production AEGIS is unaffected.</div>';
    var buckets=Object.keys(board.disagreement_buckets||{}).map(function(key){var row=board.disagreement_buckets[key];return '<tr><td>'+e(key)+'</td><td>'+e(row.games)+'</td><td>'+n(row.margin_mae)+'</td><td>'+n(row.market_margin_mae)+'</td><td>'+n(row.total_mae)+'</td><td>'+n(row.market_total_mae)+'</td></tr>'}).join('');
    return '<div class="sectionhead"><div><div class="eyebrow">SHADOW / RESEARCH ONLY</div><h2>2026 NFL live validation scoreboard</h2></div><span class="shadow-lock">'+e(board.monitoring_state)+'</span></div>'+
      '<div class="shadow-metrics">'+
        '<div><span>LIVE SHADOW</span><b>'+e(board.live_shadow_games)+'</b></div><div><span>GRADED</span><b>'+e(board.graded_games)+'</b></div>'+
        '<div><span>BLIND / CAL MARGIN MAE</span><b>'+n(board.blind_margin_mae)+' / '+n(board.calibrated_margin_mae)+'</b></div><div><span>MARKET / CLOSE MARGIN MAE</span><b>'+n(board.market_margin_mae)+' / '+n(board.closing_market_margin_mae)+'</b></div>'+
        '<div><span>BLIND / CAL TOTAL MAE</span><b>'+n(board.blind_total_mae)+' / '+n(board.calibrated_total_mae)+'</b></div><div><span>MARKET / CLOSE TOTAL MAE</span><b>'+n(board.market_total_mae)+' / '+n(board.closing_market_total_mae)+'</b></div>'+
        '<div><span>COVER BRIER</span><b>'+n(board.cover_brier,3)+'</b></div><div><span>OVER BRIER</span><b>'+n(board.over_brier,3)+'</b></div>'+
        '<div><span>SPREAD / TOTAL CLV</span><b>'+n(board.mean_spread_clv,2)+' / '+n(board.mean_total_clv,2)+'</b></div><div><span>SHADOW ERRORS</span><b>'+e(board.shadow_errors)+'</b></div>'+
      '</div>'+
      '<p class="small"><b>ATS diagnostic:</b> '+e(record(board.ats_record))+' &nbsp; <b>Total diagnostic:</b> '+e(record(board.total_record))+'</p>'+
      '<p class="small"><b>Firewall:</b> PASS '+e(board.firewall_counts?.PASS||0)+' · Secondary max '+e(board.firewall_counts?.SECONDARY_MAX||0)+' · Core blocked '+e(board.firewall_counts?.CORE_BLOCK||0)+' · Normal '+e(board.firewall_counts?.NORMAL||0)+'</p>'+
      '<p class="small"><b>Model-vs-market error wins:</b> margin '+e(board.model_vs_market_error_wins?.margin||0)+' · total '+e(board.model_vs_market_error_wins?.total||0)+' &nbsp; <b>Data quality:</b> '+e(JSON.stringify(board.data_quality_grades||{}))+'</p>'+
      (board.sample_warning?'<div class="notice warning"><b>Sample warning:</b> '+e(board.sample_warning)+'</div>':'')+
      '<div class="tablewrap"><table><thead><tr><th>Disagreement</th><th>N</th><th>Blind margin</th><th>Market margin</th><th>Blind total</th><th>Market total</th></tr></thead><tbody>'+(buckets||'<tr><td colspan="6">No graded bucket evidence yet.</td></tr>')+'</tbody></table></div>'+
      '<p class="subtle small">Champion: '+e(board.current_champion)+' · Market Challenger: '+e(board.market_challenger)+' · Historical predecessor: '+e(board.historical_predecessor)+'. Monitoring can request review but can never promote or release automatically.</p>';
  }

  window.renderLab=function(){if(typeof baseRenderLab==='function')baseRenderLab();renderShadowLab()};
  window.renderModels=function(){
    if(typeof baseRenderModels==='function')baseRenderModels();
    var page=document.querySelector('#models');
    page?.querySelector('#nflShadowRegistry')?.remove();
    if(!page||currentSport()!==NFL)return;
    if(!cache.loaded)fetchShadow().then(function(){window.renderModels()});
    var panel=document.createElement('div');
    panel.id='nflShadowRegistry';panel.className='panel nfl-shadow-panel';
    panel.innerHTML='<div class="eyebrow">CHAMPION / CHALLENGER</div><h2>NFL v1.0 internal shadow Champion</h2><div class="counterline"><span class="chip warn">SHADOW ONLY</span><span class="chip">v0.8 HISTORICAL PREDECESSOR</span><span class="chip">AUTO-RELEASE BLOCKED</span></div><p class="subtle">The untouched 2025 gate promoted the v1.0 internal challenger. Its blind projection is produced first; the independent v0.9 Market Challenger, calibrated blend and disagreement firewall run afterward. The firewall remains 7+ PASS, 5–7 Secondary maximum, and 3–5 Core blocked.</p><a class="btn ghost" href="/nfl-v10-feature-lab.html" target="_blank" rel="noopener">OPEN v1.0 FEATURE LAB</a><hr>'+scoreboardHtml(cache.scoreboard);
    page.appendChild(panel);
  };

  document.querySelector('#sport')?.addEventListener('change',function(){cache={sport:null,games:[],scoreboard:null,loaded:false,error:null};if(currentSport()===NFL)fetchShadow()});
})();
