(function(){
  "use strict";

  function q(s,r){return (r||document).querySelector(s)}
  function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}

  function bad(){
    return {
      dash:String.fromCharCode(0x00e2,0x20ac,0x201d),
      bullet:String.fromCharCode(0x00e2,0x20ac,0x00a2),
      arrow:String.fromCharCode(0x00e2,0x2020,0x2019),
      ndash:String.fromCharCode(0x00e2,0x20ac,0x201c),
      apostrophe:String.fromCharCode(0x00e2,0x20ac,0x2122),
      leftquote:String.fromCharCode(0x00e2,0x20ac,0x0153)
    };
  }

  function replaceAll(text,from,to){
    return text.split(from).join(to);
  }

  function repairText(text){
    var b=bad();
    var out=String(text||"");
    out=replaceAll(out,b.dash,"\u2014");
    out=replaceAll(out,b.bullet,"\u2022");
    out=replaceAll(out,b.arrow,"\u2192");
    out=replaceAll(out,b.ndash,"\u2013");
    out=replaceAll(out,b.apostrophe,"\u2019");
    out=replaceAll(out,b.leftquote,"\u201c");
    return out;
  }

  function cleanText(root){
    if(!root)return;
    var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    var node;
    while((node=walker.nextNode())){
      var fixed=repairText(node.nodeValue);
      if(fixed!==node.nodeValue)node.nodeValue=fixed;
    }
  }

  function cleanTotalText(el){
    if(!el)return;
    var text=el.textContent||"";
    var fixed=text.replace(/\b(Over|Under)\s+\+(\d+(?:\.\d+)?)\b/g,"$1 $2");
    if(fixed!==text)el.textContent=fixed;
  }

  function fixTotals(){
    qa(".v82-focus em,.v82-orderpick strong,.v83-expression strong").forEach(cleanTotalText);
  }

  function fixUncertainty(){
    qa(".v83-gauge").forEach(function(g){
      var label=q("label",g);
      if(!label||label.textContent.trim().toLowerCase().indexOf("uncertainty")!==0)return;

      var value=q("b",g);
      var fill=q(".v83-track i",g);
      var match=value&&value.textContent.match(/(\d+(?:\.\d+)?)\s*\/\s*100/);
      if(!match||!fill)return;

      var amount=Math.max(0,Math.min(100,Number(match[1])));
      fill.style.width=amount+"%";
      fill.style.background="linear-gradient(90deg,#67f5bf,#ffd66e,#ff7382)";

      if(label.textContent!=="Uncertainty \u2193"){
        label.textContent="Uncertainty \u2193";
      }

      g.title="Lower is better";
    });
  }

  function fixVersion(){
    var pill=q(".versionpill");
    if(pill&&pill.textContent!=="v8.3.1 \u2022 GAME INTELLIGENCE & PERSONALITY"){
      pill.textContent="v8.3.1 \u2022 GAME INTELLIGENCE & PERSONALITY";
    }
  }

  function polish(){
    cleanText(q("#v83Intel"));
    cleanText(q("#v83CardVoice"));
    fixTotals();
    fixUncertainty();
    fixVersion();
  }

  function start(){
    document.documentElement.classList.add("aegis-v831");
    polish();

    var observer=new MutationObserver(function(){
      polish();
    });

    [q("#lab"),q("#card")].filter(Boolean).forEach(function(root){
      observer.observe(root,{
        childList:true,
        subtree:true
      });
    });
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",start);
  }else{
    start();
  }
})();
