from pathlib import Path

INDEX = Path("public/index.html")
HOTFIX = Path("public/app-v8_3_2.js")

js = r"""(function(){
  "use strict";

  function q(s,r){return (r||document).querySelector(s)}

  function stabilizeCardVoice(){
    var quick=q("#v82QuickOrders");
    var voice=q("#v83CardVoice");

    if(!quick || !voice)return;

    if(voice.parentElement===quick){
      quick.insertAdjacentElement("afterend",voice);
    }
  }

  function start(){
    document.documentElement.classList.add("aegis-v832");
    stabilizeCardVoice();

    var observer=new MutationObserver(function(){
      stabilizeCardVoice();
    });

    observer.observe(document.body,{
      childList:true,
      subtree:true
    });

    setInterval(stabilizeCardVoice,500);
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",start);
  }else{
    start();
  }
})();
"""

HOTFIX.write_text(js)

html = INDEX.read_text()

tag = '<script src="/app-v8_3_2.js?v=8.3.2" defer></script>'

if tag not in html:
    anchor = '<script src="/app-v8_3_1.js?v=8.3.1" defer></script>'
    if anchor not in html:
        anchor = '<script src="/app-v8_3.js?v=8.3.0" defer></script>'
    if anchor not in html:
        raise SystemExit("Could not find the v8.3 script tag.")
    html = html.replace(anchor, anchor + "\n" + tag, 1)

html = html.replace(
    "v8.3.1 â€¢ GAME INTELLIGENCE & PERSONALITY",
    "v8.3.2 â€¢ STABLE GAME INTELLIGENCE UI"
)

INDEX.write_text(html)

print("AEGIS v8.3.2 card-voice stability hotfix prepared.")
