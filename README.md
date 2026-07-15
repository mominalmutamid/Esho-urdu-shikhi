# এসো উর্দু শিখি — Developer README

A lightweight PWA for practicing Urdu spelling, meaning, and poetic vocabulary,
built for GitHub Pages with zero build tooling.

## Folder structure

```
esho-urdu-shikhi/
├── index.html          # app shell — all 6 screens live here as <section> views
├── manifest.json        # PWA manifest (name, icons, colors)
├── sw.js                 # service worker — offline cache-first for the shell,
│                          # network-first for data/words.json
├── css/
│   └── style.css         # full design system (see "Design notes" below)
├── js/
│   └── app.js             # all app logic — no dependencies, plain ES2017+
├── data/
│   └── words.json          # the entire vocabulary bank — edit this to add words
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

Every internal reference (CSS, JS, JSON, icons, the service worker) uses a
**relative path** (`./css/style.css`, not `/css/style.css`). This matters
because a GitHub Pages project site serves from
`https://<username>.github.io/<repo-name>/`, not from the domain root — an
absolute path would 404 there. Keep this in mind if you add new files.

## Running it locally to test

Opening `index.html` by double-clicking it (a `file://` URL) will **not**
work — browsers block `fetch()` of local JSON files from `file://` for
security reasons, so `data/words.json` will fail to load. Serve it instead:

```bash
cd esho-urdu-shikhi
python3 -m http.server 8000
# then open http://localhost:8000/
```

Any static server works the same way (VS Code's "Live Server" extension,
`npx serve`, etc).

## Deploying to GitHub Pages

1. Create a new repo (or a folder in an existing one), and push the
   contents of `esho-urdu-shikhi/` to it — the *contents*, not the folder
   itself, should sit at the repo root (or in `/docs` if you prefer that
   Pages source option).
2. In the repo's Settings → Pages, set the source to the branch/folder you
   pushed to.
3. Visit the resulting `https://<username>.github.io/<repo-name>/` URL.
   The service worker will register on first load and the app will work
   fully offline from the second visit onward.

## Generating an APK (PWABuilder)

Same flow you've used before: once the GitHub Pages URL is live, feed it to
[pwabuilder.com](https://www.pwabuilder.com). It will read `manifest.json`
directly, confirm the service worker, and let you package an Android APK.
The maskable icon (`icon-maskable-512.png`) is included specifically so the
Android adaptive-icon mask doesn't clip the emblem.

## Extending the vocabulary — `data/words.json`

This is the only file you need to touch to grow the app. Every mode reads
from the same `words` array — there's no per-mode data duplication. The
file's own `meta.schema_notes` block documents each field, but in short:

- **`id`** — keep stable once shipped; it's the join key for the library
  and streak history stored in the user's `localStorage`.
- **`urdu`** — must be the correct spelling. This is the string the
  Spelling Mode validates tile order against, letter by letter (via
  `Array.from(word.urdu)`, so it splits cleanly on real Urdu code points
  including retroflex/aspirated letters like `ٹ`, `ڑ`, `کھ`).
- **`is_poetic: true`** — pulls the word into both Poetic Mode and the
  Word-of-the-Day rotation (`word_of_day_sequence`). Add new poetic
  words/proverbs to that sequence array to extend the daily rotation;
  it cycles once exhausted, so keep growing it over time to avoid repeats.
- **`scene` / `scene_position`** — only needed if you want the word
  clickable in Visual Vocabulary Mode. `scene` must match a key in the
  `scenes` object at the bottom of the file. Positions are percentages
  (`x`, `y`) of the scene's width/height — eyeball them against the SVG
  scenes in `app.js` (`sceneSvg()`), or add a brand-new scene by adding
  both an SVG template there and a matching entry in `scenes`.

No app code changes are needed for ordinary vocabulary growth — only for a
genuinely new scene illustration or a new game mode.

## Design notes

- **Palette & type** are deliberately not the generic "AI app" look. The
  direction is an illuminated manuscript / ghazal-diwan page: night indigo,
  aged parchment, antique gold leaf, pomegranate red, emerald — pulled from
  Mughal-era manuscript and Urdu literary tradition rather than a generic
  SaaS palette. Tokens are all named CSS variables at the top of
  `style.css` if you want to adjust them.
- **Two Urdu typefaces are used deliberately**: Noto Nastaliq Urdu for
  display/poetic contexts (authentic calligraphic register), and Noto
  Naskh Arabic for the spelling tiles and study cards, where individual
  letterforms need to stay visually distinct rather than flow together.
- **The Word-of-the-Day "seal"** is the one intentionally showy animation
  in the app (crack open → reveal), tied directly to the manuscript
  metaphor — a sealed folio opening. Everything else is kept quiet on
  purpose. `prefers-reduced-motion` is respected throughout.
- **Streak/unlock logic** lives in `app.js` under `unlockToday()` /
  `currentDayIndex()`. Day 0 is the install date; the day index is computed
  from local-midnight boundaries (not UTC), so the daily unlock aligns with
  the user's actual calendar day in Bangladesh.

## Known limitations / natural next steps

- Urdu text-to-speech quality depends entirely on the device's installed
  voices — most Android phones don't ship an `ur-PK` voice, so the app
  falls back to the closest Arabic voice and tells the user so via a toast.
  A bundled audio-file approach would be more reliable but heavier; left
  as external JSON + TTS for now per the "no bloat" brief.
- The vocabulary bank ships with 30 entries (27 words + 3 proverbs) as a
  working sample across all five modes — enough to test every mechanic
  end-to-end, but you'll want to grow `words.json` substantially for daily
  real use, the same way you expanded Esho Arabi Shikhi's vocabulary.
- Visual Vocabulary Mode ships with two hand-drawn SVG scenes (room, night
  sky). Adding a third scene is a matter of one more `sceneSvg()` case plus
  a `scenes` entry — no other code changes needed.
