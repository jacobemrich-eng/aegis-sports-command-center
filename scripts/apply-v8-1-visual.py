from pathlib import Path
import re

INDEX = Path("public/index.html")

text = INDEX.read_text()

# Remove every v8.4 stylesheet/script reference, regardless of cache version.
text = re.sub(
    r'\s*<link[^>]+href="/visual-v8_4\.css\?v=[^"]+"[^>]*>\s*',
    '\n',
    text
)

text = re.sub(
    r'\s*<script[^>]+src="/app-v8_4\.js\?v=[^"]+"[^>]*></script>\s*',
    '\n',
    text
)

# Put the visible identity back on the last known-good UI layer.
text = re.sub(
    r'v8\.[0-9.]+\s*â€¢\s*[^<]*',
    'v8.3.2 â€¢ STABLE GAME INTELLIGENCE UI',
    text,
    count=1
)

INDEX.write_text(text)

print("AEGIS emergency rollback complete: v8.4 removed from index.html.")
