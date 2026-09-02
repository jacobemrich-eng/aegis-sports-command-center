from pathlib import Path

INDEX = Path("public/index.html")
VISUAL = Path("public/visual-v8_1.css")

css = r"""
/* SB101 AEGIS v8.1 — VISUAL COMMAND CENTER */

:root{
  --v81-mint:#67f5bf;
  --v81-cyan:#50dcff;
  --v81-gold:#ffd66e;
  --v81-red:#ff7f8d;
  --v81-blue:#7ec7ff;
}

body{
  background:
    radial-gradient(circle at 50% -8%,rgba(80,220,255,.09),transparent 32%),
    radial-gradient(circle at 88% 12%,rgba(103,245,191,.075),transparent 24%),
    linear-gradient(180deg,#04111a 0%,#030b12 52%,#02070c 100%);
}

body:before{
  background:
    radial-gradient(circle at 14% -6%,rgba(80,220,255,.18),transparent 28%),
    radial-gradient(circle at 87% 4%,rgba(103,245,191,.14),transparent 28%),
    linear-gradient(180deg,#061722 0,#040f17 52%,#02080d 100%);
}

.wrap{
  max-width:1200px;
}

/* HERO */
.hero{
  isolation:isolate;
  overflow:hidden;
  margin-top:4px;
  padding:30px 30px 27px;
  border:1px solid rgba(103,245,191,.16);
  border-radius:30px;
  background:
    linear-gradient(
      112deg,
      rgba(11,36,48,.96),
      rgba(5,18,28,.91) 58%,
      rgba(5,29,27,.82)
    );
  box-shadow:
    0 28px 70px rgba(0,0,0,.31),
    0 0 0 1px rgba(255,255,255,.018) inset;
}

.hero:before{
  content:"A";
  position:absolute;
  right:5%;
  top:50%;
  z-index:-1;
  transform:translateY(-50%);
  width:156px;
  height:178px;
  display:grid;
  place-items:center;
  clip-path:polygon(
    50% 0,
    90% 15%,
    84% 68%,
    50% 100%,
    16% 68%,
    10% 15%
  );
  color:rgba(202,255,235,.34);
  font-size:76px;
  font-weight:1000;
  background:
    linear-gradient(
      145deg,
      rgba(103,245,191,.16),
      rgba(80,220,255,.035)
    ),
    rgba(5,21,29,.68);
}

.hero:after{
  content:"";
  position:absolute;
  right:2%;
  top:50%;
  z-index:-2;
  transform:translateY(-50%);
  width:220px;
  height:220px;
  border:1px solid rgba(80,220,255,.10);
  border-radius:50%;
  box-shadow:
    0 0 0 28px rgba(80,220,255,.018),
    0 0 0 58px rgba(103,245,191,.012);
}

.hero h1{
  max-width:720px;
  text-shadow:0 8px 32px rgba(0,0,0,.30);
}

.eyebrow{
  color:var(--v81-mint);
  text-shadow:0 0 22px rgba(103,245,191,.24);
}

.versionpill{
  border-color:rgba(103,245,191,.28);
  background:rgba(7,41,34,.68);
}

.statusline:not(.bad) .dot{
  animation:v81Pulse 2.2s ease-in-out infinite;
}

/* NAVIGATION */
.navgrid{
  padding:6px;
  border:1px solid rgba(101,175,206,.12);
  border-radius:21px;
  background:rgba(5,19,29,.62);
  backdrop-filter:blur(18px);
}

.navbtn{
  border-color:transparent;
  border-radius:16px;
  background:rgba(7,28,41,.56);
}

.navbtn.active{
  border-color:rgba(103,245,191,.55);
  background:
    linear-gradient(
      180deg,
      rgba(14,52,54,.94),
      rgba(7,31,41,.94)
    );
  box-shadow:
    0 10px 26px rgba(0,0,0,.22),
    0 0 28px rgba(103,245,191,.07);
}

/* PANELS */
.panel{
  border-color:rgba(102,175,207,.18);
  background:
    linear-gradient(
      180deg,
      rgba(10,31,45,.91),
      rgba(5,20,30,.94)
    );
  box-shadow:
    0 22px 55px rgba(0,0,0,.24),
    0 0 0 1px rgba(255,255,255,.016) inset;
  backdrop-filter:blur(14px);
}

/* AUTOPILOT */
.autopilotPanel{
  position:relative;
  overflow:hidden;
  border-color:rgba(103,245,191,.26);
  background:
    radial-gradient(
      circle at 90% 28%,
      rgba(103,245,191,.08),
      transparent 27%
    ),
    linear-gradient(
      135deg,
      rgba(8,40,47,.95),
      rgba(5,24,36,.96)
    );
}

.autopilotPanel:after{
  content:"";
  position:absolute;
  width:190px;
  height:190px;
  right:-60px;
  bottom:-65px;
  border-radius:50%;
  border:1px solid rgba(80,220,255,.10);
  background:
    repeating-radial-gradient(
      circle,
      rgba(80,220,255,.08) 0 1px,
      transparent 1px 28px
    );
  pointer-events:none;
}

/* MISSION */
.mission{
  border-color:rgba(80,220,255,.18);
  background:
    radial-gradient(
      circle at 92% 82%,
      rgba(80,220,255,.09),
      transparent 26%
    ),
    linear-gradient(
      145deg,
      rgba(8,31,44,.95),
      rgba(5,19,29,.96)
    );
}

.select,
.input{
  background:rgba(3,18,27,.82);
  border-color:rgba(95,171,204,.23);
}

.btn{
  transition:
    transform .16s ease,
    box-shadow .16s ease;
}

.btn:active{
  transform:scale(.985);
}

.btn.primary{
  background:
    linear-gradient(
      135deg,
      #65f1bc,
      #4bd8ee
    );
  box-shadow:
    0 14px 34px rgba(103,245,191,.13);
}

/* FINAL CARD */
.slatehero{
  border-color:rgba(103,245,191,.26);
  background:
    radial-gradient(
      circle at 88% 20%,
      rgba(103,245,191,.11),
      transparent 28%
    ),
    linear-gradient(
      128deg,
      rgba(8,43,50,.96),
      rgba(5,20,31,.97) 64%
    );
  box-shadow:
    0 26px 62px rgba(0,0,0,.28),
    0 0 36px rgba(103,245,191,.045);
}

.slatestat{
  border-color:rgba(88,162,193,.19);
  background:rgba(3,18,27,.64);
}

/* PLAY CARDS */
.play{
  overflow:hidden;
  border-color:rgba(96,171,201,.18);
  background:
    linear-gradient(
      180deg,
      rgba(8,31,44,.96),
      rgba(4,19,29,.97)
    );
  box-shadow:
    0 18px 42px rgba(0,0,0,.24);
}

.play:before{
  content:"";
  position:absolute;
  left:0;
  top:0;
  width:100%;
  height:1px;
  background:
    linear-gradient(
      90deg,
      transparent,
      var(--accent),
      transparent
    );
  opacity:.42;
}

.play:has(.badge.CORE){
  border-color:rgba(103,245,191,.31);
  background:
    radial-gradient(
      circle at 95% 6%,
      rgba(103,245,191,.095),
      transparent 25%
    ),
    linear-gradient(
      180deg,
      rgba(8,39,40,.97),
      rgba(4,22,29,.98)
    );
}

.play:has(.badge.SECONDARY){
  border-color:rgba(255,214,110,.25);
  background:
    radial-gradient(
      circle at 95% 6%,
      rgba(255,214,110,.07),
      transparent 24%
    ),
    linear-gradient(
      180deg,
      rgba(35,31,18,.58),
      rgba(5,20,29,.97)
    );
}

.play:has(.badge.WATCH){
  border-color:rgba(126,199,255,.24);
}

.badge.CORE{
  background:rgba(19,84,61,.76);
  color:#8effd7;
  border:1px solid rgba(103,245,191,.25);
}

.badge.SECONDARY{
  background:rgba(82,63,18,.65);
  color:#ffe89b;
  border:1px solid rgba(255,214,110,.22);
}

.badge.WATCH{
  background:rgba(20,59,86,.72);
  color:#c0e4ff;
  border:1px solid rgba(126,199,255,.19);
}

.pickline{
  margin-top:14px;
  line-height:1.08;
  text-shadow:0 5px 22px rgba(0,0,0,.22);
}

.qualityrow{
  border-color:rgba(92,166,197,.20);
  background:rgba(3,18,27,.66);
}

.executionbox{
  border:1px solid rgba(91,165,195,.20)!important;
  border-radius:18px!important;
  background:
    linear-gradient(
      180deg,
      rgba(3,18,27,.78),
      rgba(4,22,31,.72)
    )!important;
}

.execitem,
.metric,
.brief{
  border-color:rgba(85,159,190,.19)!important;
  background:rgba(3,17,26,.68)!important;
}

/* BOARD */
.gamecard{
  border-color:rgba(91,165,196,.18);
  background:
    radial-gradient(
      circle at 100% 0,
      rgba(80,220,255,.045),
      transparent 24%
    ),
    linear-gradient(
      180deg,
      rgba(8,31,45,.94),
      rgba(4,19,29,.97)
    );
}

/* ANIMATION */
@keyframes v81Pulse{
  0%,100%{
    transform:scale(1);
    box-shadow:0 0 12px var(--accent);
  }
  50%{
    transform:scale(1.22);
    box-shadow:0 0 23px var(--accent);
  }
}

/* MOBILE */
@media(max-width:760px){
  .wrap{
    padding:10px 12px 84px;
  }

  .hero{
    padding:24px 20px 22px;
    border-radius:26px;
  }

  .hero:before{
    right:-18px;
    top:33%;
    width:112px;
    height:128px;
    font-size:54px;
    opacity:.52;
  }

  .hero:after{
    right:-52px;
    top:34%;
    width:180px;
    height:180px;
    opacity:.55;
  }

  .hero h1{
    max-width:82%;
  }

  .panel{
    border-radius:22px;
    padding:18px;
  }

  .play{
    border-radius:22px;
    padding:17px;
  }

  .metricgrid{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }

  .briefgrid{
    grid-template-columns:1fr;
  }

  .pickline{
    font-size:clamp(27px,7.4vw,35px);
  }
}

@media(prefers-reduced-motion:reduce){
  .statusline:not(.bad) .dot{
    animation:none!important;
  }
}
"""

VISUAL.write_text(css)

html = INDEX.read_text()

visual_link = (
    '<link rel="stylesheet" '
    'href="/visual-v8_1.css?v=8.1.0">'
)

base_link = (
    '<link rel="stylesheet" '
    'href="/styles.css?v=8.0.0">'
)

if visual_link not in html:
    if base_link not in html:
        raise SystemExit(
            "Base stylesheet link not found."
        )

    html = html.replace(
        base_link,
        base_link + "\n" + visual_link,
        1
    )

INDEX.write_text(html)

print(
    "AEGIS v8.1 Visual Command Center prepared."
)
