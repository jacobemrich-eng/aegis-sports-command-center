
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
