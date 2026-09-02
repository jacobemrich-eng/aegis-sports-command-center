from pathlib import Path

INDEX = Path("public/index.html")
CSS = Path("public/visual-v8_5.css")

CSS.write_text(r'''/* =========================================================
   SB101 AEGIS v8.5 â€” VISUAL INTELLIGENCE & CARD UX
   CSS-only. No observers, timers, DOM rebuilds, or model changes.
   ========================================================= */

:root{
  --v85-core:#67f5bf;
  --v85-secondary:#ffd66e;
  --v85-watch:#79c8ff;
  --v85-cut:#ff7382;
  --v85-soft:#9eb4c0;
  --v85-ink:#020a10;
}

/* ---------- Global visual hierarchy ---------- */
.aegis-v83 .eyebrow{letter-spacing:.19em}
.aegis-v83 .panel h2,.aegis-v83 .v83-intel h2{letter-spacing:-.025em}
.aegis-v83 .subtle{color:#9fb4c0}

/* ---------- Final Card: why / why not ---------- */
.aegis-v83 #v83CardVoice{
  position:relative;
  margin-top:14px;
  padding:29px 15px 13px;
  overflow:hidden;
  background:linear-gradient(180deg,rgba(5,28,40,.96),rgba(2,17,25,.98));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
}
.aegis-v83 #v83CardVoice:before{
  position:absolute;
  top:10px;
  left:14px;
  pointer-events:none;
  font-size:7px;
  font-weight:950;
  letter-spacing:.18em;
  color:#8ba4b2;
}
.aegis-v83 #v83CardVoice.core:before{content:"CORE STATUS";color:var(--v85-core)}
.aegis-v83 #v83CardVoice.secondary:before{content:"WHY NOT CORE?";color:var(--v85-secondary)}
.aegis-v83 #v83CardVoice.watch:before{content:"WHY NOT CORE?";color:var(--v85-watch)}
.aegis-v83 #v83CardVoice.pass:before{content:"WHY NO BET?";color:var(--v85-cut)}
.aegis-v83 #v83CardVoice strong{font-size:11px;letter-spacing:.10em}
.aegis-v83 #v83CardVoice span{margin-top:5px;font-size:10px;line-height:1.45}

/* ---------- Tier-specific Final Card identity ---------- */
.aegis-v83 #card .play{isolation:isolate}
.aegis-v83 #card .play:after{
  content:"";
  position:absolute;
  z-index:-1;
  pointer-events:none;
  inset:0;
  border-radius:inherit;
  opacity:.55;
  background:linear-gradient(135deg,rgba(255,255,255,.012),transparent 45%);
}
.aegis-v83 #card .play:has(.badge.CORE),
.aegis-v83 #card .play:has(.badge.core){
  border-left-color:var(--v85-core);
  box-shadow:0 18px 48px rgba(0,0,0,.22),0 0 24px rgba(103,245,191,.045);
}
.aegis-v83 #card .play:has(.badge.SECONDARY),
.aegis-v83 #card .play:has(.badge.secondary){
  border-left-color:var(--v85-secondary);
  box-shadow:0 18px 48px rgba(0,0,0,.22),0 0 24px rgba(255,214,110,.04);
}
.aegis-v83 #card .play:has(.badge.WATCH),
.aegis-v83 #card .play:has(.badge.watch){border-left-color:var(--v85-watch)}
.aegis-v83 #card .play:has(.badge.PASS),
.aegis-v83 #card .play:has(.badge.pass){border-left-color:var(--v85-cut)}

/* ---------- Execution / freshness ---------- */
.aegis-v83 .freshness{
  border-width:1px;
  font-weight:950;
  letter-spacing:.09em;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
}
.aegis-v83 .freshness.A{
  color:#9affd9;
  border-color:rgba(103,245,191,.42);
  background:rgba(8,58,42,.58);
  box-shadow:0 0 16px rgba(103,245,191,.08);
}
.aegis-v83 .freshness.B{
  color:#ffe394;
  border-color:rgba(255,214,110,.38);
  background:rgba(57,42,9,.55);
}
.aegis-v83 .freshness.C{
  color:#ffb2bb;
  border-color:rgba(255,115,130,.38);
  background:rgba(62,20,28,.58);
}
.aegis-v83 .executionbox{
  background:
    radial-gradient(circle at 0 0,rgba(82,223,255,.035),transparent 28%),
    linear-gradient(180deg,rgba(4,22,33,.96),rgba(2,15,23,.98));
}
.aegis-v83 .execitem strong{font-variant-numeric:tabular-nums}

/* ---------- Game Lab: edge and decision path ---------- */
.aegis-v83 .v83-metrics .v83-metric:nth-child(3){
  border-color:color-mix(in srgb,var(--v83-accent) 34%,rgba(94,166,196,.18));
  background:
    radial-gradient(circle at 90% 0,color-mix(in srgb,var(--v83-accent) 8%,transparent),transparent 50%),
    rgba(2,15,23,.72);
}
.aegis-v83 .v83-metrics .v83-metric:nth-child(3) b{color:var(--v83-accent)}
.aegis-v83 .v83-track{
  height:8px;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.45);
}
.aegis-v83 .v83-step{
  min-height:48px;
  display:flex;
  flex-direction:column;
  justify-content:center;
}
.aegis-v83 .v83-step:not(.fail):not(.hold){
  border-color:color-mix(in srgb,var(--v83-accent) 25%,rgba(96,168,198,.18));
}
.aegis-v83 .v83-step:not(.fail):not(.hold) b{
  text-shadow:0 0 12px color-mix(in srgb,var(--v83-accent) 23%,transparent);
}
.aegis-v83 .v83-step.hold{
  background:linear-gradient(180deg,rgba(13,39,56,.82),rgba(3,19,29,.92));
}
.aegis-v83 .v83-step.fail{
  background:linear-gradient(180deg,rgba(49,18,25,.62),rgba(20,10,15,.84));
}

/* ---------- Game Lab tabs ---------- */
.aegis-v83 .v83-tabs{gap:7px}
.aegis-v83 .v83-tab{position:relative;overflow:hidden}
.aegis-v83 .v83-tab.active:after{
  content:"";
  position:absolute;
  pointer-events:none;
  left:24%;right:24%;bottom:4px;height:2px;
  border-radius:99px;
  background:var(--v83-accent);
  box-shadow:0 0 9px color-mix(in srgb,var(--v83-accent) 45%,transparent);
}

/* ---------- Quick Orders / Final Card summary ---------- */
.aegis-v83 #v82QuickOrders{
  background:
    radial-gradient(circle at 8% 0,rgba(103,245,191,.055),transparent 31%),
    linear-gradient(180deg,rgba(5,30,39,.97),rgba(2,17,24,.99));
}
.aegis-v83 #v82QuickOrders .v82-orderpick{
  box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
}
.aegis-v83 #v82QuickOrders .v82-orderpick strong,
.aegis-v83 #card .pickline{font-variant-numeric:tabular-nums}

/* ---------- Blockers become easier to scan ---------- */
.aegis-v83 #card .blocker{
  position:relative;
  padding-left:17px;
}
.aegis-v83 #card .blocker:before{
  content:"";
  position:absolute;
  left:0;
  top:6px;
  bottom:6px;
  width:3px;
  border-radius:99px;
  background:var(--v85-cut);
  opacity:.75;
  pointer-events:none;
}
.aegis-v83 #card .notice.warning{
  border-color:rgba(255,214,110,.34);
  background:linear-gradient(180deg,rgba(51,38,8,.55),rgba(34,27,8,.48));
}

/* ---------- Numeric readability ---------- */
.aegis-v83 .metricgrid strong,
.aegis-v83 .microgrid strong,
.aegis-v83 .auditcards strong,
.aegis-v83 .v83-metric b,
.aegis-v83 .v83-gauge b{font-variant-numeric:tabular-nums}

/* ---------- Mobile hierarchy ---------- */
@media(max-width:760px){
  .aegis-v83 #v83CardVoice{margin-top:12px;padding:28px 13px 12px}
  .aegis-v83 .v83-verdict{padding:14px 15px}
  .aegis-v83 .v83-verdict strong{font-size:18px}
  .aegis-v83 .v83-expression{padding:15px}
  .aegis-v83 .v83-expression strong{line-height:1.12}
  .aegis-v83 .v83-dna{gap:10px}
  .aegis-v83 .v83-gauge{grid-template-columns:86px 1fr 49px}
  .aegis-v83 #card .play{border-left-width:4px}
  .aegis-v83 #card .blocker{line-height:1.48}
}

@media(prefers-reduced-motion:reduce){
  .aegis-v83 *{transition:none!important;animation:none!important}
}
''')

html = INDEX.read_text()

# Refuse to continue if the known-bad v8.4 JS ever came back.
if "app-v8_4" in html:
    raise SystemExit("Unsafe v8.4 JavaScript detected. Refusing v8.5 install.")

link = '<link rel="stylesheet" href="/visual-v8_5.css?v=8.5.0">'
marker = '<link rel="stylesheet" href="/visual-v8_4_safe.css?v=8.4.0">'

if link not in html:
    if marker not in html:
        raise SystemExit("v8.4 safe visual checkpoint not found; refusing patch.")
    html = html.replace(marker, marker + "\n" + link)

html = html.replace(
    '<span class="versionpill">v8.2 â€¢ IDENTITY & MOBILE COMMAND UI</span>',
    '<span class="versionpill">v8.5 â€¢ VISUAL INTELLIGENCE & CARD UX</span>'
)

INDEX.write_text(html)

print("AEGIS v8.5 installed: CSS-only visual intelligence layer.")
