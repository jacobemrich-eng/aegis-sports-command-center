
from pathlib import Path

INDEX = Path("public/index.html")
CSS = Path("public/visual-v8_2.css")
JS = Path("public/app-v8_2.js")

css = r"""
/* SB101 AEGIS v8.2.1 - Identity & Mobile Command UI */
:root{
  --v82-bg:#02080d;
  --v82-panel:#061722;
  --v82-panel2:#081d2a;
  --v82-line:#173a4d;
  --v82-mint:#67f5bf;
  --v82-cyan:#52dfff;
  --v82-gold:#ffd66e;
  --v82-blue:#76bfff;
  --v82-red:#ff7382;
  --v82-muted:#8ca5b5;
}

.v82-topbar,
.v82-bottomnav,
.v82-overview,
.v82-quickorders{
  display:none;
}

.v82-topbar{
  align-items:center;
  justify-content:space-between;
  gap:12px;
}

.v82-brand{
  display:flex;
  align-items:center;
  gap:9px;
}

.v82-shield{
  position:relative;
  width:42px;
  height:48px;
  display:grid;
  place-items:center;
  clip-path:polygon(50% 0,90% 14%,84% 68%,50% 100%,16% 68%,10% 14%);
  background:linear-gradient(145deg,#70f7c5,#164b3f 48%,#06211e);
  filter:drop-shadow(0 0 14px rgba(103,245,191,.18));
}

.v82-shield:before{
  content:"";
  position:absolute;
  inset:3px;
  clip-path:inherit;
  background:#06151d;
}

.v82-shield span{
  position:relative;
  z-index:1;
  font-family:Georgia,serif;
  font-size:25px;
  font-style:italic;
  font-weight:900;
  color:#eefdf7;
}

.v82-brandmicro{
  font-size:8px;
  letter-spacing:.18em;
  color:var(--v82-mint);
  font-weight:950;
}

.v82-brandname{
  font-family:Georgia,serif;
  font-size:19px;
  letter-spacing:.08em;
  font-weight:900;
}

.v82-topmeta{
  display:flex;
  align-items:center;
  gap:7px;
  color:#b9cbd5;
  font-size:11px;
  font-weight:900;
}

.v82-online-dot{
  width:7px;
  height:7px;
  border-radius:50%;
  background:var(--v82-mint);
  box-shadow:0 0 13px var(--v82-mint);
}

.v82-overview,
.v82-quickorders{
  border:1px solid rgba(103,245,191,.20);
  border-radius:22px;
  background:
    radial-gradient(circle at 88% 0,rgba(103,245,191,.07),transparent 26%),
    linear-gradient(180deg,rgba(6,28,39,.98),rgba(3,15,23,.99));
  box-shadow:0 18px 45px rgba(0,0,0,.24);
  padding:18px;
  margin:14px 0;
}

.v82-panelhead,
.v82-qhead{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:12px;
}

.v82-kicker{
  display:block;
  font-size:10px;
  font-weight:950;
  letter-spacing:.15em;
  color:var(--v82-mint);
  margin-bottom:5px;
}

.v82-panelhead h2,
.v82-qhead h2{
  font-size:24px;
  line-height:1.05;
  margin:0;
  letter-spacing:-.03em;
}

.v82-linkbtn{
  border:0;
  background:transparent;
  color:#80cfff;
  font-size:11px;
  font-weight:900;
  padding:5px;
}

.v82-statrow{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:7px;
  margin:14px 0;
}

.v82-stat{
  border:1px solid var(--v82-line);
  border-radius:12px;
  background:#03121b;
  padding:9px 7px;
  min-width:0;
}

.v82-stat span{
  display:block;
  font-size:7px;
  letter-spacing:.07em;
  font-weight:950;
  color:#9fb1bd;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.v82-stat b{
  display:block;
  font-size:23px;
  margin-top:4px;
}

.v82-stat.fire b{color:var(--v82-mint)}
.v82-stat.secondary b{color:var(--v82-gold)}
.v82-stat.watch b{color:var(--v82-blue)}
.v82-stat.cut b{color:var(--v82-red)}

.v82-focus{
  border:1px solid rgba(118,191,255,.24);
  border-radius:14px;
  background:rgba(5,25,38,.72);
  padding:11px;
  margin:9px 0;
}

.v82-focus small{
  display:block;
  color:#a9d8ff;
  font-size:9px;
  font-weight:950;
  margin-bottom:4px;
}

.v82-focus b{
  display:block;
  font-size:13px;
}

.v82-focus em{
  display:block;
  font-style:normal;
  color:#b9cbd5;
  font-size:11px;
  margin-top:3px;
}

.v82-actionstate{
  display:flex;
  flex-direction:column;
  gap:3px;
  border:1px solid rgba(103,245,191,.24);
  background:rgba(5,32,27,.48);
  border-radius:14px;
  padding:12px 13px;
  margin-top:10px;
}

.v82-actionstate.ready{
  border-color:rgba(103,245,191,.40);
  background:rgba(5,43,31,.62);
}

.v82-actionstate strong{
  text-transform:uppercase;
  color:#8dffd8;
  font-size:11px;
  letter-spacing:.04em;
}

.v82-actionstate span{
  color:#9cb1bd;
  font-size:10px;
  line-height:1.4;
}

.v82-order{
  border:1px solid #1c4a63;
  border-radius:17px;
  background:linear-gradient(180deg,#061c2a,#04131d);
  padding:14px;
}

.v82-order.core{border-color:rgba(103,245,191,.42)}
.v82-order.secondary{border-color:rgba(255,214,110,.36)}
.v82-order.watch{border-color:rgba(118,191,255,.38)}

.v82-orderhead{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
}

.v82-tier{
  font-size:9px;
  font-weight:950;
  letter-spacing:.08em;
}

.v82-tier.core{color:var(--v82-mint)}
.v82-tier.secondary{color:var(--v82-gold)}
.v82-tier.watch{color:var(--v82-blue)}

.v82-orderhead time{
  font-size:9px;
  color:#8ea6b5;
}

.v82-order h3{
  font-size:15px;
  margin:9px 0 8px;
}

.v82-orderpick{
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:12px;
}

.v82-orderpick strong{
  font-size:29px;
  line-height:1;
  letter-spacing:-.04em;
}

.v82-orderpick b{
  font-size:24px;
  color:#83c9ff;
}

.v82-orderbook{
  text-align:right;
  font-size:8px;
  letter-spacing:.08em;
  color:#93a8b4;
  text-transform:uppercase;
  margin-top:3px;
}

.v82-nextrefresh{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
  border:1px solid rgba(103,245,191,.22);
  background:rgba(4,35,27,.54);
  border-radius:12px;
  padding:10px 11px;
  margin:10px 0;
}

.v82-nextrefresh span{
  font-size:8px;
  letter-spacing:.08em;
  color:#7df4c0;
  font-weight:950;
}

.v82-nextrefresh b{
  font-size:9px;
  color:#9deecf;
}

.v82-orderactions{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:8px;
  margin-top:10px;
}

.v82-orderactions .btn{
  font-size:10px;
  padding:10px;
}

.v82-bottomnav{
  grid-template-columns:repeat(6,1fr);
}

.v82-navbtn{
  border:0;
  background:transparent;
  color:#728996;
  padding:4px 1px;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:2px;
  font-size:7px;
  font-weight:800;
  min-width:0;
}

.v82-navicon{
  font-size:15px;
  line-height:1;
}

.v82-navbtn.active{
  color:var(--v82-mint);
  text-shadow:0 0 14px rgba(103,245,191,.2);
}

@media(max-width:760px){
  body{
    padding-bottom:78px;
  }

  .wrap{
    padding-top:0;
  }

  .hero,
  .navwrap{
    display:none!important;
  }

  .v82-topbar{
    display:flex!important;
    position:sticky;
    top:0;
    z-index:70;
    padding:9px 12px;
    margin:0 -12px 10px;
    background:linear-gradient(180deg,rgba(2,9,14,.99),rgba(2,9,14,.94));
    border-bottom:1px solid rgba(103,245,191,.13);
    backdrop-filter:blur(18px);
  }

  .v82-bottomnav{
    display:grid!important;
    position:fixed;
    z-index:80;
    left:0;
    right:0;
    bottom:0;
    padding:6px 5px calc(6px + env(safe-area-inset-bottom));
    background:rgba(2,9,14,.98);
    border-top:1px solid rgba(95,170,201,.18);
    backdrop-filter:blur(20px);
    box-shadow:0 -12px 34px rgba(0,0,0,.30);
  }

  .v82-overview,
  .v82-quickorders{
    display:block!important;
  }

  #cardContent .slatehero{
    display:none!important;
  }

  #cardContent .play{
    margin-top:10px;
  }

  .play .pickline{
    font-size:31px;
  }
}

@media(min-width:761px){
  .v82-overview,
  .v82-quickorders{
    display:block;
  }
}
"""

