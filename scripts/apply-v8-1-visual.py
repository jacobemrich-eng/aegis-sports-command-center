from pathlib import Path

INDEX = Path("public/index.html")
CSS = Path("public/visual-v8_3.css")
JS = Path("public/app-v8_3.js")

css = r"""
/* =========================================================
   SB101 AEGIS v8.3 â€” GAME INTELLIGENCE & PERSONALITY
   Presentation-only intelligence layer.
   ========================================================= */

:root{
  --v83-accent:#67f5bf;
  --v83-accent2:#52dfff;
  --v83-warn:#ffd66e;
  --v83-danger:#ff7382;
  --v83-panel:#061a27;
  --v83-panel2:#04131d;
  --v83-line:rgba(102,183,217,.22);
}

html[data-v83-sport="baseball_mlb"]{
  --v83-accent:#67f5bf;
  --v83-accent2:#52dfff;
}
html[data-v83-sport="americanfootball_ncaaf"],
html[data-v83-sport="americanfootball_nfl"],
html[data-v83-sport="americanfootball_nfl_preseason"]{
  --v83-accent:#ffd66e;
  --v83-accent2:#ff9f79;
}
html[data-v83-sport="basketball_wnba"]{
  --v83-accent:#ff9ad5;
  --v83-accent2:#b9a7ff;
}
html[data-v83-sport="baseball_kbo"]{
  --v83-accent:#6ce3ff;
  --v83-accent2:#67f5bf;
}
html[data-v83-sport="baseball_npb"]{
  --v83-accent:#ff9393;
  --v83-accent2:#ffd66e;
}

/* Sport identity atmosphere */
.aegis-v83 body:before{
  background:
    radial-gradient(circle at 12% 0, color-mix(in srgb,var(--v83-accent) 14%,transparent), transparent 28%),
    radial-gradient(circle at 92% 12%, color-mix(in srgb,var(--v83-accent2) 10%,transparent), transparent 24%),
    linear-gradient(180deg,#051823 0,#030d14 55%,#02070c 100%);
}

.aegis-v83 .v82-shield{
  background:linear-gradient(145deg,var(--v83-accent),color-mix(in srgb,var(--v83-accent) 38%,#05231e) 50%,#051816);
  filter:drop-shadow(0 0 16px color-mix(in srgb,var(--v83-accent) 22%,transparent));
}

.aegis-v83 .v82-online-dot{
  background:var(--v83-accent);
  box-shadow:0 0 14px var(--v83-accent);
}

.aegis-v83 .v82-navbtn.active{
  color:var(--v83-accent);
}

/* -------- Game Lab Intel Brief -------- */
.v83-intel{
  display:none;
  margin:0 0 18px;
  border:1px solid color-mix(in srgb,var(--v83-accent) 28%,#173b4d);
  border-radius:24px;
  overflow:hidden;
  background:
    radial-gradient(circle at 90% 4%,color-mix(in srgb,var(--v83-accent) 10%,transparent),transparent 28%),
    linear-gradient(180deg,rgba(7,31,44,.98),rgba(3,16,25,.99));
  box-shadow:0 22px 54px rgba(0,0,0,.25);
}

.v83-matchup{
  position:relative;
  display:grid;
  grid-template-columns:1fr auto 1fr;
  gap:12px;
  align-items:center;
  padding:20px 18px 16px;
  border-bottom:1px solid rgba(104,181,211,.15);
}

.v83-matchup:after{
  content:"";
  position:absolute;
  left:50%;
  top:18%;
  bottom:18%;
  width:1px;
  background:linear-gradient(transparent,var(--v83-line),transparent);
}

.v83-team{
  min-width:0;
}
.v83-team.home{text-align:right}

.v83-teammark{
  width:52px;
  height:52px;
  display:grid;
  place-items:center;
  margin-bottom:9px;
  border-radius:16px;
  border:1px solid color-mix(in srgb,var(--v83-accent) 35%,#21495b);
  background:
    linear-gradient(145deg,color-mix(in srgb,var(--v83-accent) 14%,#09202c),#03121b);
  font-family:Georgia,serif;
  font-size:22px;
  font-weight:900;
  color:#f1fbff;
  box-shadow:0 0 24px color-mix(in srgb,var(--v83-accent) 8%,transparent);
}
.v83-team.home .v83-teammark{margin-left:auto}

.v83-team small{
  display:block;
  font-size:8px;
  letter-spacing:.14em;
  color:#8ba5b5;
  font-weight:950;
  text-transform:uppercase;
}
.v83-team strong{
  display:block;
  margin-top:3px;
  font-size:15px;
  line-height:1.2;
}

.v83-versus{
  position:relative;
  z-index:2;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:4px;
  min-width:70px;
}
.v83-versus span{
  font-size:8px;
  letter-spacing:.16em;
  color:#8ca5b5;
  font-weight:950;
}
.v83-versus b{
  font-size:11px;
  color:var(--v83-accent);
}

.v83-verdict{
  margin:14px 18px 0;
  padding:13px 14px;
  border-radius:15px;
  border:1px solid rgba(118,191,255,.24);
  background:rgba(6,28,41,.76);
}
.v83-verdict.core{
  border-color:color-mix(in srgb,#67f5bf 45%,transparent);
  background:rgba(5,45,32,.58);
}
.v83-verdict.secondary{
  border-color:rgba(255,214,110,.38);
  background:rgba(48,37,10,.48);
}
.v83-verdict.watch{
  border-color:rgba(118,191,255,.36);
}
.v83-verdict.pass{
  border-color:rgba(255,115,130,.34);
  background:rgba(51,18,25,.42);
}
.v83-verdict small{
  display:block;
  font-size:8px;
  font-weight:950;
  letter-spacing:.13em;
  color:#91a9b8;
}
.v83-verdict strong{
  display:block;
  margin:4px 0 2px;
  font-size:17px;
  letter-spacing:.01em;
}
.v83-verdict.core strong{color:#83ffd3}
.v83-verdict.secondary strong{color:#ffe38d}
.v83-verdict.watch strong{color:#9ed5ff}
.v83-verdict.pass strong{color:#ff9da8}
.v83-verdict span{
  color:#9db2bf;
  font-size:11px;
  line-height:1.45;
}

.v83-tabs{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:5px;
  padding:14px 18px 0;
}
.v83-tab{
  border:1px solid rgba(98,171,201,.18);
  border-radius:11px;
  padding:9px 3px;
  background:#03131d;
  color:#89a0ae;
  font-size:8px;
  font-weight:950;
  letter-spacing:.07em;
}
.v83-tab.active{
  color:#eafff7;
  border-color:color-mix(in srgb,var(--v83-accent) 45%,transparent);
  background:color-mix(in srgb,var(--v83-accent) 10%,#041923);
  box-shadow:0 0 20px color-mix(in srgb,var(--v83-accent) 7%,transparent);
}

.v83-tabbody{
  padding:14px 18px 18px;
}

.v83-expression{
  border:1px solid rgba(99,174,204,.20);
  border-radius:17px;
  background:rgba(3,17,26,.66);
  padding:14px;
  margin-bottom:12px;
}
.v83-expression small{
  display:block;
  color:#8fa6b4;
  font-size:8px;
  font-weight:950;
  letter-spacing:.12em;
  margin-bottom:5px;
}
.v83-expression strong{
  display:block;
  font-size:24px;
  line-height:1.08;
}
.v83-expression span{
  display:block;
  color:#9fb5c2;
  font-size:10px;
  margin-top:6px;
}

.v83-score{
  display:grid;
  grid-template-columns:1fr auto 1fr;
  align-items:center;
  gap:9px;
  padding:13px;
  border:1px solid rgba(99,174,204,.18);
  border-radius:16px;
  background:rgba(2,15,23,.62);
  margin-bottom:12px;
}
.v83-score div:first-child{text-align:left}
.v83-score div:last-child{text-align:right}
.v83-score small{
  display:block;
  font-size:8px;
  color:#8299a7;
}
.v83-score strong{
  font-size:18px;
}
.v83-score b{
  font-size:24px;
  color:var(--v83-accent);
}

.v83-metrics{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:7px;
  margin-bottom:12px;
}
.v83-metric{
  border:1px solid rgba(94,166,196,.18);
  border-radius:13px;
  padding:10px 8px;
  background:rgba(2,15,23,.64);
  min-width:0;
}
.v83-metric span{
  display:block;
  font-size:7px;
  text-transform:uppercase;
  letter-spacing:.08em;
  color:#8299a7;
  font-weight:950;
}
.v83-metric b{
  display:block;
  margin-top:4px;
  font-size:15px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.v83-dna{
  display:grid;
  gap:9px;
}
.v83-gauge{
  display:grid;
  grid-template-columns:82px 1fr 45px;
  align-items:center;
  gap:8px;
}
.v83-gauge label{
  font-size:8px;
  font-weight:950;
  letter-spacing:.07em;
  color:#91a8b5;
  text-transform:uppercase;
}
.v83-track{
  height:7px;
  border-radius:99px;
  background:#102d3d;
  overflow:hidden;
}
.v83-track i{
  display:block;
  height:100%;
  border-radius:inherit;
  background:linear-gradient(90deg,var(--v83-accent2),var(--v83-accent));
  box-shadow:0 0 10px color-mix(in srgb,var(--v83-accent) 15%,transparent);
}
.v83-gauge b{
  text-align:right;
  font-size:10px;
}

.v83-list{
  display:grid;
  gap:8px;
}
.v83-listitem{
  padding:11px 12px;
  border:1px solid rgba(94,166,196,.18);
  border-radius:13px;
  background:rgba(2,15,23,.62);
}
.v83-listitem small{
  display:block;
  color:#8299a7;
  font-size:7px;
  letter-spacing:.08em;
  font-weight:950;
  text-transform:uppercase;
  margin-bottom:4px;
}
.v83-listitem span{
  display:block;
  color:#d7e5eb;
  font-size:11px;
  line-height:1.45;
}

.v83-path{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:5px;
  margin-top:13px;
}
.v83-step{
  position:relative;
  padding:9px 5px;
  border-radius:11px;
  border:1px solid rgba(96,168,198,.18);
  background:#03131c;
  text-align:center;
}
.v83-step b{
  display:block;
  color:var(--v83-accent);
  font-size:11px;
}
.v83-step span{
  display:block;
  font-size:6.5px;
  margin-top:3px;
  color:#899eaa;
  text-transform:uppercase;
  letter-spacing:.04em;
}
.v83-step.fail{
  border-color:rgba(255,115,130,.28);
}
.v83-step.fail b{color:#ff8794}
.v83-step.hold{
  border-color:rgba(118,191,255,.28);
}
.v83-step.hold b{color:#8dcbff}

/* -------- Final Card personality -------- */
.v83-cardvoice{
  margin:10px 0 0;
  padding:10px 11px;
  border-radius:12px;
  border:1px solid rgba(118,191,255,.22);
  background:rgba(4,25,37,.70);
}
.v83-cardvoice strong{
  display:block;
  font-size:9px;
  letter-spacing:.09em;
}
.v83-cardvoice span{
  display:block;
  margin-top:3px;
  color:#94aab7;
  font-size:9px;
}

.v83-cardvoice.core{border-color:rgba(103,245,191,.35)}
.v83-cardvoice.core strong{color:#82ffd2}
.v83-cardvoice.secondary{border-color:rgba(255,214,110,.32)}
.v83-cardvoice.secondary strong{color:#ffe18a}
.v83-cardvoice.watch{border-color:rgba(118,191,255,.32)}
.v83-cardvoice.watch strong{color:#9bd4ff}
.v83-cardvoice.pass{border-color:rgba(255,115,130,.28)}
.v83-cardvoice.pass strong{color:#ff9aa5}

/* Board / page polish */
.aegis-v83 .gamecard{
  position:relative;
}
.aegis-v83 .gamecard:before{
  content:"";
  position:absolute;
  top:0;
  left:15%;
  right:15%;
  height:1px;
  background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--v83-accent) 40%,transparent),transparent);
  opacity:.35;
}
.aegis-v83 .eyebrow{
  color:var(--v83-accent);
}

@media(max-width:760px){
  .v83-intel{display:block}
  .v83-matchup{padding:17px 14px 14px}
  .v83-tabs{padding:12px 14px 0}
  .v83-tabbody{padding:12px 14px 15px}
  .v83-verdict{margin:12px 14px 0}
  .v83-teammark{width:45px;height:45px;font-size:19px}
  .v83-team strong{font-size:12px}
  .v83-versus{min-width:56px}
  .v83-expression strong{font-size:22px}
  .v83-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}
}

@media(min-width:761px){
  .v83-intel{display:block}
}
"""
js = r"""
(function(){
  "use strict";

  var activeTab="thesis";
  var lastKey="";

  function q(s,r){return (r||document).querySelector(s)}
  function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
  function esc(v){
    return String(v==null?"":v).replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function n(v,d){
    var x=Number(v);
    return Number.isFinite(x)?x:(d==null?0:d);
  }
  function pct(v){
    var x=Number(v);
    return Number.isFinite(x)?(x*100).toFixed(1)+"%":"--";
  }
  function am(v){
    var x=Number(v);
    if(!Number.isFinite(x))return "--";
    return x>0?"+"+Math.round(x):String(Math.round(x));
  }
  function pt(v){
    if(v==null)return "";
    var x=Number(v);
    return Number.isFinite(x)?" "+(x>0?"+":"")+x:"";
  }
  function clamp(v){return Math.max(0,Math.min(100,n(v)))}
  function card(){return window.LAST&&typeof window.LAST==="object"?window.LAST:null}
  function selectedId(){
    var s=q("#labGame");
    return (s&&s.value)||window.ACTIVE_GAME||null;
  }
  function analysis(){
    var c=card(), id=selectedId();
    if(!c||!Array.isArray(c.analyses))return null;
    return c.analyses.find(function(a){
      return a&&a.event&&(a.event.id===id||a.event_id===id);
    }) || c.analyses[0] || null;
  }
  function allCandidates(a){
    if(!a)return [];
    var rows=[];
    if(a.market&&Array.isArray(a.market.all))rows=rows.concat(a.market.all);
    var c=card();
    if(c&&Array.isArray(c.plays)){
      rows=rows.concat(c.plays.filter(function(p){
        return p.event_id===(a.event&&a.event.id);
      }));
    }
    return rows;
  }
  function candidate(a){
    if(!a)return null;
    var rows=allCandidates(a);
    var order=["CORE","SECONDARY","WATCH"];
    for(var i=0;i<order.length;i++){
      var hit=rows.find(function(x){return String(x.tier||"").toUpperCase()===order[i]});
      if(hit)return hit;
    }
    if(a.market&&a.market.best)return a.market.best;
    return rows[0]||null;
  }
  function initials(name){
    var words=String(name||"").trim().split(/\s+/).filter(Boolean);
    if(!words.length)return "--";
    if(words.length===1)return words[0].slice(0,2).toUpperCase();
    return (words[0][0]+words[words.length-1][0]).toUpperCase();
  }
  function sportKey(){
    var s=q("#sport");
    return (s&&s.value)||"baseball_mlb";
  }
  function timeText(iso){
    if(!iso)return "Time TBD";
    var d=new Date(iso);
    if(!Number.isFinite(d.getTime()))return "Time TBD";
    return new Intl.DateTimeFormat("en-US",{
      timeZone:"America/New_York",
      weekday:"short",
      hour:"numeric",
      minute:"2-digit"
    }).format(d)+" ET";
  }
  function tierOf(p){
    return String((p&&p.tier)||"PASS").toUpperCase();
  }
  function verdict(p){
    var t=tierOf(p);
    if(t==="CORE")return ["EDGE SURVIVED","Bankroll qualified. Stay inside the listed execution band.","core"];
    if(t==="SECONDARY")return ["QUALIFIED â€” REDUCED EXPOSURE","The thesis survived, but not with full Core distinction.","secondary"];
    if(t==="WATCH")return ["HOLD THE LINE","The economics survived. A confirmation or support gate is still open.","watch"];
    return ["CUT â€” GATE FAILED","AEGIS found a thesis, but it did not earn bankroll exposure.","pass"];
  }
  function bestReason(p){
    if(!p)return "No active market expression.";
    if(p.final_verification)return p.final_verification;
    if(p.timing)return p.timing;
    if(Array.isArray(p.sanity_flags)&&p.sanity_flags.length)return p.sanity_flags[0];
    if(p.why)return p.why;
    return "AEGIS is waiting for stronger independent evidence.";
  }
  function gauge(label,value,invert){
    var x=clamp(value),fill=invert?100-x:x;
    return '<div class="v83-gauge"><label>'+esc(label)+'</label>'+
      '<div class="v83-track"><i style="width:'+fill.toFixed(0)+'%"></i></div>'+
      '<b>'+x.toFixed(0)+'/100</b></div>';
  }
  function metric(label,value){
    return '<div class="v83-metric"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';
  }
  function listItem(label,value){
    if(value==null||value==="")return "";
    return '<div class="v83-listitem"><small>'+esc(label)+'</small><span>'+esc(value)+'</span></div>';
  }
  function projectionScore(a,p){
    var pr=(a&&a.projection)||{}, s=(p&&p.market_projection_score)||pr.projected_score||{};
    return {
      away:Number.isFinite(Number(s.away))?Number(s.away):null,
      home:Number.isFinite(Number(s.home))?Number(s.home):null
    };
  }
  function pathHtml(p,a){
    var support=n(p&&p.market_support_strength,0);
    var quality=n((p&&p.decision_quality)||(a&&a.projection&&a.projection.data_quality),0);
    var edge=n(p&&p.adjusted_edge,0)*100;
    var tier=tierOf(p);
    function step(num,label,state){
      return '<div class="v83-step '+(state||"")+'"><b>'+num+'</b><span>'+esc(label)+'</span></div>';
    }
    return '<div class="v83-path">'+
      step("01","Blind thesis",quality>=55?"":"fail")+
      step("02","Market challenge",Math.abs(edge)>=2?"":"fail")+
      step("03","Support gate",support>=60?"":tier==="WATCH"?"hold":"fail")+
      step("04","Release",tier==="CORE"||tier==="SECONDARY"?"":tier==="WATCH"?"hold":"fail")+
      '</div>';
  }
  function thesisBody(a,p){
    var e=a.event||{}, pr=a.projection||{}, sc=projectionScore(a,p);
    var quality=n((p&&p.decision_quality)||pr.data_quality,0);
    var support=n(p&&p.market_support_strength,0);
    var agreement=n(p&&p.market_effective_agreement,50);
    var uncertainty=n(pr.uncertainty,0);
    var selection=p?String(p.selection||"")+pt(p.point):"No expression";
    var expr=selection+" "+(p?am(p.price):"")+" â€¢ "+((p&&p.book)||"Market");
    var score=(sc.away!=null&&sc.home!=null)
      ? '<div class="v83-score"><div><small>AWAY PROJECTION</small><strong>'+esc(e.away_team||"Away")+'</strong></div><b>'+esc(sc.away)+" â€” "+esc(sc.home)+'</b><div><small>HOME PROJECTION</small><strong>'+esc(e.home_team||"Home")+'</strong></div></div>'
      : "";
    return '<div class="v83-expression"><small>BEST CURRENT EXPRESSION</small><strong>'+esc(expr)+'</strong><span>'+esc(bestReason(p))+'</span></div>'+
      score+
      '<div class="v83-metrics">'+
        metric("Fair",p?pct(p.fair_probability):"--")+
        metric("Market",p?pct(p.market_probability):"--")+
        metric("Edge",p?pct(p.adjusted_edge):"--")+
      '</div>'+
      '<div class="v83-dna">'+
        gauge("Quality",quality,false)+
        gauge("Support",support,false)+
        gauge("Agreement",agreement,false)+
        gauge("Uncertainty",uncertainty,true)+
      '</div>'+
      pathHtml(p,a);
  }
  function marketBody(a,p){
    if(!p)return listItem("Market","No synced expression.");
    var movement=(p.open_price==null||p.price==null)
      ?"No verified opening comparison yet."
      :am(p.open_price)+" â†’ "+am(p.price);
    return '<div class="v83-metrics">'+
      metric("Current",am(p.price))+
      metric("Play-To",am(p.play_to))+
      metric("Pass",am(p.pass_at))+
      '</div><div class="v83-list">'+
      listItem("Price movement",movement)+
      listItem("Downgrade threshold",am(p.downgrade_at))+
      listItem("Consensus books",String(p.market_consensus_books==null?"--":p.market_consensus_books))+
      listItem("Market dispersion",p.market_dispersion==null?"--":pct(p.market_dispersion))+
      listItem("Target book",p.hard_rock?"Hard Rock verified":"Target book not verified")+
      '</div>';
  }
  function riskBody(a,p){
    var losses=(p&&Array.isArray(p.how_it_loses))?p.how_it_loses:[];
    var flags=(p&&Array.isArray(p.sanity_flags))?p.sanity_flags:[];
    var rows=[];
    rows.push(listItem("Primary blocker",bestReason(p)));
    losses.slice(0,4).forEach(function(x,i){rows.push(listItem("Risk "+(i+1),x))});
    flags.slice(0,4).forEach(function(x,i){rows.push(listItem("Firewall "+(i+1),x))});
    if(rows.join("")==="")rows.push(listItem("Risk map","No additional risk notes were supplied."));
    return '<div class="v83-list">'+rows.join("")+'</div>';
  }
  function dataBody(a,p){
    var pr=(a&&a.projection)||{};
    var src=Array.isArray(pr.sources)?pr.sources:[];
    var notes=Array.isArray(pr.notes)?pr.notes:[];
    var rows=[
      listItem("Data quality",Math.round(n(pr.data_quality,0))+"/100"),
      listItem("Coverage",Math.round(n(p&&p.market_coverage,0))+"/100"),
      listItem("Support",Math.round(n(p&&p.market_support_strength,0))+"/100"),
      listItem("Agreement",Math.round(n(p&&p.market_effective_agreement,0))+"/100"),
      listItem("Uncertainty",Math.round(n(pr.uncertainty,0))+"/100"),
      listItem("Game time",timeText(a&&a.event&&a.event.commence_time))
    ];
    src.slice(0,4).forEach(function(s,i){rows.push(listItem("Source "+(i+1),(s&&s.name)||"Verified source"))});
    notes.slice(0,3).forEach(function(x,i){rows.push(listItem("Model note "+(i+1),x))});
    return '<div class="v83-list">'+rows.join("")+'</div>';
  }
  function bodyFor(tab,a,p){
    if(tab==="market")return marketBody(a,p);
    if(tab==="risk")return riskBody(a,p);
    if(tab==="data")return dataBody(a,p);
    return thesisBody(a,p);
  }
  function renderIntel(){
    var lab=q("#lab");
    if(!lab)return;
    var a=analysis();
    var existing=q("#v83Intel");
    if(!a){
      if(existing)existing.remove();
      return;
    }
    var e=a.event||{}, p=candidate(a), v=verdict(p);
    var key=(e.id||"")+"|"+tierOf(p)+"|"+(p&&p.selection||"")+"|"+(p&&p.price||"")+"|"+activeTab;
    if(existing&&key===lastKey)return;
    lastKey=key;

    if(!existing){
      existing=document.createElement("section");
      existing.id="v83Intel";
      existing.className="v83-intel";
      var labContent=q("#labContent");
      if(labContent)lab.insertBefore(existing,labContent);
      else lab.appendChild(existing);
    }

    existing.innerHTML=
      '<div class="v83-matchup">'+
        '<div class="v83-team away"><div class="v83-teammark">'+esc(initials(e.away_team))+'</div><small>Away</small><strong>'+esc(e.away_team||"Away")+'</strong></div>'+
        '<div class="v83-versus"><span>AEGIS INTEL</span><b>'+esc(timeText(e.commence_time))+'</b></div>'+
        '<div class="v83-team home"><div class="v83-teammark">'+esc(initials(e.home_team))+'</div><small>Home</small><strong>'+esc(e.home_team||"Home")+'</strong></div>'+
      '</div>'+
      '<div class="v83-verdict '+v[2]+'"><small>AEGIS VERDICT</small><strong>'+esc(v[0])+'</strong><span>'+esc(v[1])+'</span></div>'+
      '<div class="v83-tabs">'+
        '<button class="v83-tab '+(activeTab==="thesis"?"active":"")+'" data-v83tab="thesis">THESIS</button>'+
        '<button class="v83-tab '+(activeTab==="market"?"active":"")+'" data-v83tab="market">MARKET</button>'+
        '<button class="v83-tab '+(activeTab==="risk"?"active":"")+'" data-v83tab="risk">RISK</button>'+
        '<button class="v83-tab '+(activeTab==="data"?"active":"")+'" data-v83tab="data">DATA</button>'+
      '</div>'+
      '<div class="v83-tabbody">'+bodyFor(activeTab,a,p)+'</div>';

    qa("[data-v83tab]",existing).forEach(function(b){
      b.onclick=function(){
        activeTab=b.dataset.v83tab;
        lastKey="";
        renderIntel();
      };
    });
  }
  function cardVoice(){
    var quick=q("#v82QuickOrders");
    if(!quick)return;
    var a=analysisForBestCard();
    var p=a&&a.p;
    var tier=tierOf(p);
    var cls=tier.toLowerCase();
    if(cls==="pass")cls="pass";
    var voice=q("#v83CardVoice");
    if(!voice){
      voice=document.createElement("div");
      voice.id="v83CardVoice";
      quick.appendChild(voice);
    }
    var head="AEGIS IS WAITING";
    var sub="No edge is entitled to a bet.";
    if(tier==="CORE"){head="EDGE SURVIVED";sub="Core distinction held through every release gate."}
    else if(tier==="SECONDARY"){head="QUALIFIED â€” REDUCED EXPOSURE";sub="Playable, but not strong enough for Core sizing."}
    else if(tier==="WATCH"){head="HOLD THE LINE";sub="Do not turn a Watch candidate into a bet early."}
    voice.className="v83-cardvoice "+cls;
    voice.innerHTML="<strong>"+esc(head)+"</strong><span>"+esc(sub)+"</span>";
  }
  function analysisForBestCard(){
    var c=card();
    if(!c)return null;
    var rows=(c.plays||[]);
    var p=rows.find(function(x){return x.tier==="CORE"})||
          rows.find(function(x){return x.tier==="SECONDARY"})||
          rows.find(function(x){return x.tier==="WATCH"})||null;
    if(!p)return null;
    var a=(c.analyses||[]).find(function(x){return x.event&&x.event.id===p.event_id})||null;
    return {a:a,p:p};
  }
  function setSportTheme(){
    document.documentElement.setAttribute("data-v83-sport",sportKey());
  }
  function refresh(){
    setSportTheme();
    renderIntel();
    cardVoice();
  }
  function start(){
    document.documentElement.classList.add("aegis-v83");
    refresh();
    setInterval(refresh,1600);
    var labSelect=q("#labGame");
    if(labSelect)labSelect.addEventListener("change",function(){lastKey="";setTimeout(renderIntel,40)});
    var sport=q("#sport");
    if(sport)sport.addEventListener("change",function(){setSportTheme();lastKey="";});
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);
  else start();
})();
"""

CSS.write_text(css)
JS.write_text(js)

html = INDEX.read_text()

css_tag = '<link rel="stylesheet" href="/visual-v8_3.css?v=8.3.0">'
if css_tag not in html:
    anchor = '<link rel="stylesheet" href="/visual-v8_2.css?v=8.2.1">'
    if anchor not in html:
        raise SystemExit("v8.2 stylesheet tag was not found.")
    html = html.replace(anchor, anchor + "\n" + css_tag, 1)

js_tag = '<script src="/app-v8_3.js?v=8.3.0" defer></script>'
if js_tag not in html:
    anchor = '<script src="/app-v8_2.js?v=8.2.1" defer></script>'
    if anchor not in html:
        raise SystemExit("v8.2 app tag was not found.")
    html = html.replace(anchor, anchor + "\n" + js_tag, 1)

html = html.replace(
    "v8.2 â€¢ IDENTITY & MOBILE COMMAND UI",
    "v8.3 â€¢ GAME INTELLIGENCE & PERSONALITY"
)

INDEX.write_text(html)

print("AEGIS v8.3 Game Intelligence layer prepared.")
