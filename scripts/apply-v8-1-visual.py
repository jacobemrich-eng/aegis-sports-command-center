from pathlib import Path

JS = Path("public/app-v8_6.js")
INDEX = Path("public/index.html")

if not JS.exists():
    raise SystemExit("public/app-v8_6.js not found; refusing patch.")

src = JS.read_text(encoding="utf-8")

# Convert display symbols to ASCII-safe JavaScript escape sequences.
# This changes rendering only; release-readiness logic is untouched.
replacements = {
    "Ã¢â‚¬Â¢": r"\u2022",
    "Ã¢â€°Â¥": r"\u2265",
    "Ã¢â€°Â¤": r"\u2264",
    "Ãƒâ€”": r"\u00d7",
    "Ã¢Å“â€œ": r"\u2713",
    "Ã¢â€ â€™": r"\u2192",
    "Ã¢â€ â€œ": r"\u2193",
    "Ã¢â‚¬â€": r"\u2014",
    "Ã¢â‚¬â€œ": r"\u2013",
    "Ã¢â‚¬Â¦": r"\u2026",
    "â€¢": r"\u2022",
    "â‰¥": r"\u2265",
    "â‰¤": r"\u2264",
    "Ã—": r"\u00d7",
    "âœ“": r"\u2713",
    "â†’": r"\u2192",
    "â†“": r"\u2193",
    "â€”": r"\u2014",
    "â€“": r"\u2013",
    "â€¦": r"\u2026",
}

for old, new in replacements.items():
    src = src.replace(old, new)

JS.write_text(src, encoding="utf-8", newline="\n")

if INDEX.exists():
    page = INDEX.read_text(encoding="utf-8")
    page = page.replace(
        '<span class="versionpill">v8.6 â€¢ RELEASE READINESS</span>',
        '<span class="versionpill">v8.6.1 // RELEASE READINESS</span>'
    )
    page = page.replace(
        '<span class="versionpill">v8.6 \\u2022 RELEASE READINESS</span>',
        '<span class="versionpill">v8.6.1 // RELEASE READINESS</span>'
    )
    INDEX.write_text(page, encoding="utf-8", newline="\n")

print("AEGIS v8.6.1 encoding cleanup applied. Logic unchanged.")
