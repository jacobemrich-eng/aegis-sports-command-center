from pathlib import Path

INDEX=Path("public/index.html")
VISUAL=Path("public/visual-v8_1.css")

CSS_MARK="/* ===== AEGIS v8.2 MOBILE COMMAND UI ===== */"
JS_START="<!-- ===== AEGIS v8.2 MOBILE COMMAND UI ===== -->"
JS_END="<!-- ===== /AEGIS v8.2 MOBILE COMMAND UI ===== -->"

css=r'''/* SB101 AEGIS v8.2 â€” Identity & Mobile Command UI */
:root{--v82-bg:#02080d;--v82-panel:#061722;--v82-panel2:#081d2a;--v82-line:#173a4d;--v82-mint:#67f5bf;--v82-cyan:#52dfff;--v82-gold:#ffd66e;--v82-blue:#76bfff;--v82-red:#ff7382;--v82-muted:#8ca5b5}
.v82-topbar,.v82-bottomnav,.v82-overview,.v82-quickorders{display:none}
.v82-shield{position:relative;width:42px;height:48px;display:grid;place-items:center;clip-path:polygon(50% 0,90% 14%,84% 68%,50% 100%,16% 68%,10% 14%);background:linear-gradient(145deg,#70f7c5,#164b3f 48%,#06211e);filter:drop-shadow(0 0 14px rgba(103,245,191,.18))}
.v82-shield:before{content:"";position:absolute;inset:3px;clip-path:inherit;background:#06151d;border:1px solid rgba(255,255,255,.14)}
.v82-shield span{position:relative;z-index:1;font-family:Georgia,serif;font-size:26px;font-style:italic;color:#eefdf7;text-shadow:0 0 14px rgba(103,245,191,.4)}
.v82-brand{display:flex;align-items:center;gap:9px}.v82-brandmicro{font-size:8px;letter-spacing:.18em;color:var(--v82-mint);font-weight:950}.v82-brandname{font-family:Georgia,serif;font-size:19px;letter-spacing:.08em}.v82-topmeta{display:flex;align-items:center;gap:7px;color:#b9cbd5;font-size:11px;font-weight:900}.v82-online-dot{width:7px;height:7px;border-radius:50%;background:var(--v82-mint);box-shadow:0 0 13px var(--v82-mint)}.v82-online-dot.bad{background:var(--v82-red);box-shadow:0 0 13px var(--v82-red)}
.v82-overview,.v82-quickorders{border:1px solid rgba(103,245,191,.18);border-radius:22px;background:radial-gradient(circle at 88% 0,rgba(103,245,191,.06),transparent 25%),linear-gradient(180deg,rgba(6,28,39,.97),rgba(3,15,23,.98));box-shadow:0 18px 45px rgba(0,0,0,.24);padding:18px;margin:14px 0}
.v82-panelhead,.v82-qhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.v82-kicker{display:block;font-size:10px;font-weight:950;letter-spacing:.15em;color:var(--v82-mint);margin-bottom:5px}.v82-panelhead h2,.v82-qhead h2{font-size:24px;line-height:1.05;margin:0;letter-spacing:-.03em}.v82-qhead h2 em{font-style:normal;color:var(--v82-mint);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-left:5px}.v82-linkbtn{border:0;background:transparent;color:#80cfff;font-size:11px;font-weight:900;padding:5px}.v82-refresh{font-size:9px;letter-spacing:.12em;color:#94aab7;border:1px solid #24485d;border-radius:999px;padding:6px 8px}
.v82-statrow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:14px 0}.v82-stat{border:1px solid var(--v82-line);border-radius:12px;background:#03121b;padding:9px 7px;min-width:0}.v82-stat span{display:block;font-size:7px;letter-spacing:.07em;font-weight:950;color:#9fb1bd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v82-stat b{display:block;font-size:23px;margin-top:4px}.v82-stat.fire{border-color:rgba(103,245,191,.31)}.v82-stat.fire b{color:var(--v82-mint)}.v82-stat.secondary{border-color:rgba(255,214,110,.30)}.v82-stat.secondary b{color:var(--v82-gold)}.v82-stat.watch{border-color:rgba(118,191,255,.30)}.v82-stat.watch b{color:var(--v82-blue)}.v82-stat.cut{border-color:rgba(255,115,130,.28)}.v82-stat.cut b{color:var(--v82-red)}
.v82-overview-focus{display:grid;grid-template-columns:auto 1fr;gap:5px 9px;align-items:center;border:1px solid rgba(118,191,255,.22);border-radius:14px;background:rgba(5,25,38,.72);padding:11px;margin:9px 0}.v82-overview-focus span{grid-row:1/3;color:#a9d8ff;font-size:9px;font-weight:950}.v82-overview-focus b{font-size:13px}.v82-overview-focus em{font-style:normal;color:#b9cbd5;font-size:11px}.v82-actionstate{display:flex;flex-direction:column;gap:3px;border-radius:14px;padding:12px 13px;margin-top:10px}.v82-actionstate.ready{border:1px solid rgba(103,245,191,.32);background:rgba(5,43,31,.58)}.v82-actionstate.waiting{border:1px solid rgba(103,245,191,.22);background:rgba(5,32,27,.46)}.v82-actionstate strong{text-transform:uppercase;color:#8dffd8;font-size:11px;letter-spacing:.04em}.v82-actionstate span{color:#9cb1bd;font-size:10px;line-height:1.4}
.v82-order{border:1px solid #1c4a63;border-radius:17px;background:linear-gradient(180deg,#061c2a,#04131d);padding:14px}.v82-order.core{border-color:rgba(103,245,191,.42)}.v82-order.secondary{border-color:rgba(255,214,110,.36)}.v82-order.watch{border-color:rgba(118,191,255,.38)}.v82-orderhead{display:flex;justify-content:space-between;align-items:center;gap:10px}.v82-tier{font-size:9px;font-weight:950;letter-spacing:.08em}.v82-tier.core{color:var(--v82-mint)}.v82-tier.secondary{color:var(--v82-gold)}.v82-tier.watch{color:var(--v82-blue)}.v82-orderhead time{font-size:9px;color:#8ea6b5}.v82-order h3{font-size:15px;margin:9px 0 8px}.v82-orderpick{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.v82-orderpick strong{font-size:29px;line-height:1;letter-spacing:-.04em}.v82-orderpick b{font-size:24px;color:#83c9ff}.v82-orderbook{text-align:right;font-size:8px;letter-spacing:.08em;color:#93a8b4;text-transform:uppercase;margin-top:3px}.v82-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.v82-tags span{border:1px solid #1c4258;border-radius:999px;padding:5px 7px;font-size:8px;color:#9fb3c0}.v82-emptyorder{border:1px dashed #24485d;border-radius:15px;padding:15px;display:flex;flex-direction:column;gap:4px}.v82-emptyorder b{font-size:12px}.v82-emptyorder span{font-size:10px;color:#91a7b4}
.v82-nextrefresh{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid rgba(103,245,191,.22);background:rgba(4,35,27,.54);border-radius:12px;padding:10px 11px;margin:10px 0}.v82-nextrefresh span{font-size:8px;letter-spacing:.08em;color:#7df4c0;font-weight:950}.v82-nextrefresh b{font-size:9px;color:#9deecf}.v82-qualified{border:1px solid #173a4d;border-radius:13px;background:#04131c;padding:11px 12px;display:flex;flex-direction:column;gap:4px}.v82-qualified b{font-size:10px;letter-spacing:.05em}.v82-qualified span{font-size:9px;line-height:1.4;color:#8fa5b3}.v82-orderactions{display:grid;grid-template-columns:1fr;gap:8px;margin-top:10px}.v82-orderactions:has(#v82Lock){grid-template-columns:1fr 1fr}.v82-orderactions .btn{font-size:10px;padding:10px}
@media(max-width:760px){
  body{padding-bottom:76px}.wrap{padding-top:0}.hero{display:none!important}.navwrap{display:none!important}
  .v82-topbar{display:flex;position:sticky;top:0;z-index:50;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;margin:0 -12px 10px;background:linear-gradient(180deg,rgba(2,9,14,.98),rgba(2,9,14,.91));border-bottom:1px solid rgba(103,245,191,.13);backdrop-filter:blur(18px)}
  .v82-bottomnav{display:grid;position:fixed;z-index:60;left:0;right:0;bottom:0;grid-template-columns:repeat(6,1fr);gap:0;padding:6px 5px calc(6px + env(safe-area-inset-bottom));background:rgba(2,9,14,.97);border-top:1px solid rgba(95,170,201,.18);backdrop-filter:blur(20px);box-shadow:0 -12px 34px rgba(0,0,0,.30)}
  .v82-navbtn{border:0;background:transparent;color:#728996;padding:4px 1px;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:7px;font-weight:800;min-width:0}.v82-navicon{font-size:15px;line-height:1}.v82-navbtn.active{color:var(--v82-mint);text-shadow:0 0 14px rgba(103,245,191,.2)}
  .v82-overview,.v82-quickorders{display:block}.autopilotPanel{margin-top:12px}
  #cardContent .slatehero{display:none}
  #cardContent .play{margin-top:10px}
  #cardContent .playhead{padding-right:0}
  .play .pickline{font-size:31px}
}
@media(min-width:761px){.v82-overview,.v82-quickorders{display:block}}
'''
js=r'''(function(){
  'use strict';

  var TABS=[
    ['command','âš¡','Command'],
    ['board','â—‰','Board'],
    ['lab','â™Ÿ','Game Lab'],
    ['card','â—Ž','Final Card'],
    ['results','â–¥','Results'],
    ['models','â—Œ','Models']
  ];

  function q(s,r){return (r||document).querySelector(s)}
  function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function num(v,d){var n=Number(v);return Number.isFinite(n)?n:(d==null?0:d)}
  function price(v){var n=Number(v);return Number.isFinite(n)?(n>0?'+'+Math.round(n):String(Math.round(n))):'â€”'}
  function pointText(p){
    try{if(typeof window.fmtPoint==='function')return window.fmtPoint(p.market,p.point,p.selection)||''}catch(e){}
    if(p.point==null)return '';
    var n=Number(p.point);return Number.isFinite(n)?' '+(n>0?'+':'')+n:'';
  }
  function timeText(iso){
    try{if(typeof window.eventTimeLabel==='function')return window.eventTimeLabel(iso)}catch(e){}
    if(!iso)return 'Time TBD';
    var d=new Date(iso); if(!Number.isFinite(d.getTime()))return 'Time TBD';
    return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',minute:'2-digit'}).format(d)+' ET';
  }
  function currentCard(){return window.LAST&&typeof window.LAST==='object'?window.LAST:null}
  function counts(card){
    var out={CORE:0,SECONDARY:0,WATCH:0,CUT:0};
    if(!card)return out;
    (card.plays||[]).forEach(function(p){
      var t=String(p.tier||'').toUpperCase();
      if(t==='CORE'||t==='SECONDARY'||t==='WATCH')out[t]++;
      else out.CUT++;
    });
    out.CUT+=(card.passes||[]).length;
    return out;
  }
  function bestPlay(card){
    var plays=(card&&card.plays)||[];
    return plays.find(function(p){return p.tier==='CORE'})||
      plays.find(function(p){return p.tier==='SECONDARY'})||
      plays.find(function(p){return p.tier==='WATCH'})||null;
  }
  function sportName(){
    var sel=q('#sport');
    if(sel&&sel.selectedOptions&&sel.selectedOptions[0])return sel.selectedOptions[0].textContent.trim();
    return 'AEGIS';
  }
  function activeTab(){
    var a=q('.navbtn.active');
    return a&&a.dataset.tab?a.dataset.tab:'command';
  }
  function go(tab){
    var original=q('.navbtn[data-tab="'+tab+'"]');
    if(original){original.click();}
    else if(typeof window.nav==='function'){window.nav(tab);}
    syncNav();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function syncNav(){
    var tab=activeTab();
    qa('.v82-navbtn').forEach(function(b){b.classList.toggle('active',b.dataset.tab===tab)});
    var label=q('#v82TopSection'); if(label){
      var found=TABS.find(function(x){return x[0]===tab});
      label.textContent=found?found[2]:'Command';
    }
  }

  function buildShell(){
    var wrap=q('.wrap'); if(!wrap)return;
    if(!q('#v82Topbar')){
      var top=document.createElement('div');
      top.id='v82Topbar'; top.className='v82-topbar';
      top.innerHTML='<div class="v82-brand"><div class="v82-shield"><span>A</span></div><div><div class="v82-brandmicro">SB101</div><div class="v82-brandname">AEGIS</div></div></div><div class="v82-topmeta"><span class="v82-online-dot"></span><span id="v82TopSection">Command</span></div>';
      wrap.insertBefore(top,wrap.firstChild);
    }
    if(!q('#v82BottomNav')){
      var bottom=document.createElement('nav'); bottom.id='v82BottomNav'; bottom.className='v82-bottomnav';
      bottom.innerHTML=TABS.map(function(t){return '<button class="v82-navbtn" data-tab="'+t[0]+'"><span class="v82-navicon">'+t[1]+'</span><span>'+t[2]+'</span></button>'}).join('');
      document.body.appendChild(bottom);
      qa('.v82-navbtn',bottom).forEach(function(b){b.addEventListener('click',function(){go(b.dataset.tab)})});
    }
    syncNav();
  }

  function overviewHtml(card){
    var c=counts(card), qualified=c.CORE+c.SECONDARY, best=bestPlay(card);
    var status=qualified
      ? '<strong>'+qualified+' bankroll-qualified play'+(qualified===1?'':'s')+' ready.</strong><span>AEGIS released only what cleared every gate.</span>'
      : '<strong>No bankroll-qualified bets yet.</strong><span>AEGIS is waiting for evidence, not forcing action.</span>';
    var watch=best&&best.tier==='WATCH'?'<div class="v82-overview-focus"><span>ðŸ‘ WATCH</span><b>'+esc(best.event&&best.event.away_team)+' @ '+esc(best.event&&best.event.home_team)+'</b><em>'+esc(best.selection)+esc(pointText(best))+' '+price(best.price)+'</em></div>':'';
    return '<div class="v82-panelhead"><div><span class="v82-kicker">TODAY\'S OVERVIEW</span><h2>'+esc(sportName())+' Command</h2></div><button class="v82-linkbtn" data-v82-go="card">View Card â€º</button></div>'+statRow(c)+watch+'<div class="v82-actionstate '+(qualified?'ready':'waiting')+'">'+status+'</div>';
  }
  function statRow(c){
    return '<div class="v82-statrow">'+
      stat('CORE',c.CORE,'fire','ðŸ”¥')+
      stat('SECONDARY',c.SECONDARY,'secondary','â˜…')+
      stat('WATCH',c.WATCH,'watch','ðŸ‘')+
      stat('CUT',c.CUT,'cut','âœ‚')+
      '</div>';
  }
  function stat(label,value,cls,icon){return '<div class="v82-stat '+cls+'"><span>'+icon+' '+label+'</span><b>'+value+'</b></div>'}

  function renderOverview(){
    var page=q('#command'); if(!page)return;
    var box=q('#v82Overview');
    if(!box){box=document.createElement('section');box.id='v82Overview';box.className='v82-overview';page.insertBefore(box,page.firstChild)}
    box.innerHTML=overviewHtml(currentCard());
    qa('[data-v82-go]',box).forEach(function(b){b.onclick=function(){go(b.dataset.v82Go)}});
  }

  function orderCard(p){
    if(!p)return '<div class="v82-emptyorder"><b>No active candidate.</b><span>AEGIS will surface one here when a market survives enough gates.</span></div>';
    var ev=p.event||{},tier=String(p.tier||'WATCH').toUpperCase(), cls=tier.toLowerCase();
    return '<article class="v82-order '+cls+'"><div class="v82-orderhead"><span class="v82-tier '+cls+'">'+(tier==='CORE'?'ðŸ”¥':tier==='SECONDARY'?'â˜…':'ðŸ‘')+' '+esc(tier)+'</span><time>'+esc(timeText(ev.commence_time||p.commence_time))+'</time></div><h3>'+esc(ev.away_team)+' @ '+esc(ev.home_team)+'</h3><div class="v82-orderpick"><strong>'+esc(p.selection)+esc(pointText(p))+'</strong><b>'+price(p.price)+'</b></div><div class="v82-orderbook">'+esc(p.book||'Market')+'</div><div class="v82-tags"><span>Data '+esc(p.data_quality_grade||p.data_freshness&&p.data_freshness.grade||'â€”')+'</span><span>Quality '+Math.round(num((typeof window.decisionQuality==='function'?window.decisionQuality(p):0),0))+'</span><span>'+esc(p.timing||'AEGIS monitored')+'</span></div></article>';
  }

  function renderQuickOrders(){
    var page=q('#card'); if(!page)return;
    var card=currentCard(),c=counts(card),best=bestPlay(card),qualified=c.CORE+c.SECONDARY;
    var box=q('#v82QuickOrders');
    if(!box){box=document.createElement('section');box.id='v82QuickOrders';box.className='v82-quickorders';page.insertBefore(box,page.firstChild)}
    box.innerHTML='<div class="v82-qhead"><div><span class="v82-kicker">âš¡ QUICK ORDERS</span><h2>Final Card <em>Today</em></h2></div><span class="v82-refresh">â†» AUTO</span></div>'+statRow(c)+orderCard(best)+'<div class="v82-nextrefresh"><span>â—· NEXT REFRESH</span><b>Scheduled automatically</b></div><div class="v82-qualified"><b>'+(qualified?qualified+' qualified play'+(qualified===1?'':'s'):'CORE / SECONDARY')+'</b><span>'+(qualified?'Only listed plays are bankroll-qualified.':'No qualifying plays yet. AEGIS will promote only what survives all gates.')+'</span></div><div class="v82-orderactions">'+(qualified?'<button id="v82Lock" class="btn primary">LOCK OFFICIAL CARD</button>':'')+'<button id="v82Copy" class="btn secondary">COPY CARD</button></div>';
    var copy=q('#v82Copy'); if(copy)copy.onclick=function(){try{if(typeof window.copyCard==='function')return window.copyCard()}catch(e){} var b=q('#copyCard'); if(b)b.click()};
    var lock=q('#v82Lock'); if(lock)lock.onclick=function(){try{if(typeof window.lockOfficialCard==='function')return window.lockOfficialCard()}catch(e){} var b=q('#lockCard'); if(b)b.click()};
  }

  function updateOnline(){
    var dot=q('.v82-online-dot'), status=q('#status');
    if(dot)dot.classList.toggle('bad',!!(status&&status.classList.contains('bad')));
  }
  function refreshAll(){renderOverview();renderQuickOrders();syncNav();updateOnline()}

  function observe(){
    var targets=['#cardContent','#autopilotMetrics','#latestAutoCard','#status','.navgrid'];
    targets.forEach(function(sel){var el=q(sel);if(!el)return;new MutationObserver(function(){setTimeout(refreshAll,0)}).observe(el,{childList:true,subtree:true,attributes:true})});
    var sport=q('#sport');if(sport)sport.addEventListener('change',function(){setTimeout(refreshAll,50)});
  }

  function initV82(){
    buildShell();refreshAll();observe();
    document.documentElement.classList.add('aegis-v82');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initV82);
  else initV82();
})();
'''