js = r"""
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
"""

CSS.write_text(css)
JS.write_text(js)

html = INDEX.read_text()

# Remove the old inline v8.2 block if it exists.
start = "<!-- ===== AEGIS v8.2 MOBILE COMMAND UI ===== -->"
end = "<!-- ===== /AEGIS v8.2 MOBILE COMMAND UI ===== -->"
if start in html and end in html:
    a = html.index(start)
    b = html.index(end, a) + len(end)
    html = html[:a] + html[b:]

# Force a brand-new CSS URL so Safari cannot reuse v8.1 cache.
new_css = '<link rel="stylesheet" href="/visual-v8_2.css?v=8.2.1">'
if new_css not in html:
    anchor = '<link rel="stylesheet" href="/visual-v8_1.css?v=8.1.0">'
    if anchor not in html:
        raise SystemExit("v8.1 stylesheet link was not found.")
    html = html.replace(anchor, anchor + "\n" + new_css, 1)

new_js = '<script src="/app-v8_2.js?v=8.2.1" defer></script>'
if new_js not in html:
    anchor = '<script src="/app.js?v=8.0.0" defer></script>'
    if anchor not in html:
        raise SystemExit("Base app.js tag was not found.")
    html = html.replace(anchor, anchor + "\n" + new_js, 1)

html = html.replace(
    "v8.0 â€¢ AUTOPILOT & DAILY OPERATIONS",
    "v8.2 â€¢ IDENTITY & MOBILE COMMAND UI"
)

INDEX.write_text(html)

print("AEGIS v8.2.1 external CSS/JS installed with cache busting.")
