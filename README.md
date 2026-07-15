# এসো উর্দু শিখি — flat single-file build

This version exists specifically to fix the GitHub upload problem: **only
3 files, no folders at all.**

```
index.html     ← everything: HTML + CSS + JS + all 30 vocabulary
                 entries + the app icon, all inlined in one file
manifest.json   ← PWA manifest, icons embedded as base64 (no icon files needed)
sw.js            ← service worker (offline caching)
```

## Upload these 3 files directly into your repo root

No subfolders, so drag-and-drop can't flatten or lose anything. In GitHub:
**Add file → Upload files** → drag in `index.html`, `manifest.json`, `sw.js`
→ Commit. That's it — nothing else to place anywhere.

If you already have the old `css/`, `js/`, `data/`, `icons/` folders sitting
in your repo from the previous attempt, delete them — they're not used by
this version and there's no reason to keep dead files around.

## Editing vocabulary from now on

The word list lives inside `index.html` itself, as a JS constant near the
top of the big `<script>` block — search the file for:

```
const WORDS_DATA = {"meta":{...}, "words":[...
```

It's minified (one long line) to keep the file compact, but it's still
plain JSON — you can paste that whole line into any JSON formatter to read
or edit it comfortably, then paste the (re-minified or not, either works)
result back in. Or just tell me what you want to add/change and I'll hand
you back an updated `index.html`.

## Everything else is unchanged

Same 5 modes, same streak/library logic, same design. This is a pure
packaging fix, not a feature change — see the earlier README (if you still
have it) for the deeper design notes and PWABuilder/APK steps, which still
apply exactly as before.
