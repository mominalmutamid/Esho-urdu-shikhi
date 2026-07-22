# এসো উর্দু শিখি — Developer README

## Structure — flat, no subfolders

```
index.html
style.css
app.js
words.json     <- THE FILE YOU'LL REPLACE MOST OFTEN, grows freely
manifest.json
sw.js
```

All 6 files sit side by side at the repo root. No `css/`, `js/`, or
`data/` subfolders — this matters specifically because mobile uploads
(GitHub's web upload on a phone browser) can't preserve folder structure,
only a flat list of files. This structure is built around that constraint.

## Uploading from your phone

**Add file → Upload files** on GitHub, then select all 6 files at once
from your phone's file picker. Since there's no folder nesting to lose,
this works reliably every time.

**For future vocabulary updates**, you only need to replace `words.json`
— none of the other 5 files change for ordinary dictionary growth. Upload
just that one file, same "Add file → Upload files" flow, and it overwrites
the old one.

## Running locally to test

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

`index.html` won't work opened directly via `file://` — `fetch()` of
`words.json` is blocked by browser security on `file://` URLs.

## Extending the vocabulary — `words.json`

Every mode reads from the same `words` array. Per the file's own
`meta.schema_notes`, in short:

- **`id`** — keep stable once shipped; it's the localStorage join key.
- **`urdu`** — must be correctly spelled; Spelling Mode and Sentence Mode
  validate against this exact text.
- **`example_sentence`** — `{urdu, bengali, pron_bn}`. Feeds Study mode,
  Poetic mode, and the "easy" tier of Sentence Formation mode.
- **`is_poetic: true`** — included in Poetic Mode and Word-of-the-Day
  rotation (`word_of_day_sequence`).
- **`type: "proverb"`** — `urdu` field is the full sentence; feeds the
  "hard" tier of Sentence Formation mode directly.

## Service worker behavior

`sw.js` is network-first for every file. Whichever file you update and
re-upload, visitors see the new version on their next load while online —
no cache-version bump needed. Falls back to cache only when fully offline.

## Design & architecture notes

- **Palette**: night indigo / aged parchment / antique gold / pomegranate
  red / emerald — a manuscript aesthetic. Tokens are CSS variables at the
  top of `style.css`.
- **Two Urdu typefaces**: Noto Nastaliq Urdu (display/poetic), Noto Naskh
  Arabic (spelling tiles, study cards — clearer isolated letterforms).
- **Sentence Formation Mode** reuses `example_sentence` (easy tier) and
  proverbs (hard tier) directly — no separate sentence bank to maintain.
- **Streak-free by design**: only "opened today or not" + a permanent
  library catalog are tracked, no consecutive-day counting or display.
