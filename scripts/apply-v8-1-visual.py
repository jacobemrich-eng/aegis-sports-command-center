from pathlib import Path
import re

INDEX = Path("public/index.html")
JS = Path("public/app-v8_6.js")
CSS = Path("public/visual-v8_6.css")

JS.write_text(r"""(function(){
  "use strict";

  function q(s,r){ return (r||document).querySelector(s); }
  function esc(v){
    return String(v==null?"":v).replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function num(v,d){
    var x=Number(v);
    return Number.isFinite(x)?x:(d==null?0:d);
  }
  function pct(v){
    var x=Number(v);
    return Number.isFinite(x)?(x*100).toFixed(1)+"%":"â€”";
  }
  function am(v){
    var x=Number(v);
    if(!Number.isFinite(x))return "â€”";
    return (x>0?"+":"")+Math.round(x);
  }
  function card(){
    return window.LAST&&typeof window.LAST==="object"?window.LAST:null;
  }
  function best(c){
    var p=(c&&c.plays)||[];
    return p.find(function(x){return x.tier==="CORE";}) ||
           p.find(function(x){return x.tier==="SECONDARY";}) ||
           p.find(function(x){return x.tier==="WATCH";}) || null;
  }
  function hoursUntil(iso){
    var t=new Date(iso||"").getTime();
    return Number.isFinite(t)?(t-Date.now())/36e5:999;
  }
  function baseMarket(m){
    var s=String(m||"");
    if(s.indexOf("totals")===0)return "totals";
    if(s.indexOf("spreads")===0)return "spreads";
    return "h2h";
  }
  function isPeriod(p){
    return Number(p&&p.market_period_innings)>0;
  }
  function pass(cls){ return cls?"pass":"open"; }
  function gate(label,current,secondary,core,secondaryOk,coreOk,priority,detail){
    return {
      label:label,current:current,secondary:secondary,core:core,
      secondaryOk:!!secondaryOk,coreOk:!!coreOk,
      priority:priority||50,detail:detail||""
    };
  }

  function buildGates(p){
    var pr=p.projection||{};
    var e=p.event||{};
    var mlb=e.sport_key==="baseball_mlb";
    var dq=num(pr.data_quality,0);
    var cov=num(p.market_coverage,pr.coverage_score);
    var eff=num(p.market_effective_agreement,pr.effective_agreement||pr.model_agreement);
    var raw=num(p.market_model_agreement,pr.model_agreement);
    var edges=num(p.market_edge_count,pr.independent_edge_count);
    var support=num(p.market_support_strength,0);
    var edge=num(p.adjusted_edge,0);
    var cushion=Math.max(0.0001,num(p.cushion,0));
    var ev=num(p.estimated_ev,-99);
    var divergence=num(p.independent_disagreement,0);
    var freshness=String(p.data_quality_grade||"â€”").toUpperCase();
    var hardRock=!!p.hard_rock;
    var inside=!!p.market_inside_fair_range;
    var supportSecondary=mlb?60:42;
    var supportCore=mlb?70:55;
    var hrs=hoursUntil(e.commence_time);
    var lineups=!!pr.lineups_confirmed;
    var probable=!!pr.probable_starters_confirmed;
    var bullpen=!!pr.bullpen_verified;
    var total=baseMarket(p.market)==="totals";
    var period=isPeriod(p);
    var price=num(p.price,NaN);
    var playTo=num(p.play_to,NaN);
    var downgrade=num(p.downgrade_at,NaN);

    var gates=[
      gate("Data quality",Math.round(dq)+"/100","â‰¥66","â‰¥80",dq>=66,dq>=80,8),
      gate("Market coverage",Math.round(cov)+"/100","â‰¥60","â‰¥76",cov>=60,cov>=76,9),
      gate("Effective agreement",Math.round(eff)+"/100","â‰¥59","â‰¥69",eff>=59,eff>=69,12),
      gate("Raw agreement",Math.round(raw)+"/100","â‰¥56","â‰¥64",raw>=56,raw>=64,18),
      gate("Independent edges",Math.round(edges),"â‰¥2","â‰¥2",edges>=2,edges>=2,4),
      gate("Support strength",Math.round(support)+"/100","â‰¥"+supportSecondary,"â‰¥"+supportCore,support>=supportSecondary,support>=supportCore,2,
        mlb?"MLB release support thresholds":"Market-specific support threshold"),
      gate("Adjusted edge",pct(edge),"â‰¥ "+pct(cushion*.72),"â‰¥ "+pct(cushion),edge>=cushion*.72,edge>=cushion,3),
      gate("Estimated EV",pct(ev),"â‰¥0.5%","â‰¥2.0%",ev>=.005,ev>=.02,7),
      gate("Freshness grade",freshness,"A/B","A/B",freshness!=="C",freshness!=="C",1,
        freshness==="C"?"C-level information quality blocks release":"Source freshness gate"),
      gate("Target book",hardRock?"Hard Rock âœ“":(p.book||"Not verified"),"Hard Rock","Hard Rock",hardRock,hardRock,1,
        hardRock?"Target-book quote verified":"Hard Rock Florida price must be verified before release"),
      gate("Market disagreement",(divergence*100).toFixed(1)+" pts","<12 pts","<8 pts",divergence<.12,divergence<.08,5,
        divergence>=.12?"Extreme disagreement caps the candidate at WATCH":divergence>=.08?"Core is blocked unless disagreement improves":"Market/model gap is inside the preferred range"),
      gate("Uncertainty band",inside?"Market inside fair range":"Separated",
        "Outside, or edge â‰¥1.25Ã— cushion","Outside fair range",
        !inside || edge>=cushion*1.25,!inside,6,
        inside?"Market challenger still overlaps the calibrated fair-probability range":"Market is outside the calibrated fair range")
    ];

    if(Number.isFinite(price)&&Number.isFinite(downgrade)&&Number.isFinite(playTo)){
      gates.push(gate("Execution price",am(price),"â‰¥ "+am(downgrade),"â‰¥ "+am(playTo),
        price>=downgrade,price>=playTo,10,
        "Current price vs executable downgrade/play-to bands"));
    }

    if(mlb&&total){
      gates.push(gate("Probable starters",probable?"Confirmed":"Pending","Confirmed","Confirmed",
        probable,probable,0,
        probable?"Starting-pitcher identity verified":"MLB totals are CUT until both probable starters are verified"));
    }

    if(mlb&&hrs<=4){
      gates.push(gate("Starting lineups",lineups?"Confirmed":"Pending","Confirmed","Confirmed",
        lineups,lineups,0,
        lineups?"Batting orders confirmed":"Inside four hours, unconfirmed lineups block Core/Secondary"));
    }else if(mlb){
      gates.push(gate("Starting lineups",lineups?"Confirmed":"Not due yet","Recheck â‰¤4h","Recheck â‰¤4h",
        true,true,30,
        lineups?"Batting orders already confirmed":"AEGIS will require confirmation inside four hours"));
    }

    if(mlb&&!period){
      gates.push(gate("Bullpen verification",bullpen?"Verified":"Incomplete","Preferred","Required for Core",
        true,bullpen,11,
        bullpen?"Recent reliever workload verified":"Incomplete bullpen workload caps an otherwise-Core full-game play at Secondary"));
    }

    return gates;
  }

  function summary(p,gates){
    var tier=String(p.tier||"WATCH").toUpperCase();
    var sOpen=gates.filter(function(g){return !g.secondaryOk;});
    var cOpen=gates.filter(function(g){return !g.coreOk;});
    var head,sub,cls=tier.toLowerCase();

    if(tier==="CORE"){
      head="CORE READY";
      sub="Every current Core release gate is cleared. Stay inside the execution band.";
    }else if(tier==="SECONDARY"){
      head="SECONDARY READY â€¢ "+cOpen.length+" CORE GATE"+(cOpen.length===1?"":"S")+" OPEN";
      sub="Playable at reduced exposure. Core requires the remaining distinction gates to clear.";
    }else{
      head="WATCH â€¢ "+sOpen.length+" RELEASE GATE"+(sOpen.length===1?"":"S")+" OPEN";
      sub="AEGIS can promote this automatically when the evidence changes. Do not override WATCH manually.";
      cls="watch";
    }
    return {tier:tier,head:head,sub:sub,cls:cls,sOpen:sOpen,cOpen:cOpen};
  }

  function meter(label,ok,total,cls){
    var pctv=total?Math.round(ok/total*100):100;
    return '<div class="v86-meter '+cls+'">'+
      '<div><span>'+esc(label)+'</span><b>'+ok+'/'+total+' gates</b></div>'+
      '<div class="v86-bar"><i style="width:'+pctv+'%"></i></div>'+
      '</div>';
  }

  function row(g){
    var both=g.secondaryOk&&g.coreOk;
    var status=both?"pass":(!g.secondaryOk?"open":"partial");
    var icon=both?"âœ“":(!g.secondaryOk?"!":"â€¢");
    return '<div class="v86-gate '+status+'">'+
      '<div class="v86-gateicon">'+icon+'</div>'+
      '<div class="v86-gatemain"><strong>'+esc(g.label)+'</strong><span>'+esc(g.detail)+'</span></div>'+
      '<div class="v86-current">'+esc(g.current)+'</div>'+
      '<div class="v86-target"><small>SECONDARY</small><b>'+esc(g.secondary)+'</b><small>CORE</small><b>'+esc(g.core)+'</b></div>'+
      '</div>';
  }

  function render(){
    var c=card(),p=best(c),page=q("#card");
    if(!page)return;
    var old=q("#v86Readiness");
    if(!p){
      if(old)old.remove();
      return;
    }

    var gates=buildGates(p);
    var sum=summary(p,gates);
    var key=[
      c.generated_at||"",p.event_id||"",
      p.tier||"",p.price||"",p.market_support_strength||"",
      p.data_quality_grade||"",p.market_coverage||"",
      p.market_effective_agreement||"",p.hard_rock?"1":"0"
    ].join("|");

    if(old&&old.dataset.key===key)return;

    var sPass=gates.filter(function(g){return g.secondaryOk;}).length;
    var cPass=gates.filter(function(g){return g.coreOk;}).length;
    var blockers=(sum.tier==="CORE"?[]:sum.tier==="SECONDARY"?sum.cOpen:sum.sOpen)
      .slice()
      .sort(function(a,b){return a.priority-b.priority;})
      .slice(0,6);

    var panel=old||document.createElement("section");
    panel.id="v86Readiness";
    panel.className="v86-readiness "+sum.cls;
    panel.dataset.key=key;

    panel.innerHTML=
      '<div class="v86-head">'+
        '<div><span class="v86-kicker">RELEASE READINESS</span><h2>'+esc(sum.head)+'</h2><p>'+esc(sum.sub)+'</p></div>'+
        '<span class="v86-tier">'+esc(sum.tier)+'</span>'+
      '</div>'+
      '<div class="v86-meters">'+
        meter("Secondary readiness",sPass,gates.length,"secondary")+
        meter("Core readiness",cPass,gates.length,"core")+
      '</div>'+
      (blockers.length
        ? '<div class="v86-blocktitle"><span>BIGGEST OPEN GATES</span><b>'+blockers.length+' shown</b></div>'+
          '<div class="v86-gates">'+blockers.map(row).join("")+'</div>'
        : '<div class="v86-cleared"><b>âœ“ CURRENT CORE GATES CLEARED</b><span>Execution still depends on the listed Play-To / Downgrade / Pass numbers.</span></div>')+
      '<div class="v86-next"><div><small>NEXT ACTION</small><b>Scheduled automatic verification</b></div>'+
        '<span>AEGIS will refresh evidence and promote/demote automatically.</span></div>';

    if(!old){
      var voice=q("#v83CardVoice");
      var quick=q("#v82QuickOrders");
      var cardContent=q("#cardContent");
      if(voice&&voice.parentElement===page){
        voice.insertAdjacentElement("afterend",panel);
      }else if(quick&&quick.parentElement===page){
        quick.insertAdjacentElement("afterend",panel);
      }else if(cardContent){
        page.insertBefore(panel,cardContent);
      }else{
        page.appendChild(panel);
      }
    }
  }

  function wrapRenderCard(){
    var original=window.renderCard;
    if(typeof original!=="function"||original.__v86Wrapped)return;
    function wrapped(){
      var out=original.apply(this,arguments);
      queueMicrotask(render);
      return out;
    }
    wrapped.__v86Wrapped=true;
    wrapped.__v86Original=original;
    window.renderCard=wrapped;
  }

  function start(){
    document.documentElement.classList.add("aegis-v86");
    wrapRenderCard();
    render();

    var cardNav=q('.v82-navbtn[data-tab="card"]');
    if(cardNav)cardNav.addEventListener("click",function(){queueMicrotask(render);});

    var originalCardNav=q('.navbtn[data-tab="card"]');
    if(originalCardNav)originalCardNav.addEventListener("click",function(){queueMicrotask(render);});
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",start,{once:true});
  }else{
    start();
  }
})();""")
CSS.write_text(r"""/* =========================================================
   SB101 AEGIS v8.6 â€” RELEASE READINESS
   Tiny event-driven companion UI. No intervals or MutationObservers.
   ========================================================= */

:root{
  --v86-core:#67f5bf;
  --v86-secondary:#ffd66e;
  --v86-watch:#79c8ff;
  --v86-open:#ff8794;
  --v86-panel:#061b29;
  --v86-deep:#03131d;
  --v86-line:rgba(104,184,216,.24);
}

.aegis-v86 .v86-readiness{
  margin:16px 0;
  padding:18px;
  border:1px solid var(--v86-line);
  border-radius:22px;
  background:
    radial-gradient(circle at 100% 0,rgba(121,200,255,.07),transparent 31%),
    linear-gradient(180deg,rgba(6,29,42,.99),rgba(2,16,24,.99));
  box-shadow:0 18px 46px rgba(0,0,0,.22);
  overflow:hidden;
}

.aegis-v86 .v86-readiness.core{
  border-color:rgba(103,245,191,.34);
  background:
    radial-gradient(circle at 100% 0,rgba(103,245,191,.085),transparent 32%),
    linear-gradient(180deg,rgba(6,31,39,.99),rgba(2,17,23,.99));
}
.aegis-v86 .v86-readiness.secondary{border-color:rgba(255,214,110,.30)}
.aegis-v86 .v86-readiness.watch{border-color:rgba(121,200,255,.30)}

.aegis-v86 .v86-head{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:14px;
}
.aegis-v86 .v86-kicker{
  display:block;
  margin-bottom:6px;
  color:var(--v86-core);
  font-size:9px;
  font-weight:950;
  letter-spacing:.19em;
}
.aegis-v86 .v86-head h2{
  margin:0;
  font-size:25px;
  line-height:1.08;
  letter-spacing:-.025em;
}
.aegis-v86 .v86-head p{
  margin:8px 0 0;
  max-width:570px;
  color:#9fb4c0;
  font-size:12px;
  line-height:1.48;
}
.aegis-v86 .v86-tier{
  flex:none;
  padding:7px 9px;
  border:1px solid rgba(121,200,255,.32);
  border-radius:999px;
  color:#a8d9ff;
  background:rgba(15,43,62,.7);
  font-size:9px;
  font-weight:950;
  letter-spacing:.12em;
}
.aegis-v86 .core .v86-tier{color:#9affd9;border-color:rgba(103,245,191,.36);background:rgba(6,54,39,.55)}
.aegis-v86 .secondary .v86-tier{color:#ffe394;border-color:rgba(255,214,110,.35);background:rgba(56,42,9,.52)}

.aegis-v86 .v86-meters{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  margin-top:16px;
}
.aegis-v86 .v86-meter{
  padding:12px;
  border:1px solid rgba(95,169,199,.21);
  border-radius:15px;
  background:rgba(2,15,23,.72);
}
.aegis-v86 .v86-meter>div:first-child{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  margin-bottom:8px;
}
.aegis-v86 .v86-meter span{
  color:#9eb3bf;
  font-size:9px;
  font-weight:900;
  letter-spacing:.09em;
  text-transform:uppercase;
}
.aegis-v86 .v86-meter b{font-size:11px}
.aegis-v86 .v86-bar{
  height:7px;
  overflow:hidden;
  border-radius:999px;
  background:#102e40;
}
.aegis-v86 .v86-bar i{
  display:block;
  height:100%;
  border-radius:inherit;
  background:linear-gradient(90deg,#52dfff,var(--v86-core));
}
.aegis-v86 .v86-meter.secondary .v86-bar i{
  background:linear-gradient(90deg,#d8aa3c,var(--v86-secondary));
}

.aegis-v86 .v86-blocktitle{
  display:flex;
  justify-content:space-between;
  gap:12px;
  margin:17px 2px 8px;
  color:#91a9b6;
  font-size:8px;
  font-weight:950;
  letter-spacing:.15em;
}
.aegis-v86 .v86-blocktitle b{color:#708995}

.aegis-v86 .v86-gates{
  display:grid;
  gap:8px;
}
.aegis-v86 .v86-gate{
  display:grid;
  grid-template-columns:27px minmax(0,1fr) 76px 112px;
  align-items:center;
  gap:10px;
  min-height:58px;
  padding:10px;
  border:1px solid rgba(94,167,197,.18);
  border-radius:14px;
  background:rgba(2,15,23,.78);
}
.aegis-v86 .v86-gate.open{
  border-color:rgba(255,135,148,.29);
  background:linear-gradient(90deg,rgba(61,20,29,.34),rgba(2,15,23,.82) 45%);
}
.aegis-v86 .v86-gate.partial{
  border-color:rgba(255,214,110,.25);
  background:linear-gradient(90deg,rgba(57,43,9,.28),rgba(2,15,23,.82) 45%);
}
.aegis-v86 .v86-gateicon{
  width:25px;height:25px;
  display:grid;place-items:center;
  border:1px solid rgba(255,135,148,.34);
  border-radius:50%;
  color:#ffadb6;
  font-size:11px;
  font-weight:950;
}
.aegis-v86 .v86-gate.partial .v86-gateicon{
  color:#ffe394;border-color:rgba(255,214,110,.34);
}
.aegis-v86 .v86-gate.pass .v86-gateicon{
  color:#9affd9;border-color:rgba(103,245,191,.34);
}
.aegis-v86 .v86-gatemain strong{
  display:block;
  font-size:12px;
}
.aegis-v86 .v86-gatemain span{
  display:block;
  margin-top:3px;
  color:#7893a1;
  font-size:9px;
  line-height:1.35;
}
.aegis-v86 .v86-current{
  text-align:right;
  color:#eef8fb;
  font-size:13px;
  font-weight:900;
  font-variant-numeric:tabular-nums;
}
.aegis-v86 .v86-target{
  display:grid;
  grid-template-columns:auto 1fr;
  column-gap:5px;
  row-gap:2px;
  padding-left:9px;
  border-left:1px solid rgba(94,167,197,.17);
}
.aegis-v86 .v86-target small{
  color:#6f8997;
  font-size:6px;
  font-weight:950;
  letter-spacing:.08em;
}
.aegis-v86 .v86-target b{
  text-align:right;
  font-size:9px;
  font-variant-numeric:tabular-nums;
}

.aegis-v86 .v86-next,
.aegis-v86 .v86-cleared{
  margin-top:13px;
  padding:11px 12px;
  border:1px solid rgba(103,245,191,.24);
  border-radius:14px;
  background:rgba(4,48,36,.38);
}
.aegis-v86 .v86-next{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}
.aegis-v86 .v86-next small{
  display:block;
  color:#78dcb8;
  font-size:7px;
  font-weight:950;
  letter-spacing:.14em;
}
.aegis-v86 .v86-next b{font-size:10px}
.aegis-v86 .v86-next span,
.aegis-v86 .v86-cleared span{
  color:#8ea8b4;
  font-size:9px;
  line-height:1.4;
}
.aegis-v86 .v86-cleared b{
  display:block;
  color:#93f4ce;
  font-size:10px;
  letter-spacing:.08em;
  margin-bottom:4px;
}

@media(max-width:760px){
  .aegis-v86 .v86-readiness{
    margin:13px 0;
    padding:14px;
    border-radius:19px;
  }
  .aegis-v86 .v86-head h2{font-size:20px}
  .aegis-v86 .v86-head p{font-size:10px}
  .aegis-v86 .v86-tier{padding:6px 8px;font-size:7px}
  .aegis-v86 .v86-meters{grid-template-columns:1fr}
  .aegis-v86 .v86-gate{
    grid-template-columns:25px minmax(0,1fr) 66px;
    gap:8px;
    min-height:55px;
  }
  .aegis-v86 .v86-target{
    grid-column:2/4;
    margin-left:0;
    padding:7px 0 0;
    border-left:0;
    border-top:1px solid rgba(94,167,197,.15);
    grid-template-columns:auto 1fr auto 1fr;
  }
  .aegis-v86 .v86-target b{text-align:left}
  .aegis-v86 .v86-current{font-size:12px}
  .aegis-v86 .v86-next{
    align-items:flex-start;
    flex-direction:column;
  }
}

@media(prefers-reduced-motion:reduce){
  .aegis-v86 *{transition:none!important;animation:none!important}
}
""")

