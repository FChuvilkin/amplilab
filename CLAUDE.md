# CLAUDE.md

## What this is
AmpliLab: an Amplitude Implementation Lab. The same simple page, wired to Amplitude in different ways ("variants"), each sending to its own Amplitude project. Purpose: test, compare and debug Amplitude implementations (Analytics, Session Replay, Web Experiment, Feature Experiment, Guides & Surveys). Not a real product. Public on GitHub, hosted on GitHub Pages.

## Layout
- `index.html` — landing page. Deliberately NO tracking of any kind. Renders one card per variant from `registry.js`.
- `registry.js` — the single list of variants: slug, title, method, products, build, apiKey, status (`live` | `planned`). Adding a variant = one entry here + one folder.
- `shared/` — the page itself, identical for every variant. `lab-early.js` (run_id + network tap on `*.amplitude.com`; load FIRST in `<head>`), `lab.js` (renders the whole page into `<body>`, runs the log, self-checks and expected-events table; the adapter contract is documented at its top), `lab.css`, `lab-sample.csv` (download-autocapture target).
- `<slug>/` — one folder per variant, e.g. `unified-sdk/`. Contains `index.html` and `page-2.html` whose `<head>` holds ONLY that variant's Amplitude wiring plus the lab scripts (marked `data-lab`), and an `adapter.js` that defines `window.LabAdapter` (maps the lab's actions onto the SDK and puts `run_id` on every event). Variants that need npm have `package.json`, `src/`, and a committed `dist/` bundle.
- Page copy, buttons, element ids, event names and properties live only in `shared/lab.js`. Never put page content in a variant folder.
- `HANDOVER.md` — current state, decisions and next steps. Keep it updated when finishing a piece of work.

## Rules
- Plain HTML, CSS and vanilla JS. No frameworks. A build step is allowed ONLY when Amplitude ships a product npm-only (e.g. `@amplitude/unified`); then use esbuild, commit `dist/`, and document the rebuild command in the folder.
- Each variant sends to its own Amplitude project; never reuse an API key across variants. Browser API keys are public by design and are committed.
- Every variant must stay visually and functionally identical to the others (same copy, same buttons, same event names and properties), so that only the Amplitude wiring differs.
- Every interactive element gets a stable `id` so Web Experiment's visual editor can target it.
- Each variant page shows its own SDK state (device_id, session_id, replay status, experiment status) and an on-page log of what it tracked. These are debugging pages; make the wiring visible, not hidden.
- Do not add tests, linters or CI unless explicitly asked.

## Run locally
`python3 -m http.server 8000` from the repo root, then open `http://localhost:8000/`. Use the server, not `file://` (SDK cookies/storage).

## Hosting
GitHub Pages from the `master` branch root. Variant URLs are `https://<user>.github.io/<repo>/<slug>/`.