base=VISUAL.read_text()
if CSS_MARK in base:
    base=base.split(CSS_MARK,1)[0].rstrip()+"\n"
VISUAL.write_text(base+"\n\n"+CSS_MARK+"\n"+css.strip()+"\n")

html=INDEX.read_text()
if JS_START in html and JS_END in html:
    before=html.split(JS_START,1)[0]
    after=html.split(JS_END,1)[1]
    html=before+after

block=JS_START+"\n<script>\n"+js.strip()+"\n</script>\n"+JS_END
anchor='<script src="/app.js?v=8.0.0" defer></script>'
if anchor not in html:
    raise SystemExit("Base app.js script tag not found.")
html=html.replace(anchor,anchor+"\n"+block,1)
html=html.replace('v8.0 â€¢ AUTOPILOT & DAILY OPERATIONS','v8.2 â€¢ IDENTITY & MOBILE COMMAND UI')
INDEX.write_text(html)
print("AEGIS v8.2 mobile command UI prepared.")

# ===== v8.2 UTF-8 / iPHONE PASTE CLEANUP =====

html = INDEX.read_text()

fixes = {
    "\u00e2\u0161\u00a1": "&#9889;",
    "\u00e2\u2014\u2030": "&#9673;",
    "\u00e2\u2122\u0178": "&#128300;",
    "\u00e2\u2014\u017d": "&#127919;",
    "\u00e2\u2013\u00a5": "&#128202;",
    "\u00e2\u2014\u0152": "&#129504;",
    "\u00f0\u0178\u2018\u0081": "&#128065;",
    "\u00f0\u0178\u201d\u00a5": "&#128293;",
    "\u00e2\u02dc\u2026": "&#9733;",
    "\u00e2\u0153\u201a": "&#9986;",
    "\u00e2\u20ac\u00ba": "&#8250;",
    "\u00e2\u2020\u00bb": "&#8635;",
    "\u00e2\u2014\u00b7": "&#9655;",
    "\u00e2\u20ac\u201d": "--",
}

for bad, good in fixes.items():
    html = html.replace(bad, good)

html = html.replace(
    "v8.0 \u2022 AUTOPILOT & DAILY OPERATIONS",
    "v8.2 \u2022 IDENTITY & MOBILE COMMAND UI"
)

INDEX.write_text(html)

visual = VISUAL.read_text()

for bad, good in fixes.items():
    visual = visual.replace(bad, good)

VISUAL.write_text(visual)

print("AEGIS v8.2 encoding cleanup applied.")