html = INDEX.read_text()

# Safety: never activate over the known-bad experimental v8.4 runtime.
if "app-v8_4" in html:
    raise SystemExit("Unsafe app-v8_4 runtime detected. Refusing v8.6 activation.")

css_marker = '<link rel="stylesheet" href="/visual-v8_5.css?v=8.5.0">'
css_link = '<link rel="stylesheet" href="/visual-v8_6.css?v=8.6.0">'
js_marker = '<script src="/app-v8_3_2.js?v=8.3.2" defer></script>'
js_link = '<script src="/app-v8_6.js?v=8.6.0" defer></script>'

if css_link not in html:
    if css_marker not in html:
        raise SystemExit("Stable v8.5 checkpoint missing. Refusing v8.6 activation.")
    html = html.replace(css_marker, css_marker + "\n" + css_link)

if js_link not in html:
    if js_marker not in html:
        raise SystemExit("Stable v8.3.2 runtime marker missing. Refusing v8.6 activation.")
    html = html.replace(js_marker, js_marker + "\n" + js_link)

html = re.sub(
    r'<span class="versionpill">.*?</span>',
    '<span class="versionpill">v8.6 â€¢ RELEASE READINESS</span>',
    html,
    count=1,
    flags=re.S,
)

INDEX.write_text(html)

print("AEGIS v8.6 Release Readiness installed.")
