(function(){
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
    return Number.isFinite(x)?(x*100).toFixed(1)+"%":"—";
  }
  function am(v){
    var x=Number(v);
    if(!Number.isFinite(x))return "—";
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
    var freshness=String(p.data_quality_grade||"—").toUpperCase();
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
      gate("Data quality",Math.round(dq)+"/100","≥66","≥80",dq>=66,dq>=80,8),
      gate("Market coverage",Math.round(cov)+"/100","≥60","≥76",cov>=60,cov>=76,9),
      gate("Effective agreement",Math.round(eff)+"/100","≥59","≥69",eff>=59,eff>=69,12),
      gate("Raw agreement",Math.round(raw)+"/100","≥56","≥64",raw>=56,raw>=64,18),
      gate("Independent edges",Math.round(edges),"≥2","≥2",edges>=2,edges>=2,4),
      gate("Support strength",Math.round(support)+"/100","≥"+supportSecondary,"≥"+supportCore,support>=supportSecondary,support>=supportCore,2,
        mlb?"MLB release support thresholds":"Market-specific support threshold"),
      gate("Adjusted edge",pct(edge),"≥ "+pct(cushion*.72),"≥ "+pct(cushion),edge>=cushion*.72,edge>=cushion,3),
      gate("Estimated EV",pct(ev),"≥0.5%","≥2.0%",ev>=.005,ev>=.02,7),
      gate("Freshness grade",freshness,"A/B","A/B",freshness!=="C",freshness!=="C",1,
        freshness==="C"?"C-level information quality blocks release":"Source freshness gate"),
      gate("Target book",hardRock?"Hard Rock ✓":(p.book||"Not verified"),"Hard Rock","Hard Rock",hardRock,hardRock,1,
        hardRock?"Target-book quote verified":"Hard Rock Florida price must be verified before release"),
      gate("Market disagreement",(divergence*100).toFixed(1)+" pts","<12 pts","<8 pts",divergence<.12,divergence<.08,5,
        divergence>=.12?"Extreme disagreement caps the candidate at WATCH":divergence>=.08?"Core is blocked unless disagreement improves":"Market/model gap is inside the preferred range"),
      gate("Uncertainty band",inside?"Market inside fair range":"Separated",
        "Outside, or edge ≥1.25× cushion","Outside fair range",
        !inside || edge>=cushion*1.25,!inside,6,
        inside?"Market challenger still overlaps the calibrated fair-probability range":"Market is outside the calibrated fair range")
    ];

    if(Number.isFinite(price)&&Number.isFinite(downgrade)&&Number.isFinite(playTo)){
      gates.push(gate("Execution price",am(price),"≥ "+am(downgrade),"≥ "+am(playTo),
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
      gates.push(gate("Starting lineups",lineups?"Confirmed":"Not due yet","Recheck ≤4h","Recheck ≤4h",
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
      head="SECONDARY READY • "+cOpen.length+" CORE GATE"+(cOpen.length===1?"":"S")+" OPEN";
      sub="Playable at reduced exposure. Core requires the remaining distinction gates to clear.";
    }else{
      head="WATCH • "+sOpen.length+" RELEASE GATE"+(sOpen.length===1?"":"S")+" OPEN";
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
    var icon=both?"✓":(!g.secondaryOk?"!":"•");
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
        : '<div class="v86-cleared"><b>✓ CURRENT CORE GATES CLEARED</b><span>Execution still depends on the listed Play-To / Downgrade / Pass numbers.</span></div>')+
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
})();