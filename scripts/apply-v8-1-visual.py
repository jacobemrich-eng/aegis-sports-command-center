from pathlib import Path
import json
import re
import subprocess

ROOT = Path(".")
APP82 = ROOT / "public/app-v8_2.js"
APP83 = ROOT / "public/app-v8_3.js"
APP831 = ROOT / "public/app-v8_3_1.js"
APP832 = ROOT / "public/app-v8_3_2.js"
APP86 = ROOT / "public/app-v8_6.js"
INDEX = ROOT / "public/index.html"
PACKAGE = ROOT / "package.json"
WORKFLOW = ROOT / ".github/workflows/apply-v8-1-visual.yml"
STABILITY_TEST = ROOT / "tests/frontend-stability.test.js"

required = [APP82, APP83, APP831, APP832, APP86, INDEX, PACKAGE, WORKFLOW]
missing = [str(p) for p in required if not p.exists()]
if missing:
    raise SystemExit("Missing required file(s): " + ", ".join(missing))

def read(path):
    return path.read_text(encoding="utf-8")

def write(path, text):
    path.write_text(text, encoding="utf-8", newline="\n")

def require_replace(text, old, new, label):
    if old not in text:
        if new in text:
            print(f"{label}: already applied")
            return text
        raise SystemExit(f"{label}: expected source block not found; refusing unsafe patch")
    return text.replace(old, new, 1)

# 1) v8.2 shell: stop rebuilding Quick Orders every two seconds.
s = read(APP82)

if "var uiKeyLast=null;" not in s:
    s = require_replace(
        s,
        '  var tabs = [\n',
        '  var uiKeyLast=null;\n\n  var tabs = [\n',
        "v8.2 state key"
    )

old = '''  function refresh(){
    shell();
    overview();
    quick();
    syncNav();
  }
  function start(){
    refresh();
    window.setInterval(refresh,2000);
    document.documentElement.classList.add("aegis-v82");
  }
'''
new = '''  function uiKey(){
    var c=card(),p=best(c),sportSelect=q("#sport");
    return [
      c&&c.generated_at||"",
      p&&p.event_id||"",
      p&&p.tier||"",
      p&&p.market||"",
      p&&p.selection||"",
      p&&p.point!=null?p.point:"",
      p&&p.price!=null?p.price:"",
      sportSelect&&sportSelect.value||""
    ].join("|");
  }
  function refresh(force){
    shell();
    var key=uiKey();
    if(force||key!==uiKeyLast){
      uiKeyLast=key;
      overview();
      quick();
    }
    syncNav();
  }
  function start(){
    document.documentElement.classList.add("aegis-v82");
    refresh(true);

    var cardContent=q("#cardContent");
    if(cardContent){
      var queued=false;
      var observer=new MutationObserver(function(){
        if(queued)return;
        queued=true;
        queueMicrotask(function(){
          queued=false;
          refresh(false);
        });
      });
      observer.observe(cardContent,{childList:true,subtree:true});
    }

    var sportSelect=q("#sport");
    if(sportSelect)sportSelect.addEventListener("change",function(){refresh(true);});
    qa(".navbtn").forEach(function(b){
      b.addEventListener("click",function(){queueMicrotask(syncNav);});
    });

    window.setInterval(function(){refresh(false);},30000);
  }
'''
s = require_replace(s, old, new, "v8.2 event-driven refresh")
write(APP82, s)

# 2) v8.3 intelligence: slow fallback + no pointless card-voice rewrite.
s = read(APP83)
s = s.replace("setInterval(refresh,1600);", "setInterval(refresh,30000);")

old = '''    voice.className="v83-cardvoice "+cls;
    voice.innerHTML="<strong>"+esc(head)+"</strong><span>"+esc(sub)+"</span>";
'''
new = '''    var voiceKey=tier+"|"+head+"|"+sub;
    if(voice.dataset.v83Key===voiceKey)return;
    voice.dataset.v83Key=voiceKey;
    voice.className="v83-cardvoice "+cls;
    voice.innerHTML="<strong>"+esc(head)+"</strong><span>"+esc(sub)+"</span>";
'''
s = require_replace(s, old, new, "v8.3 stable card voice")
write(APP83, s)

# 3) v8.3.1 compatibility polish: targeted observers only.
s = read(APP831)
old = '''    observer.observe(document.body,{
      childList:true,
      subtree:true,
      characterData:true
    });
'''
new = '''    [q("#lab"),q("#card")].filter(Boolean).forEach(function(root){
      observer.observe(root,{
        childList:true,
        subtree:true
      });
    });
'''
s = require_replace(s, old, new, "v8.3.1 targeted observer")
write(APP831, s)

# 4) v8.3.2: remove the 500 ms polling loop entirely.
app832 = '''(function(){
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
'''
write(APP832, app832)

# 5) Repair mojibake at active JS source.
js_replacements = {
    "Ã¢â¬â": r"\u2014",
    "Ã¢â¬â": r"\u2013",
    "Ã¢â¬Â¢": r"\u2022",
    "Ã¢â â": r"\u2192",
    "Ã¢â â": r"\u2193",
    "Ã¢â°Â¥": r"\u2265",
    "Ã¢â°Â¤": r"\u2264",
    "Ãâ": r"\u00d7",
    "Ã¢Åâ": r"\u2713",
    "ÃÂ°": r"\u00b0",
    "Ã¢â¬Â¦": r"\u2026",
    "Ã¢â¬â¢": r"\u2019",
    "Ã¢â¬Å": r"\u201c",
    "Ã¢â¬Â": r"\u201d",
}
for path in (APP83, APP86):
    s = read(path)
    for bad, safe in js_replacements.items():
        s = s.replace(bad, safe)
    write(path, s)

