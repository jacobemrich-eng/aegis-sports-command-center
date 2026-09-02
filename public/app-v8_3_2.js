(function(){
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

    var card=q("#card");
    if(!card)return;

    var queued=false;
    var observer=new MutationObserver(function(){
      if(queued)return;
      queued=true;
      queueMicrotask(function(){
        queued=false;
        stabilizeCardVoice();
      });
    });

    observer.observe(card,{
      childList:true,
      subtree:true
    });
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",start);
  }else{
    start();
  }
})();
