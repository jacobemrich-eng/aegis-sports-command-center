
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