# 6) HTML: UTF-8, v8.7 label, fresh cache-busters.
page = read(INDEX)
if not re.search(r'<meta\s+charset=', page, flags=re.I):
    page = page.replace("<head>", '<head>\n<meta charset="utf-8">', 1)

page = re.sub(
    r'<span class="versionpill">.*?</span>',
    '<span class="versionpill">v8.7 â¢ STABILITY & INTEGRITY</span>',
    page,
    count=1,
    flags=re.S,
)

for name in ("app-v8_2.js", "app-v8_3.js", "app-v8_3_1.js", "app-v8_3_2.js", "app-v8_6.js"):
    page = re.sub(
        rf'/{re.escape(name)}\?v=[^"]+',
        f'/{name}?v=8.7.0',
        page,
        count=1,
    )

html_replacements = {
    "Ã¢â¬Â¢": "â¢",
    "Ã¢â¬â": "â",
    "Ã¢â¬â": "â",
    "Ã¢â â": "â",
    "Ã¢â°Â¥": "â¥",
    "Ãâ": "Ã",
    "Ã¢Åâ": "â",
}
for bad, good in html_replacements.items():
    page = page.replace(bad, good)
write(INDEX, page)

# 7) CI: syntax-check every active browser layer.
pkg = json.loads(read(PACKAGE))
pkg["version"] = "8.7.0"
pkg.setdefault("scripts", {})
pkg["scripts"]["check"] = (
    "node --check server.js"
    " && node --check src/engine.js"
    " && node --check src/store.js"
    " && node --check src/autopilot.js"
    " && node --check public/app.js"
    " && node --check public/app-v8_2.js"
    " && node --check public/app-v8_3.js"
    " && node --check public/app-v8_3_1.js"
    " && node --check public/app-v8_3_2.js"
    " && node --check public/app-v8_4.js"
    " && node --check public/app-v8_6.js"
    " && npm test"
)
write(PACKAGE, json.dumps(pkg, indent=2) + "\n")

# 8) Regression protection for the mobile runtime bugs.
test_src = r'''const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const active = [
  'public/app.js',
  'public/app-v8_2.js',
  'public/app-v8_3.js',
  'public/app-v8_3_1.js',
  'public/app-v8_3_2.js',
  'public/app-v8_6.js'
];

test('all active browser bundles parse', () => {
  for (const rel of active) {
    const js = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotThrow(() => new vm.Script(js), rel);
  }
});

test('overlay bundles do not use aggressive sub-5-second polling', () => {
  for (const rel of active.slice(1)) {
    const js = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(
      js,
      /setInterval\s*\([^,]+,\s*(?:[0-4]?\d{0,3}|4\d{3})\s*\)/,
      rel
    );
  }
});

test('compatibility observers are scoped instead of watching the whole body', () => {
  for (const rel of ['public/app-v8_3_1.js','public/app-v8_3_2.js']) {
    const js = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(js, /observer\.observe\s*\(\s*document\.body/, rel);
  }
});

test('active overlay source contains no common mojibake literals', () => {
  const bad = ['Ã¢â¬â','Ã¢â¬â','Ã¢â¬Â¢','Ã¢â â','Ã¢â â','Ã¢â°Â¥','Ã¢â°Â¤','Ãâ','Ã¢Åâ','ÃÂ°','Ã¢â¬Â¦'];
  for (const rel of ['public/app-v8_3.js','public/app-v8_6.js']) {
    const js = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const token of bad) {
      assert.equal(js.includes(token), false, `${rel} contains ${token}`);
    }
  }
});

test('index declares UTF-8 and v8.7 cache-busted active overlays', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /v8\.7 â¢ STABILITY & INTEGRITY/);
  for (const name of ['app-v8_2.js','app-v8_3.js','app-v8_3_1.js','app-v8_3_2.js','app-v8_6.js']) {
    assert.match(html, new RegExp('/' + name.replace('.', '\\.') + '\\?v=8\\.7\\.0'));
  }
});
'''
write(STABILITY_TEST, test_src)

# 9) Update reusable workflow naming/checks for future runs.
wf = read(WORKFLOW)
wf = wf.replace(
    "name: Apply AEGIS v8.6.1 Encoding Cleanup",
    "name: Apply AEGIS v8.7 Stability Pass"
)
wf = wf.replace(
    "- name: Apply encoding-safe patch",
    "- name: Apply v8.7 stability patch"
)
wf = wf.replace(
    "- name: Syntax check v8.6 readiness\n        run: node --check public/app-v8_6.js",
    "- name: Syntax check active frontend\n        run: npm run check"
)
wf = wf.replace(
    "\n      - name: Run full AEGIS checks\n        run: npm run check\n",
    "\n"
)
write(WORKFLOW, wf)

# Validate before allowing any commit.
for path in (APP82, APP83, APP831, APP832, APP86):
    subprocess.run(["node", "--check", str(path)], check=True)

subprocess.run(["npm", "run", "check"], check=True)

# Pre-stage everything. The currently running workflow's later git-add
# command will not unstage these files.
to_stage = [
    str(APP82), str(APP83), str(APP831), str(APP832), str(APP86),
    str(INDEX), str(PACKAGE), str(STABILITY_TEST), str(WORKFLOW)
]
subprocess.run(["git", "add", *to_stage], check=True)
subprocess.run(["git", "diff", "--cached", "--check"], check=True)

print("AEGIS v8.7 Stability & Integrity patch complete.")
print("Aggressive UI churn removed, observers scoped, encoding repaired,")
print("frontend CI expanded, and all tested changes staged.")
