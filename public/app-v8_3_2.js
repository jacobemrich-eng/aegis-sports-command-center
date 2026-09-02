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
