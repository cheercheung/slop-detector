# Staged screenshot feed

Run `npm run demo`, then open http://127.0.0.1:4173 in Chrome.

Choose X or LinkedIn, select Stamp / Fade out / Hide, and use Settings to change
the real popup controls. Click Capture view to hide the studio toolbar; press
Escape to restore it (including while focused inside either preview iframe).
The canvas is 1280 × 800 and scales down to fit smaller windows. Keep browser
zoom at 100% and use a window at least 1280px wide for a full-size capture.

The fictional feed runs the production content script, stamp, font and popup
code against a local, in-memory Chrome messaging stand-in. Scores are preset
examples, not live detection results; the canvas always identifies demo content.
No provider calls, API keys, real profiles or extension storage are used.
Nothing is added to the production extension build or upload ZIP.

The server binds only to 127.0.0.1, serves only the generated `.demo` directory,
and blocks network API requests with Content Security Policy. Stop with Ctrl+C.
