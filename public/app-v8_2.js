
(function(){
  "use strict";

  var tabs = [
    ["command","&#9889;","Command"],
    ["board","&#9673;","Board"],
    ["lab","&#128300;","Game Lab"],
    ["card","&#127919;","Final Card"],
    ["results","&#128202;","Results"],
    ["models","&#129504;","Models"]
  ];

  function q(s,r){return (r||document).querySelector(s)}
  function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
  function esc(v){
    return String(v==null?"":v).replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function price(v){
    var n=Number(v);
    if(!Number.isFinite(n))return "--";
    return n>0 ? "+"+Math.round(n) : String(Math.round(n));
  }
  function point(p){
    if(p==null)return "";
    var n=Number(p);
    return Number.isFinite(n) ? " "+(n>0?"+":"")+n : "";
  }
  function card(){
    return window.LAST && typeof window.LAST==="object" ? window.LAST : null;
  }
  function counts(c){
    var out={CORE:0,SECONDARY:0,WATCH:0,CUT:0};
    if(!c)return out;
    (c.plays||[]).forEach(function(p){
      var t=String(p.tier||"").toUpperCase();
      if(out[t]!=null && t!=="CUT")out[t]++;
      else out.CUT++;
    });
    out.CUT+=(c.passes||[]).length;
    return out;
  }
  function best(c){
    var p=(c&&c.plays)||[];
    return p.find(function(x){return x.tier==="CORE"}) ||
           p.find(function(x){return x.tier==="SECONDARY"}) ||
           p.find(function(x){return x.tier==="WATCH"}) || null;
  }
  function sport(){
    var s=q("#sport");
    return s && s.selectedOptions && s.selectedOptions[0]
      ? s.selectedOptions[0].textContent.trim()
      : "AEGIS";
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
  function currentTab(){
    var a=q(".navbtn.active");
    return a&&a.dataset.tab ? a.dataset.tab : "command";
  }
  function syncNav(){
    var active=currentTab();
    qa(".v82-navbtn").forEach(function(b){
      b.classList.toggle("active",b.dataset.tab===active);
    });
    var label=q("#v82TopSection");
    var found=tabs.find(function(t){return t[0]===active});
    if(label)label.textContent=found?found[2]:"Command";
  }
  function go(tab){
    var original=q('.navbtn[data-tab="'+tab+'"]');
    if(original)original.click();
    syncNav();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function shell(){
    var wrap=q(".wrap");
    if(!wrap)return;

    if(!q("#v82Topbar")){
      var top=document.createElement("div");
      top.id="v82Topbar";
      top.className="v82-topbar";
      top.innerHTML=
        '<div class="v82-brand">'+
          '<div class="v82-shield"><span>A</span></div>'+
          '<div><div class="v82-brandmicro">SB101</div><div class="v82-brandname">AEGIS</div></div>'+
        '</div>'+
        '<div class="v82-topmeta"><span class="v82-online-dot"></span><span id="v82TopSection">Command</span></div>';
      wrap.insertBefore(top,wrap.firstChild);
    }

    if(!q("#v82BottomNav")){
      var nav=document.createElement("nav");
      nav.id="v82BottomNav";
      nav.className="v82-bottomnav";
      nav.innerHTML=tabs.map(function(t){
        return '<button class="v82-navbtn" data-tab="'+t[0]+'">'+
          '<span class="v82-navicon">'+t[1]+'</span>'+
          '<span>'+t[2]+'</span>'+
        '</button>';
      }).join("");
      document.body.appendChild(nav);
      qa(".v82-navbtn",nav).forEach(function(b){
        b.addEventListener("click",function(){go(b.dataset.tab)});
      });
    }

    syncNav();
  }
  function stat(label,value,cls,icon){
    return '<div class="v82-stat '+cls+'"><span>'+icon+" "+label+'</span><b>'+value+'</b></div>';
  }
  function stats(c){
    return '<div class="v82-statrow">'+
      stat("CORE",c.CORE,"fire","&#128293;")+
      stat("SECONDARY",c.SECONDARY,"secondary","&#9733;")+
      stat("WATCH",c.WATCH,"watch","&#128065;")+
      stat("CUT",c.CUT,"cut","&#9986;")+
    '</div>';
  }
  function overview(){
    var page=q("#command");
    if(!page)return;
    var box=q("#v82Overview");
    if(!box){
      box=document.createElement("section");
      box.id="v82Overview";
      box.className="v82-overview";
      page.insertBefore(box,page.firstChild);
    }

    var c=card();
    var x=counts(c);
    var p=best(c);
    var qualified=x.CORE+x.SECONDARY;

    var focus=p
      ? '<div class="v82-focus"><small>'+esc(p.tier||"WATCH")+'</small><b>'+
        esc((p.event&&p.event.away_team)||"")+" @ "+esc((p.event&&p.event.home_team)||"")+
        '</b><em>'+esc(p.selection||"")+point(p.point)+" "+price(p.price)+'</em></div>'
      : "";

    box.innerHTML=
      '<div class="v82-panelhead"><div><span class="v82-kicker">TODAY&#39;S OVERVIEW</span><h2>'+
      esc(sport())+' Command</h2></div><button class="v82-linkbtn" id="v82ViewCard">View Card &gt;</button></div>'+
      stats(x)+focus+
      '<div class="v82-actionstate '+(qualified?"ready":"")+'"><strong>'+
      (qualified ? qualified+" BANKROLL-QUALIFIED PLAY"+(qualified===1?"":"S") : "NO BANKROLL-QUALIFIED BETS YET")+
      '</strong><span>'+
      (qualified ? "Only released Core and Secondary plays qualify." : "AEGIS is waiting for evidence, not forcing action.")+
      '</span></div>';

    var b=q("#v82ViewCard");
    if(b)b.onclick=function(){go("card")};
  }
  function quick(){
    var page=q("#card");
    if(!page)return;
    var box=q("#v82QuickOrders");
    if(!box){
      box=document.createElement("section");
      box.id="v82QuickOrders";
      box.className="v82-quickorders";
      page.insertBefore(box,page.firstChild);
    }

    var c=card();
    var x=counts(c);
    var p=best(c);
    var qualified=x.CORE+x.SECONDARY;
    var order="";

    if(p){
      var tier=String(p.tier||"WATCH").toUpperCase();
      var cls=tier.toLowerCase();
      order=
        '<article class="v82-order '+cls+'">'+
        '<div class="v82-orderhead"><span class="v82-tier '+cls+'">'+esc(tier)+'</span><time>'+
        esc(timeText((p.event&&p.event.commence_time)||p.commence_time))+'</time></div>'+
        '<h3>'+esc((p.event&&p.event.away_team)||"")+" @ "+esc((p.event&&p.event.home_team)||"")+'</h3>'+
        '<div class="v82-orderpick"><strong>'+esc(p.selection||"")+point(p.point)+'</strong><b>'+price(p.price)+'</b></div>'+
        '<div class="v82-orderbook">'+esc(p.book||"Market")+'</div>'+
        '</article>';
    }else{
      order='<div class="v82-focus"><b>No active candidate.</b><em>AEGIS will surface one when a market survives enough gates.</em></div>';
    }

    box.innerHTML=
      '<div class="v82-qhead"><div><span class="v82-kicker">QUICK ORDERS</span><h2>Final Card</h2></div></div>'+
      stats(x)+order+
      '<div class="v82-nextrefresh"><span>NEXT REFRESH</span><b>Scheduled automatically</b></div>'+
      '<div class="v82-orderactions">'+
      '<button id="v82Copy" class="btn secondary">COPY CARD</button>'+
      '<button id="v82Deep" class="btn secondary">FULL DETAILS</button>'+
      '</div>';

    var copy=q("#v82Copy");
    if(copy)copy.onclick=function(){
      var original=q("#copyCard");
      if(original)original.click();
    };
    var deep=q("#v82Deep");
    if(deep)deep.onclick=function(){
      var original=q("#cardContent");
      if(original)original.scrollIntoView({behavior:"smooth"});
    };
  }
  function refresh(){
    shell();
    overview();
    quick();
    syncNav();
  }
  function start(){
    refresh();
    window.setInterval(refresh,2000);
    document.documentElement.classList.add("aegis-v82");
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",start);
  }else{
    start();
  }
})();
