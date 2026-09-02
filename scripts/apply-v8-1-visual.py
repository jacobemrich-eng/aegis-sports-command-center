from pathlib import Path

INDEX = Path("public/index.html")
CSS = Path("public/visual-v8_4.css")
JS = Path("public/app-v8_4.js")

css = r"""
/* =========================================================
   SB101 AEGIS v8.4 â€” TEAM IDENTITY & VISUAL MATCHUPS
   Presentation-only. No engine/release logic changes.
   ========================================================= */

:root{
  --v84-away:#58e7bd;
  --v84-away2:#174d44;
  --v84-home:#52dfff;
  --v84-home2:#123e50;
}

.aegis-v84 .v83-matchup{
  display:none!important;
}

.v84-matchup-hero{
  position:relative;
  overflow:hidden;
  min-height:250px;
  border-bottom:1px solid rgba(103,183,214,.16);
  background:
    radial-gradient(circle at 10% 22%,color-mix(in srgb,var(--v84-away) 22%,transparent),transparent 31%),
    radial-gradient(circle at 90% 22%,color-mix(in srgb,var(--v84-home) 22%,transparent),transparent 31%),
    linear-gradient(180deg,#061c29,#04131d);
}

.v84-matchup-hero:before{
  content:"";
  position:absolute;
  width:220px;
  height:220px;
  left:50%;
  bottom:-150px;
  transform:translateX(-50%) rotate(45deg);
  border:1px solid rgba(136,210,230,.12);
  box-shadow:
    0 0 0 28px rgba(103,245,191,.018),
    0 0 0 58px rgba(82,223,255,.012);
}

.v84-matchup-hero:after{
  content:"";
  position:absolute;
  left:50%;
  top:31px;
  bottom:31px;
  width:1px;
  background:linear-gradient(transparent,rgba(141,203,223,.16),transparent);
}

.v84-identity-row{
  position:relative;
  z-index:2;
  display:grid;
  grid-template-columns:minmax(0,1fr) 92px minmax(0,1fr);
  align-items:start;
  gap:10px;
  padding:22px 18px 12px;
}

.v84-team{
  min-width:0;
}
.v84-team.home{text-align:right}

.v84-team-badge{
  position:relative;
  width:76px;
  height:76px;
  display:grid;
  place-items:center;
  border-radius:23px;
  border:1px solid color-mix(in srgb,var(--team) 52%,#24495a);
  background:
    radial-gradient(circle at 32% 22%,rgba(255,255,255,.12),transparent 24%),
    linear-gradient(145deg,color-mix(in srgb,var(--team) 34%,#071a24),#03131b 68%);
  box-shadow:
    0 12px 32px rgba(0,0,0,.28),
    0 0 30px color-mix(in srgb,var(--team) 13%,transparent);
  color:#f6fbfd;
  font-family:Georgia,serif;
  font-size:27px;
  font-weight:900;
  letter-spacing:-.04em;
}

.v84-team.home .v84-team-badge{
  margin-left:auto;
}

.v84-team-role{
  display:block;
  margin-top:10px;
  color:#849dab;
  font-size:8px;
  font-weight:950;
  letter-spacing:.15em;
  text-transform:uppercase;
}

.v84-team-name{
  display:block;
  margin-top:4px;
  color:#eef7fa;
  font-size:16px;
  line-height:1.2;
  font-weight:900;
}

.v84-starter{
  display:block;
  margin-top:6px;
  color:#9eb4bf;
  font-size:10px;
  line-height:1.35;
}

.v84-center{
  position:relative;
  z-index:3;
  padding-top:2px;
  text-align:center;
}

.v84-center small{
  display:block;
  color:#8ba4b2;
  font-size:7px;
  font-weight:950;
  letter-spacing:.14em;
}

.v84-center .v84-score{
  display:flex;
  justify-content:center;
  align-items:center;
  gap:8px;
  margin:10px 0 5px;
}

.v84-center .v84-score b{
  font-size:31px;
  line-height:1;
  color:#f2fbfe;
}

.v84-center .v84-score span{
  color:#708b9a;
  font-size:17px;
}

.v84-center strong{
  display:block;
  color:var(--v83-accent,#67f5bf);
  font-size:9px;
  line-height:1.35;
}

.v84-center em{
  display:block;
  margin-top:5px;
  color:#8299a7;
  font-size:8px;
  font-style:normal;
}

.v84-status-strip{
  position:relative;
  z-index:3;
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:7px;
  padding:7px 18px 18px;
}

.v84-status{
  min-width:0;
  border:1px solid rgba(92,166,196,.18);
  border-radius:12px;
  padding:9px;
  background:rgba(2,14,22,.72);
}

.v84-status small{
  display:block;
  margin-bottom:4px;
  color:#7f98a7;
  font-size:6.5px;
  font-weight:950;
  letter-spacing:.1em;
  text-transform:uppercase;
}

.v84-status b{
  display:block;
  color:#dbe8ed;
  font-size:8.5px;
  line-height:1.35;
  overflow:hidden;
  text-overflow:ellipsis;
}

.v84-status.good{
  border-color:rgba(103,245,191,.27);
}
.v84-status.good b{color:#8fffd7}

.v84-status.warn{
  border-color:rgba(255,214,110,.28);
}
.v84-status.warn b{color:#ffe18f}

/* Matchup Edge Board */
.v84-edgeboard{
  margin:13px 0 0;
  padding:13px;
  border:1px solid rgba(94,168,198,.18);
  border-radius:16px;
  background:
    linear-gradient(180deg,rgba(3,18,27,.76),rgba(3,15,23,.68));
}

.v84-edgehead{
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:12px;
  margin-bottom:11px;
}

.v84-edgehead div small{
  display:block;
  color:#829aa8;
  font-size:7px;
  font-weight:950;
  letter-spacing:.1em;
  text-transform:uppercase;
}

.v84-edgehead div b{
  display:block;
  margin-top:3px;
  font-size:13px;
}

.v84-edgehead > span{
  color:#7f96a4;
  font-size:7px;
  text-align:right;
}

.v84-edge-row{
  display:grid;
  grid-template-columns:102px 1fr 56px;
  align-items:center;
  gap:8px;
  padding:9px 0;
  border-top:1px solid rgba(93,162,190,.11);
}

.v84-edge-row:first-of-type{
  border-top:0;
}

.v84-edge-label b{
  display:block;
  color:#dde9ee;
  font-size:9px;
  line-height:1.25;
}

.v84-edge-label span{
  display:block;
  margin-top:2px;
  color:#788f9d;
  font-size:6.5px;
}

.v84-edge-track{
  position:relative;
  height:9px;
  border-radius:999px;
  background:
    linear-gradient(90deg,
      color-mix(in srgb,var(--v84-away) 18%,#0d2b3a),
      #112f3f 48%,
      #112f3f 52%,
      color-mix(in srgb,var(--v84-home) 18%,#0d2b3a)
    );
}

.v84-edge-track:after{
  content:"";
  position:absolute;
  left:50%;
  top:-4px;
  width:1px;
  height:17px;
  background:rgba(202,229,238,.26);
}

.v84-edge-marker{
  position:absolute;
  top:50%;
  width:14px;
  height:14px;
  border-radius:50%;
  transform:translate(-50%,-50%);
  background:var(--marker);
  box-shadow:0 0 12px color-mix(in srgb,var(--marker) 42%,transparent);
  border:2px solid rgba(3,15,23,.9);
}

.v84-edge-side{
  text-align:right;
}

.v84-edge-side b{
  display:block;
  font-size:8px;
  color:#cfe0e7;
}

.v84-edge-side span{
  display:block;
  margin-top:2px;
  font-size:6.5px;
  color:#778e9b;
}

/* Compact game environment */
.v84-environment{
  margin-top:11px;
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:7px;
}

.v84-env-card{
  border:1px solid rgba(94,167,197,.17);
  border-radius:13px;
  background:rgba(3,16,24,.65);
  padding:10px;
}

.v84-env-card small{
  display:block;
  color:#8199a7;
  font-size:7px;
  letter-spacing:.09em;
  font-weight:950;
  text-transform:uppercase;
}

.v84-env-card b{
  display:block;
  margin-top:4px;
  color:#e1edf1;
  font-size:9px;
  line-height:1.35;
}

/* Final Card team-color cue */
.aegis-v84 #v82QuickOrders .v82-order{
  position:relative;
  overflow:hidden;
}
.aegis-v84 #v82QuickOrders .v82-order:before{
  content:"";
  position:absolute;
  left:0;
  right:0;
  top:0;
  height:2px;
  background:linear-gradient(90deg,var(--v84-away),var(--v84-home));
  opacity:.75;
}

@media(max-width:760px){
  .v84-identity-row{
    grid-template-columns:minmax(0,1fr) 76px minmax(0,1fr);
    padding:18px 14px 10px;
  }
  .v84-team-badge{
    width:60px;
    height:60px;
    border-radius:19px;
    font-size:23px;
  }
  .v84-team-name{font-size:12px}
  .v84-starter{font-size:8px}
  .v84-center .v84-score b{font-size:25px}
  .v84-status-strip{padding:6px 14px 14px}
  .v84-edge-row{grid-template-columns:91px 1fr 51px}
}
"""
js = r"""
(function(){
  "use strict";

  var MLB_COLORS={
    "Arizona Diamondbacks":["#A71930","#E3D4AD"],
    "Atlanta Braves":["#CE1141","#13274F"],
    "Baltimore Orioles":["#DF4601","#000000"],
    "Boston Red Sox":["#BD3039","#0C2340"],
    "Chicago Cubs":["#0E3386","#CC3433"],
    "Chicago White Sox":["#27251F","#C4CED4"],
    "Cincinnati Reds":["#C6011F","#FFFFFF"],
    "Cleveland Guardians":["#00385D","#E50022"],
    "Colorado Rockies":["#33006F","#C4CED4"],
    "Detroit Tigers":["#0C2340","#FA4616"],
    "Houston Astros":["#002D62","#EB6E1F"],
    "Kansas City Royals":["#004687","#BD9B60"],
    "Los Angeles Angels":["#BA0021","#003263"],
    "Los Angeles Dodgers":["#005A9C","#EF3E42"],
    "Miami Marlins":["#00A3E0","#EF3340"],
    "Milwaukee Brewers":["#12284B","#FFC52F"],
    "Minnesota Twins":["#002B5C","#D31145"],
    "New York Mets":["#002D72","#FF5910"],
    "New York Yankees":["#0C2340","#C4CED4"],
    "Athletics":["#003831","#EFB21E"],
    "Oakland Athletics":["#003831","#EFB21E"],
    "Philadelphia Phillies":["#E81828","#002D72"],
    "Pittsburgh Pirates":["#27251F","#FDB827"],
    "San Diego Padres":["#2F241D","#FFC425"],
    "San Francisco Giants":["#FD5A1E","#27251F"],
    "Seattle Mariners":["#0C2C56","#005C5C"],
    "St. Louis Cardinals":["#C41E3A","#0C2340"],
    "Tampa Bay Rays":["#092C5C","#8FBCE6"],
    "Texas Rangers":["#003278","#C0111F"],
    "Toronto Blue Jays":["#134A8E","#1D2D5C"],
    "Washington Nationals":["#AB0003","#14225A"]
  };

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
  function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
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
    })||c.analyses[0]||null;
  }
  function candidate(a){
    if(!a)return null;
    var rows=(a.market&&Array.isArray(a.market.all))?a.market.all.slice():[];
    var order=["CORE","SECONDARY","WATCH","PASS"];
    for(var i=0;i<order.length;i++){
      var hit=rows.find(function(x){return String(x.tier||"").toUpperCase()===order[i]});
      if(hit)return hit;
    }
    return (a.market&&a.market.best)||rows[0]||null;
  }
  function initials(name){
    var parts=String(name||"").trim().split(/\s+/).filter(Boolean);
    if(!parts.length)return "--";
    if(parts.length===1)return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
  }
  function hashColor(name,offset){
    var h=0,s=String(name||"");
    for(var i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i);
    h=Math.abs(h+(offset||0))%360;
    return "hsl("+h+" 68% 50%)";
  }
  function colors(name){
    return MLB_COLORS[name]||[hashColor(name,0),hashColor(name,93)];
  }
  function notes(a){
    var pr=(a&&a.projection)||{};
    return Array.isArray(pr.notes)?pr.notes:[];
  }
  function findNote(a,needle){
    var key=String(needle||"").toLowerCase();
    return notes(a).find(function(x){
      return String(x||"").toLowerCase().indexOf(key)>=0;
    })||"";
  }
  function stripPrefix(text,prefix){
    var x=String(text||"");
    var i=x.toLowerCase().indexOf(String(prefix||"").toLowerCase());
    if(i<0)return x;
    var colon=x.indexOf(":",i);
    return colon>=0?x.slice(colon+1).trim():x;
  }
  function starters(a){
    var note=findNote(a,"probable starters");
    var raw=stripPrefix(note,"probable starters");
    var parts=raw.split(/\s+vs\.?\s+/i);
    return {
      away:(parts[0]||"Starter feed pending").trim(),
      home:(parts[1]||"Starter feed pending").trim()
    };
  }
  function lineupStatus(a){
    var note=findNote(a,"lineup");
    if(!note)return {text:"Lineup feed pending",cls:"warn"};
    var low=note.toLowerCase();
    if(low.indexOf("confirmed")>=0 && low.indexOf("not")<0)return {text:"Lineups confirmed",cls:"good"};
    if(low.indexOf("not yet")>=0||low.indexOf("not confirmed")>=0)return {text:"Lineups pending",cls:"warn"};
    return {text:String(note),cls:""};
  }
  function weatherText(w){
    if(!w)return "Weather feed pending";
    if(typeof w==="string")return w;
    var bits=[];
    var temp=w.temperature_f??w.temp_f??w.temperature??w.temp;
    var wind=w.wind_mph??w.wind_speed_mph??w.wind_speed??w.wind;
    var precip=w.precipitation_probability??w.precip_probability??w.precip;
    var cond=w.condition??w.summary??w.weather;
    if(cond)bits.push(String(cond));
    if(temp!=null)bits.push(String(Math.round(Number(temp)))+"Â°");
    if(wind!=null)bits.push("Wind "+String(Math.round(Number(wind)))+" mph");
    if(precip!=null)bits.push("Rain "+String(Math.round(Number(precip)))+"%");
    return bits.length?bits.join(" â€¢ "):"Weather feed synced";
  }
  function venueText(a){
    var e=(a&&a.event)||{},pr=(a&&a.projection)||{};
    return e.venue||e.stadium||pr.venue||pr.ballpark||pr.park_name||"Venue context pending";
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
  function countdown(iso){
    var t=new Date(iso).getTime();
    if(!Number.isFinite(t))return "Pregame";
    var ms=t-Date.now();
    if(ms<=0)return "Game time";
    var min=Math.round(ms/60000);
    if(min<60)return "Starts in "+min+"m";
    var h=Math.floor(min/60),m=min%60;
    return "Starts in "+h+"h"+(m?" "+m+"m":"");
  }
  function projected(a){
    var pr=(a&&a.projection)||{},sc=pr.projected_score||{};
    return {
      away:Number.isFinite(Number(sc.away))?Number(sc.away):"--",
      home:Number.isFinite(Number(sc.home))?Number(sc.home):"--"
    };
  }
  function modules(a){
    var pr=(a&&a.projection)||{};
    return Array.isArray(pr.modules)?pr.modules:[];
  }
  function moduleMatch(a,keys){
    var list=modules(a);
    for(var i=0;i<keys.length;i++){
      var key=keys[i].toLowerCase();
      var hit=list.find(function(m){
        return String(m.name||"").toLowerCase().indexOf(key)>=0;
      });
      if(hit)return hit;
    }
    return null;
  }
  function edgeRow(a,label,keys,away,home){
    var m=moduleMatch(a,keys);
    if(!m)return "";
    var value=clamp(n(m.value,0),-.65,.65);
    var conf=clamp(n(m.confidence,0),0,100);
    var left=((value+.65)/1.3)*100;
    var side=value>.025?home:value<-.025?away:"Neutral";
    var color=value>.025?"var(--v84-home)":value<-.025?"var(--v84-away)":"#a5b7c0";
    var signed=(value>0?"+":"")+value.toFixed(2);
    return '<div class="v84-edge-row">'+
      '<div class="v84-edge-label"><b>'+esc(label)+'</b><span>'+Math.round(conf)+'/100 confidence</span></div>'+
      '<div class="v84-edge-track"><i class="v84-edge-marker" style="left:'+left.toFixed(1)+'%;--marker:'+color+'"></i></div>'+
      '<div class="v84-edge-side"><b>'+esc(side)+'</b><span>'+esc(signed)+'</span></div>'+
    '</div>';
  }
  function matchupBoard(a){
    var e=a.event||{};
    var rows=[
      edgeRow(a,"Starting pitching",["starting pitcher quality","starter quality"],e.away_team,e.home_team),
      edgeRow(a,"Bullpen",["bullpen availability","bullpen"],e.away_team,e.home_team),
      edgeRow(a,"Offense",["offense / run support","offense","run support"],e.away_team,e.home_team),
      edgeRow(a,"Recent form",["recent form"],e.away_team,e.home_team),
      edgeRow(a,"Home field",["home field"],e.away_team,e.home_team)
    ].filter(Boolean);
    if(!rows.length)return "";
    return '<div class="v84-edgeboard">'+
      '<div class="v84-edgehead"><div><small>MATCHUP EDGE BOARD</small><b>Where the projection is leaning</b></div><span>Marker direction, not a bet recommendation</span></div>'+
      rows.join("")+
    '</div>';
  }
  function cleanTotals(){
    qa(".v82-orderpick strong,.v82-focus em,.v83-expression strong").forEach(function(el){
      var t=el.textContent||"";
      var fixed=t.replace(/\b(Over|Under)\s+\+(\d+(?:\.\d+)?)\b/g,"$1 $2");
      if(fixed!==t)el.textContent=fixed;
    });
  }
  function renderHero(){
    var intel=q("#v83Intel");
    var a=analysis();
    if(!intel||!a)return;
    var hero=q("#v84Hero",intel);
    var e=a.event||{},pr=a.projection||{},st=starters(a),lu=lineupStatus(a),sc=projected(a);
    var aw=colors(e.away_team),ho=colors(e.home_team);
    document.documentElement.style.setProperty("--v84-away",aw[0]);
    document.documentElement.style.setProperty("--v84-away2",aw[1]);
    document.documentElement.style.setProperty("--v84-home",ho[0]);
    document.documentElement.style.setProperty("--v84-home2",ho[1]);

    if(!hero){
      hero=document.createElement("div");
      hero.id="v84Hero";
      hero.className="v84-matchup-hero";
      var verdict=q(".v83-verdict",intel);
      if(verdict)intel.insertBefore(hero,verdict);
      else intel.insertBefore(hero,intel.firstChild);
    }

    hero.innerHTML=
      '<div class="v84-identity-row">'+
        '<div class="v84-team away" style="--team:'+aw[0]+'">'+
          '<div class="v84-team-badge">'+esc(initials(e.away_team))+'</div>'+
          '<span class="v84-team-role">Away</span>'+
          '<strong class="v84-team-name">'+esc(e.away_team||"Away")+'</strong>'+
          '<span class="v84-starter">'+esc(st.away)+'</span>'+
        '</div>'+
        '<div class="v84-center">'+
          '<small>AEGIS MATCHUP</small>'+
          '<div class="v84-score"><b>'+esc(sc.away)+'</b><span>â€”</span><b>'+esc(sc.home)+'</b></div>'+
          '<strong>'+esc(timeText(e.commence_time))+'</strong>'+
          '<em>'+esc(countdown(e.commence_time))+'</em>'+
        '</div>'+
        '<div class="v84-team home" style="--team:'+ho[0]+'">'+
          '<div class="v84-team-badge">'+esc(initials(e.home_team))+'</div>'+
          '<span class="v84-team-role">Home</span>'+
          '<strong class="v84-team-name">'+esc(e.home_team||"Home")+'</strong>'+
          '<span class="v84-starter">'+esc(st.home)+'</span>'+
        '</div>'+
      '</div>'+
      '<div class="v84-status-strip">'+
        '<div class="v84-status '+lu.cls+'"><small>Lineups</small><b>'+esc(lu.text)+'</b></div>'+
        '<div class="v84-status"><small>Weather</small><b>'+esc(weatherText(pr.weather))+'</b></div>'+
        '<div class="v84-status"><small>Venue</small><b>'+esc(venueText(a))+'</b></div>'+
      '</div>';
  }
  function renderBoard(){
    var a=analysis(),intel=q("#v83Intel");
    if(!a||!intel)return;
    var body=q(".v83-tabbody",intel);
    if(!body)return;

    var current=q("#v84EdgeBoard",body);
    if(current)current.remove();

    var html=matchupBoard(a);
    if(!html)return;
    var holder=document.createElement("div");
    holder.id="v84EdgeBoard";
    holder.innerHTML=html;
    body.appendChild(holder);
  }
  function updateQuickColors(){
    var c=card();
    if(!c)return;
    var p=(c.plays||[]).find(function(x){return ["CORE","SECONDARY","WATCH"].includes(x.tier)});
    if(!p)return;
    var e=(c.analyses||[]).map(function(x){return x.event}).find(function(x){return x&&x.id===p.event_id})||p.event;
    if(!e)return;
    var aw=colors(e.away_team),ho=colors(e.home_team);
    document.documentElement.style.setProperty("--v84-away",aw[0]);
    document.documentElement.style.setProperty("--v84-home",ho[0]);
  }
  function refresh(){
    renderHero();
    renderBoard();
    updateQuickColors();
    cleanTotals();
  }
  function start(){
    document.documentElement.classList.add("aegis-v84");
    refresh();

    var observer=new MutationObserver(function(){
      cleanTotals();
      renderHero();
    });
    observer.observe(document.body,{childList:true,subtree:true});

    setInterval(refresh,900);

    var lab=q("#labGame");
    if(lab)lab.addEventListener("change",function(){setTimeout(refresh,60)});
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

css_tag = '<link rel="stylesheet" href="/visual-v8_4.css?v=8.4.0">'
if css_tag not in html:
    anchor = '<link rel="stylesheet" href="/visual-v8_3.css?v=8.3.0">'
    if anchor not in html:
        raise SystemExit("v8.3 stylesheet tag was not found.")
    html = html.replace(anchor, anchor + "\n" + css_tag, 1)

js_tag = '<script src="/app-v8_4.js?v=8.4.0" defer></script>'
if js_tag not in html:
    anchors = [
        '<script src="/app-v8_3_2.js?v=8.3.2" defer></script>',
        '<script src="/app-v8_3_1.js?v=8.3.1" defer></script>',
        '<script src="/app-v8_3.js?v=8.3.0" defer></script>'
    ]
    anchor = next((x for x in anchors if x in html), None)
    if anchor is None:
        raise SystemExit("Could not find a v8.3 script tag.")
    html = html.replace(anchor, anchor + "\n" + js_tag, 1)

for old in [
    "v8.3.2 â€¢ STABLE GAME INTELLIGENCE UI",
    "v8.3.1 â€¢ GAME INTELLIGENCE & PERSONALITY",
    "v8.3 â€¢ GAME INTELLIGENCE & PERSONALITY"
]:
    html = html.replace(old, "v8.4 â€¢ TEAM IDENTITY & VISUAL MATCHUPS")

INDEX.write_text(html)

print("AEGIS v8.4 Team Identity & Visual Matchups prepared.")
