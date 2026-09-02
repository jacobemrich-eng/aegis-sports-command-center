from pathlib import Path
INDEX=Path("public/index.html")
JS=Path("public/app-v8_4.js")
CSS=Path("public/visual-v8_4.css")
JS.write_text(r"""(function(){
"use strict";
var lastKey="",lastId="";
function q(s,r){return (r||document).querySelector(s)}
function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function card(){return window.LAST&&typeof window.LAST==="object"?window.LAST:null}
function selectedId(){var s=q("#labGame");return (s&&s.value)||window.ACTIVE_GAME||null}
function analysis(){var c=card(),id=selectedId();if(!c||!Array.isArray(c.analyses))return null;return c.analyses.find(function(a){return a&&a.event&&(a.event.id===id||a.event_id===id)})||c.analyses[0]||null}
function initials(name){var p=String(name||"").trim().split(/\s+/).filter(Boolean);return !p.length?"--":p.length===1?p[0].slice(0,2).toUpperCase():(p[0][0]+p[p.length-1][0]).toUpperCase()}
function hash(name,o){var h=0,s=String(name||"");for(var i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i);return "hsl("+(Math.abs(h+(o||0))%360)+" 68% 50%)"}
var C={"San Diego Padres":["#2F241D","#FFC425"],"Cincinnati Reds":["#C6011F","#FFFFFF"],"Texas Rangers":["#003278","#C0111F"],"Athletics":["#003831","#EFB21E"],"Boston Red Sox":["#BD3039","#0C2340"],"Seattle Mariners":["#0C2C56","#005C5C"],"Toronto Blue Jays":["#134A8E","#1D2D5C"],"Cleveland Guardians":["#00385D","#E50022"]};
function colors(n){return C[n]||[hash(n,0),hash(n,93)]}
function notes(a){var p=(a&&a.projection)||{};return Array.isArray(p.notes)?p.notes:[]}
function note(a,k){k=k.toLowerCase();return notes(a).find(function(x){return String(x||"").toLowerCase().indexOf(k)>=0})||""}
function starters(a){var x=note(a,"probable starters"),c=x.indexOf(":");x=c>=0?x.slice(c+1):x;var p=x.split(/\s+vs\.?\s+/i);return {away:(p[0]||"Starter feed pending").trim(),home:(p[1]||"Starter feed pending").trim()}}
function lineup(a){var x=note(a,"lineup"),l=x.toLowerCase();if(!x)return ["Lineup feed pending","warn"];if(l.indexOf("confirmed")>=0&&l.indexOf("not")<0)return ["Lineups confirmed","good"];return ["Lineups pending","warn"]}
function weather(w){if(!w)return "Weather feed pending";if(typeof w==="string")return w;var b=[],t=w.temperature_f??w.temp_f??w.temperature??w.temp,wind=w.wind_mph??w.wind_speed_mph??w.wind_speed??w.wind;if(w.condition||w.summary)b.push(String(w.condition||w.summary));if(t!=null)b.push(Math.round(Number(t))+"Â°");if(wind!=null)b.push("Wind "+Math.round(Number(wind))+" mph");return b.join(" â€¢ ")||"Weather feed synced"}
function venue(a){var e=a.event||{},p=a.projection||{};return e.venue||e.stadium||p.venue||p.ballpark||p.park_name||"Venue context pending"}
function time(iso){var d=new Date(iso);if(!Number.isFinite(d.getTime()))return "Time TBD";return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"numeric",minute:"2-digit"}).format(d)+" ET"}
function countdown(iso){var t=new Date(iso).getTime(),m=Math.round((t-Date.now())/60000);if(!Number.isFinite(t))return "Pregame";if(m<=0)return "Game time";if(m<60)return "Starts in "+m+"m";return "Starts in "+Math.floor(m/60)+"h "+(m%60)+"m"}
function cleanTotals(){qa(".v82-orderpick strong,.v82-focus em,.v83-expression strong").forEach(function(el){var t=el.textContent||"",f=t.replace(/\b(Over|Under)\s+\+(\d+(?:\.\d+)?)\b/g,"$1 $2");if(f!==t)el.textContent=f})}
function renderHero(a){
 var intel=q("#v83Intel");if(!intel||!a||!a.event)return;
 var e=a.event,p=a.projection||{},sc=p.projected_score||{},st=starters(a),lu=lineup(a),aw=colors(e.away_team),ho=colors(e.home_team);
 document.documentElement.style.setProperty("--v84-away",aw[0]);document.documentElement.style.setProperty("--v84-home",ho[0]);
 var hero=q("#v84Hero",intel);if(!hero){hero=document.createElement("div");hero.id="v84Hero";hero.className="v84-matchup-hero";var v=q(".v83-verdict",intel);if(v)intel.insertBefore(hero,v);else intel.insertBefore(hero,intel.firstChild)}
 hero.dataset.commence=e.commence_time||"";
 hero.innerHTML='<div class="v84-identity-row"><div class="v84-team away" style="--team:'+aw[0]+'"><div class="v84-team-badge">'+esc(initials(e.away_team))+'</div><span class="v84-team-role">Away</span><strong class="v84-team-name">'+esc(e.away_team)+'</strong><span class="v84-starter">'+esc(st.away)+'</span></div><div class="v84-center"><small>AEGIS MATCHUP</small><div class="v84-score"><b>'+esc(sc.away??"--")+'</b><span>â€”</span><b>'+esc(sc.home??"--")+'</b></div><strong>'+esc(time(e.commence_time))+'</strong><em class="v84-countdown">'+esc(countdown(e.commence_time))+'</em></div><div class="v84-team home" style="--team:'+ho[0]+'"><div class="v84-team-badge">'+esc(initials(e.home_team))+'</div><span class="v84-team-role">Home</span><strong class="v84-team-name">'+esc(e.home_team)+'</strong><span class="v84-starter">'+esc(st.home)+'</span></div></div><div class="v84-status-strip"><div class="v84-status '+lu[1]+'"><small>Lineups</small><b>'+esc(lu[0])+'</b></div><div class="v84-status"><small>Weather</small><b>'+esc(weather(p.weather))+'</b></div><div class="v84-status"><small>Venue</small><b>'+esc(venue(a))+'</b></div></div>';
}
function render(force){
 var c=card(),a=analysis();if(!c||!a||!a.event)return;
 var id=a.event.id||a.event_id||"",key=[c.generated_at||"",id,a.event.commence_time||"",notes(a).length].join("|");
 if(!force&&key===lastKey)return;lastKey=key;lastId=id;renderHero(a);cleanTotals()
}
function tick(){
 var a=analysis(),id=a&&a.event&&(a.event.id||a.event_id)||"";
 if(id&&id!==lastId){lastKey="";render(true)}else render(false);
 var h=q("#v84Hero"),em=h&&q(".v84-countdown",h);if(em)em.textContent=countdown(h.dataset.commence);
 cleanTotals();
}
function bind(){
 var lab=q("#labGame");if(lab&&!lab.dataset.v841){lab.dataset.v841="1";lab.addEventListener("change",function(){lastKey="";setTimeout(function(){render(true)},80)})}
 qa(".navbtn").forEach(function(b){if(b.dataset.v841)return;b.dataset.v841="1";b.addEventListener("click",function(){if(b.dataset.tab==="lab"){lastKey="";setTimeout(function(){render(true)},100)}else setTimeout(cleanTotals,100)})})
}
function start(){document.documentElement.classList.add("aegis-v84");bind();render(true);cleanTotals();setInterval(function(){bind();tick()},5000)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();""")
css=CSS.read_text() if CSS.exists() else ""
patch=r"""
.v84-matchup-hero:before,.v84-matchup-hero:after{pointer-events:none!important}
"""
if patch.strip() not in css: css+="\n"+patch+"\n"
CSS.write_text(css)
html=INDEX.read_text()
html=html.replace('/app-v8_4.js?v=8.4.0','/app-v8_4.js?v=8.4.1')
html=html.replace('/visual-v8_4.css?v=8.4.0','/visual-v8_4.css?v=8.4.1')
html=html.replace('v8.4 â€¢ TEAM IDENTITY & VISUAL MATCHUPS','v8.4.1 â€¢ FAST TEAM IDENTITY UI')
INDEX.write_text(html)
print("AEGIS v8.4.1 performance hotfix prepared.")
