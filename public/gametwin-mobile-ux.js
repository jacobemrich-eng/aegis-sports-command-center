'use strict';
(function(){
  const $=s=>document.querySelector(s);
  const state={game:null,broadcast:null,installed:false,focus:false,drawer:false,touch:null};
  function controller(){return window.GameTwinBroadcastController||null;}
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function pct(v){return Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(1)}%`:'—';}
  function currentEvent(){const c=controller(),i=c?.getState?.().index??-1;return state.broadcast?.events?.[i]||null;}
  function modelComparisonHtml(g){
    const m=g?.model_comparison||null,away=g?.away||'Away',home=g?.home||'Home';
    const row=(label,x)=>`<div class="gt-model-row"><span>${esc(label)}</span><b>${pct(x?.gametwin)}</b><b>${pct(x?.aegis)}</b><b>${pct(x?.market)}</b></div>`;
    return `<section class="gt-mobile-matchup"><div class="gt-mobile-sectionhead"><div><span>MODEL MATCHUP</span><b>AEGIS vs GameTwin</b></div><small>${m?.book?esc(m.book):'Pregame comparison'}</small></div><div class="gt-model-head"><span>Side</span><span>GameTwin</span><span>AEGIS</span><span>Market</span></div>${row(away,m?.away)}${row(home,m?.home)}<div class="gt-model-foot">${m?.available?'Same-market pregame probabilities.':'AEGIS/market comparison appears after a matched pregame quote snapshot.'} GameTwin remains shadow-only.</div></section>`;
  }
  function build(){
    const broadcast=$('.broadcast');if(!broadcast)return;
    broadcast.querySelector('.gt-mobile-matchup')?.remove();
    broadcast.insertAdjacentHTML('beforebegin',modelComparisonHtml(state.game));
    let stage=broadcast.querySelector('.broadcastStage');if(!stage)return;
    if(!stage.querySelector('.gt-mobile-scorebug'))stage.insertAdjacentHTML('beforeend',`<div class="gt-mobile-scorebug" aria-live="polite"><div><span id="gtmInning">PRE</span><small id="gtmOuts">0 OUT</small></div><strong id="gtmScore">0–0</strong><span id="gtmEvent">Ready</span></div><div class="gt-swipe-hint">Swipe ← next PA · → previous PA</div><div class="gt-rotate-hint">Rotate phone for the full broadcast view</div>`);
    if(!broadcast.querySelector('.gt-mobile-timeline')){
      const n=state.broadcast?.events?.length||0;
      stage.insertAdjacentHTML('afterend',`<div class="gt-mobile-timeline"><input id="gtmTimeline" type="range" min="0" max="${n}" value="0" step="1" aria-label="Simulation timeline"><span id="gtmTimelineLabel">Ready · 0/${n}</span></div><div class="gt-mobile-dock"><button id="gtmPlay" aria-label="Play or pause">▶</button><button id="gtmPrev" aria-label="Previous plate appearance">◀ PA</button><button id="gtmNext" aria-label="Next plate appearance">PA ▶</button><button id="gtmPbp" aria-label="Toggle play by play">PBP</button><button id="gtmFocus" aria-label="Full screen landscape view">⛶</button></div>`);
    }
    const pbp=broadcast.querySelector('.pbp');if(pbp&&!pbp.parentElement.classList.contains('gt-pbp-drawer')){const wrap=document.createElement('div');wrap.className='gt-pbp-drawer';pbp.parentNode.insertBefore(wrap,pbp);wrap.appendChild(pbp);}
    bind();sync();state.installed=true;
  }
  function bind(){
    const c=controller(),stage=$('.broadcastStage');
    $('#gtmPlay')?.addEventListener('click',()=>c?.togglePlay?.());
    $('#gtmPrev')?.addEventListener('click',()=>c?.prevPA?.());
    $('#gtmNext')?.addEventListener('click',()=>c?.nextPA?.());
    $('#gtmPbp')?.addEventListener('click',toggleDrawer);
    $('#gtmFocus')?.addEventListener('click',toggleFocus);
    $('#gtmTimeline')?.addEventListener('input',e=>c?.seek?.(Number(e.target.value)-1));
    if(stage&&!stage.dataset.gtmSwipe){stage.dataset.gtmSwipe='1';stage.addEventListener('touchstart',touchStart,{passive:true});stage.addEventListener('touchend',touchEnd,{passive:true});}
    document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&state.focus){state.focus=false;document.body.classList.remove('gt-mobile-focus');syncFocusButton();}});
  }
  function touchStart(e){const t=e.changedTouches?.[0];if(t)state.touch={x:t.clientX,y:t.clientY,at:Date.now()};}
  function touchEnd(e){const start=state.touch,t=e.changedTouches?.[0];state.touch=null;if(!start||!t)return;const dx=t.clientX-start.x,dy=t.clientY-start.y;if(Math.abs(dx)<58||Math.abs(dx)<Math.abs(dy)*1.25||Date.now()-start.at>850)return;const c=controller();if(dx<0)c?.nextPA?.();else c?.prevPA?.();}
  function toggleDrawer(){state.drawer=!state.drawer;$('.gt-pbp-drawer')?.classList.toggle('open',state.drawer);$('#gtmPbp')?.classList.toggle('active',state.drawer);}
  async function toggleFocus(){
    const shell=$('.broadcast');if(!shell)return;
    if(state.focus){if(document.fullscreenElement&&document.exitFullscreen)try{await document.exitFullscreen();}catch{}state.focus=false;document.body.classList.remove('gt-mobile-focus');try{await screen.orientation?.unlock?.();}catch{}syncFocusButton();return;}
    state.focus=true;document.body.classList.add('gt-mobile-focus');syncFocusButton();
    if(shell.requestFullscreen)try{await shell.requestFullscreen({navigationUI:'hide'});}catch{}
    try{await screen.orientation?.lock?.('landscape');}catch{}
  }
  function syncFocusButton(){const b=$('#gtmFocus');if(b)b.textContent=state.focus?'✕':'⛶';}
  function sync(){
    const c=controller(),s=c?.getState?.()||{index:-1,playing:false},e=state.broadcast?.events?.[s.index]||null,n=state.broadcast?.events?.length||0;
    const score=e?.score||{away:0,home:0},inning=e?.inning||1,half=e?.half||'top',outs=e?.outs_after??e?.outs_before??0;
    const inn=$('#gtmInning');if(inn)inn.textContent=s.index<0?'PRE':`${String(half).toUpperCase()} ${inning}`;
    const out=$('#gtmOuts');if(out)out.textContent=`${outs} OUT${outs===1?'':'S'}`;
    const sc=$('#gtmScore');if(sc)sc.textContent=`${score.away??0}–${score.home??0}`;
    const ev=$('#gtmEvent');if(ev)ev.textContent=s.index<0?'Ready':(e?.kind==='plate_appearance'?`${e.batter}: ${e.outcome}`:e?.kind?.replaceAll('_',' ')||'Event');
    const range=$('#gtmTimeline');if(range){range.max=String(n);range.value=String(Math.max(0,s.index+1));}
    const label=$('#gtmTimelineLabel');if(label)label.textContent=s.index<0?`Ready · 0/${n}`:`${String(half).toUpperCase()} ${inning} · ${s.index+1}/${n}`;
    const play=$('#gtmPlay');if(play)play.textContent=s.playing?'Ⅱ':'▶';
  }
  document.addEventListener('gametwin:broadcast-ready',e=>{if(window.GameTwinProductionUIEnabled)return;state.game=e.detail?.game||null;state.broadcast=e.detail?.broadcast||null;state.drawer=false;build();});
  document.addEventListener('gametwin:broadcast-step',sync);
  document.addEventListener('gametwin:broadcast-state',sync);
  window.GameTwinMobileUX={version:'1.7.0-mobile-fallback-ux',sync,toggleFocus,toggleDrawer};
})();
