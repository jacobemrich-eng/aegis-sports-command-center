from pathlib import Path
import re

JS = Path("public/app-v8_6.js")
INDEX = Path("public/index.html")

if not JS.exists():
    raise SystemExit("public/app-v8_6.js not found.")
if not INDEX.exists():
    raise SystemExit("public/index.html not found.")

src = JS.read_text(encoding="utf-8")

symbols = [
    ("\u2022", r"\u2022"),
    ("\u2265", r"\u2265"),
    ("\u2264", r"\u2264"),
    ("\u00d7", r"\u00d7"),
    ("\u2713", r"\u2713"),
    ("\u2192", r"\u2192"),
    ("\u2193", r"\u2193"),
    ("\u2014", r"\u2014"),
    ("\u2013", r"\u2013"),
    ("\u2026", r"\u2026"),
]

def mojibake_once(text):
    try:
        return text.encode("utf-8").decode("cp1252")
    except UnicodeDecodeError:
        return text

for char, escaped in symbols:
    bad1 = mojibake_once(char)
    bad2 = mojibake_once(bad1)
    bad3 = mojibake_once(bad2)
    for bad in (bad3, bad2, bad1, char):
        if bad and bad != escaped:
            src = src.replace(bad, escaped)

JS.write_text(src, encoding="utf-8", newline="\n")

page = INDEX.read_text(encoding="utf-8")

if not re.search(r'<meta\s+charset=', page, flags=re.I):
    page = page.replace("<head>", '<head>\n<meta charset="utf-8">', 1)

page = re.sub(
    r'<span class="versionpill">v8\.6.*?RELEASE READINESS</span>',
    '<span class="versionpill">v8.6.1 // RELEASE READINESS</span>',
    page,
    count=1,
    flags=re.S
)

page = re.sub(
    r'/app-v8_6\.js\?v=[^"]+',
    '/app-v8_6.js?v=8.6.1',
    page
)

INDEX.write_text(page, encoding="utf-8", newline="\n")

fixed = JS.read_text(encoding="utf-8")
if r"\u2022" not in fixed or r"\u2265" not in fixed:
    raise SystemExit("Safe Unicode escapes were not installed.")

html_text = INDEX.read_text(encoding="utf-8")
if '<meta charset="utf-8">' not in html_text:
    raise SystemExit("UTF-8 meta tag missing.")
if '/app-v8_6.js?v=8.6.1' not in html_text:
    raise SystemExit("v8.6.1 cache-buster missing.")

print("AEGIS v8.6.1 hard encoding repair complete.")
