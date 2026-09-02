from pathlib import Path

INDEX = Path("public/index.html")
VISUAL = Path("public/visual-v8_1.css")

css = r"""/* SB101 AEGIS v8.1 — VISUAL COMMAND CENTER */
:root{
  --v81-ink:#02070c;--v81-deep:#04111a;--v81-glass:rgba(8,27,40,.76);
  --v81-mint:#67f5bf;--v81-cyan:#50dcff;--v81-gold:#ffd66e;--v81-red:#ff7f8d;
  --v81-blue:#7ec7ff;--v81-line:rgba(117,196,231,.18)
}
body{
  background:
    radial-gradient(circle at 50% -8%,rgba(80,220,255,.09),transparent 32%),
    radial-gradient(circle at 88% 12%,rgba(103,245,191,.075),transparent 24%),
    radial-gradient(circle at 5% 38%,rgba(126,199,255,.055),transparent 22%),
    linear-gradient(180deg,#04111a 0%,#030b12 52%,#02070c 100%)
}
body:before{
  background:
    radial-gradient(circle at 14% -6%,rgba(80,220,255,.18),transparent 28%),
    radial-gradient(circle at 87% 4%,rgba(103,245,191,.14),transparent 28%),
    radial-gradient(circle at 52% 44%,rgba(80,220,255,.035),transparent 38%),
    linear-gradient(180deg,#061722 0,#040f17 52%,#02080d 100%)
}
body:after{
  opacity:.22;
  background-image:
    linear-gradient(rgba(127,205,235,.028) 1px,transparent 1px),
    linear-gradient(90deg,rgba(127,205,235,.028) 1px,transparent 1px),
    radial-gradient(circle,rgba(103,245,191,.22) 1px,transparent 1.5px);
  background-size:34px 34px,34px 34px,110px 110px;
  mask-image:linear-gradient(to bottom,black 0%,rgba(0,0,0,.8) 52%,transparent 94%)
}
.wrap{max-width:1200px}
.hero{
  isolation:isolate;overflow:hidden;margin-top:4px;padding:30px 30px 27px;
  border:1px solid rgba(103,245,191,.16);border-radius:30px;
  background:
    linear-gradient(112deg,rgba(11,36,48,.96),rgba(5,18,28,.91) 58%,rgba(5,29,27,.82)),
    radial-gradient(circle at 85% 22%,rgba(103,245,191,.15),transparent 26%);
  box-shadow:0 28px 70px rgba(0,0,0,.31),0 0 0 1px rgba(255,255,255,.018) inset
}
.hero:before{
  content:"A";position:absolute;right:5%;top:50%;z-index:-1;transform:translateY(-50%);
  width:156px;height:178px;display:grid;place-items:center;
  clip-path:polygon(50% 0,90% 15%,84% 68%,50% 100%,16% 68%,10% 15%);
  color:rgba(202,255,235,.34);font-size:76px;font-weight:1000;letter-spacing:-.08em;
  background:linear-gradient(145deg,rgba(103,245,191,.16),rgba(80,220,255,.035)),rgba(5,21,29,.68);
  filter:drop-shadow(0 18px 28px rgba(0,0,0,.35))
}
.hero:after{
  content:"";position:absolute;right:2.2%;top:50%;z-index:-2;transform:translateY(-50%);
  width:220px;height:220px;border:1px solid rgba(80,220,255,.10);border-radius:50%;
  background:
    linear-gradient(90deg,transparent 49.4%,rgba(80,220,255,.11) 49.8%,rgba(80,220,255,.11) 50.2%,transparent 50.6%),
    linear-gradient(transparent 49.4%,rgba(80,220,255,.08) 49.8%,rgba(80,220,255,.08) 50.2%,transparent 50.6%);
  box-shadow:0 0 0 28px rgba(80,220,255,.018),0 0 0 58px rgba(103,245,191,.012)
}
.hero h1{max-width:720px;text-shadow:0 8px 32px rgba(0,0,0,.30)}
.hero p{max-width:760px}
.eyebrow{color:var(--v81-mint);text-shadow:0 0 22px rgba(103,245,191,.24)}
.versionpill{border-color:rgba(103,245,191,.28);background:rgba(7,41,34,.68)}
.statusline{backdrop-filter:blur(14px);box-shadow:0 12px 28px rgba(0,0,0,.20)}
.statusline:not(.bad) .dot{animation:v81Pulse 2.2s ease-in-out infinite}
.health{
  position:relative;overflow:hidden;
  background:linear-gradient(180deg,rgba(8,30,43,.80),rgba(4,19,29,.83));
  border-color:rgba(111,188,220,.18);backdrop-filter:blur(12px)
}
.health:after{content:"";position:absolute;left:0;bottom:0;height:2px;width:38%;background:linear-gradient(90deg,var(--accent),transparent);opacity:.55}
.navwrap{top:env(safe-area-inset-top,0);padding:12px 0;background:linear-gradient(180deg,rgba(3,11,17,.96) 72%,transparent)}
.navgrid{padding:6px;border:1px solid rgba(101,175,206,.12);border-radius:21px;background:rgba(5,19,29,.62);backdrop-filter:blur(18px);box-shadow:0 12px 35px rgba(0,0,0,.18)}
.navbtn{border-color:transparent;border-radius:16px;background:rgba(7,28,41,.56);transition:.18s ease}
.navbtn:active{transform:scale(.975)}
.navbtn.active{
  border-color:rgba(103,245,191,.55);
  background:linear-gradient(180deg,rgba(14,52,54,.94),rgba(7,31,41,.94));
  box-shadow:0 0 0 1px rgba(103,245,191,.08) inset,0 10px 26px rgba(0,0,0,.22),0 0 28px rgba(103,245,191,.07)
}
.panel{
  border-color:rgba(102,175,207,.18);
  background:linear-gradient(180deg,rgba(10,31,45,.91),rgba(5,20,30,.94));
  box-shadow:0 22px 55px rgba(0,0,0,.24),0 0 0 1px rgba(255,255,255,.016) inset;
  backdrop-filter:blur(14px)
}
.autopilotPanel{
  position:relative;isolation:isolate;overflow:hidden;border-color:rgba(103,245,191,.26);
  background:radial-gradient(circle at 90% 28%,rgba(103,245,191,.08),transparent 27%),linear-gradient(135deg,rgba(8,40,47,.95),rgba(5,24,36,.96))
}
.autopilotPanel:before{
  content:"SYSTEM ONLINE";position:absolute;right:20px;top:18px;padding:5px 8px;
  border:1px solid rgba(103,245,191,.24);border-radius:999px;color:rgba(180,255,228,.72);
  background:rgba(3,26,24,.48);font-size:8px;font-weight:950;letter-spacing:.14em
}
.autopilotPanel:after{
  content:"";position:absolute;z-index:-1;width:190px;height:190px;right:-58px;bottom:-62px;border-radius:50%;
  background:conic-gradient(from 0deg,transparent 0 72%,rgba(103,245,191,.10) 79%,transparent 86%),repeating-radial-gradient(circle,rgba(80,220,255,.08) 0 1px,transparent 1px 28px);
  border:1px solid rgba(80,220,255,.08);animation:v81Radar 12s linear infinite
}
.autopilotPanel .micro{background:rgba(3,17,26,.63);border-color:rgba(93,165,195,.20)}
.mission{
  border-color:rgba(80,220,255,.18);
  background:radial-gradient(circle at 92% 82%,rgba(80,220,255,.09),transparent 26%),linear-gradient(145deg,rgba(8,31,44,.95),rgba(5,19,29,.96))
}
.mission:before{content:"PRECISION MODE";position:absolute;right:20px;top:18px;font-size:8px;font-weight:950;letter-spacing:.15em;color:rgba(169,223,247,.62)}
.select,.input{background:rgba(3,18,27,.82);border-color:rgba(95,171,204,.23)}
.btn{transition:transform .16s ease,filter .16s ease,box-shadow .16s ease}
.btn:active{transform:scale(.985)}
.btn.primary{background:linear-gradient(135deg,#65f1bc,#4bd8ee);box-shadow:0 14px 34px rgba(103,245,191,.13)}
.btn.secondary{border-color:rgba(95,174,219,.46);background:linear-gradient(180deg,rgba(11,38,55,.93),rgba(6,27,41,.94))}
.slatehero{
  border-color:rgba(103,245,191,.26);
  background:radial-gradient(circle at 88% 20%,rgba(103,245,191,.11),transparent 28%),linear-gradient(128deg,rgba(8,43,50,.96),rgba(5,20,31,.97) 64%);
  box-shadow:0 26px 62px rgba(0,0,0,.28),0 0 36px rgba(103,245,191,.045)
}
.slatehero:before{content:"MISSION STATUS";position:absolute;right:18px;top:16px;font-size:8px;letter-spacing:.14em;font-weight:950;color:rgba(177,255,226,.48)}
.slatestat{border-color:rgba(88,162,193,.19);background:rgba(3,18,27,.64)}
.play{
  overflow:hidden;border-color:rgba(96,171,201,.18);
  background:linear-gradient(180deg,rgba(8,31,44,.96),rgba(4,19,29,.97));
  box-shadow:0 18px 42px rgba(0,0,0,.24),0 0 0 1px rgba(255,255,255,.012) inset
}
.play:before{content:"";position:absolute;pointer-events:none;inset:0 auto auto 0;width:100%;height:1px;background:linear-gradient(90deg,transparent,var(--accent),transparent);opacity:.42}
.play:has(.badge.CORE){border-left-color:var(--v81-mint);border-color:rgba(103,245,191,.31);background:radial-gradient(circle at 95% 6%,rgba(103,245,191,.095),transparent 25%),linear-gradient(180deg,rgba(8,39,40,.97),rgba(4,22,29,.98))}
.play:has(.badge.SECONDARY){border-left-color:var(--v81-gold);border-color:rgba(255,214,110,.22);background:radial-gradient(circle at 95% 6%,rgba(255,214,110,.07),transparent 24%),linear-gradient(180deg,rgba(35,31,18,.58),rgba(5,20,29,.97))}
.play:has(.badge.WATCH){border-left-color:var(--v81-blue);border-color:rgba(126,199,255,.21)}
.play:has(.badge.PASS){border-left-color:rgba(255,127,141,.60);opacity:.86}
.badge.CORE{background:rgba(19,84,61,.76);color:#8effd7;border:1px solid rgba(103,245,191,.25)}
.badge.SECONDARY{background:rgba(82,63,18,.65);color:#ffe89b;border:1px solid rgba(255,214,110,.22)}
.badge.WATCH{background:rgba(20,59,86,.72);color:#c0e4ff;border:1px solid rgba(126,199,255,.19)}
.pickline{margin-top:14px;line-height:1.08;text-shadow:0 5px 22px rgba(0,0,0,.22)}
.verdict{border-radius:17px;backdrop-filter:blur(10px)}
.qualityrow{border-color:rgba(92,166,197,.20);background:rgba(3,18,27,.66)}
.qualitynum{text-shadow:0 0 22px rgba(103,245,191,.16)}
.executionbox{border:1px solid rgba(91,165,195,.20)!important;border-radius:18px!important;background:linear-gradient(180deg,rgba(3,18,27,.78),rgba(4,22,31,.72))!important}
.execitem,.metric,.brief{border-color:rgba(85,159,190,.19)!important;background:rgba(3,17,26,.68)!important}
.metric strong,.execitem strong{font-variant-numeric:tabular-nums}
.gamecard{
  border-color:rgba(91,165,196,.18);
  background:radial-gradient(circle at 100% 0,rgba(80,220,255,.045),transparent 24%),linear-gradient(180deg,rgba(8,31,45,.94),rgba(4,19,29,.97))
}
.marketmini{background:rgba(2,15,23,.74);border-color:rgba(82,152,182,.17)}
@keyframes v81Pulse{0%,100%{transform:scale(1);box-shadow:0 0 12px var(--accent)}50%{transform:scale(1.22);box-shadow:0 0 23px var(--accent)}}
@keyframes v81Radar{to{transform:rotate(360deg)}}
@media(max-width:760px){
  .wrap{padding:10px 12px 84px}
  .hero{padding:24px 20px 22px;border-radius:26px}
  .hero:before{right:-18px;top:33%;width:112px;height:128px;font-size:54px;opacity:.52}
  .hero:after{right:-52px;top:34%;width:180px;height:180px;opacity:.55}
  .hero h1{max-width:82%}
  .panel{border-radius:22px;padding:18px}
  .autopilotPanel:before,.mission:before,.slatehero:before{display:none}
  .play{border-radius:22px;padding:17px}
  .metricgrid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .briefgrid{grid-template-columns:1fr}
  .pickline{font-size:clamp(27px,7.4vw,35px)}
}
@media(max-width:480px){
  .hero h1{max-width:90%}
  .statusline{width:100%}
  .qualityrow{grid-template-columns:62px 1fr auto}
}
@media(prefers-reduced-motion:reduce){
  .statusline:not(.bad) .dot,.autopilotPanel:after{animation:none!important}
  .page,.btn,.navbtn{transition:none!important;animation:none!important}
}
"""

VISUAL.write_text(css)

s = INDEX.read_text()
link = '<link rel="stylesheet" href="/visual-v8_1.css?v=8.1.0">'

if link not in s:
    anchor = '<link rel="stylesheet" href="/styles.css?v=8.0.0">'
    if anchor not in s:
        raise SystemExit("Base stylesheet link was not found in public/index.html.")
    s = s.replace(anchor, anchor + "\n" + link, 1)

INDEX.write_text(s)
print("AEGIS v8.1 Visual Command Center overrides prepared.")
