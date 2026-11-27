# HANDOVER — AmpliLab

Last updated: 2026-11-27. Written by the agent that built the first pieces inside the FT demo-site repo (`FChuvilkin/fedor-test`) and moved them here.

## Goal
An "implementation lab": identical pages, each wired to Amplitude differently, each streaming into its own Amplitude project, published on GitHub Pages so external people can open them. Pages are for debugging: they show exactly how Amplitude is implemented on them, plus live SDK state and a log.

## What exists right now
- `index.html` + `registry.js` — tracking-free landing page with 4 variant cards. Only `unified-sdk` is live; the other 3 are placeholders (`status: 'planned'`, no API key).
- `unified-sdk/` — **working**. npm `@amplitude/unified` 1.2.9 bundled with esbuild into `dist/amplitude-unified.js` (committed, ~812 KB), initialised with `initAll()` (Analytics with autocapture on, Session Replay sampleRate 1, Feature Experiment, Guides & Surveys), plus the separate Web Experiment script tag loaded right after the bundle in `<head>`.
  - API key: `06556c56eb0e04dd109403f006794241` (its own Amplitude project, US zone).
  - Events it sends: `Lab Page Viewed`, `CTA Clicked`, `Plan Selected`, plus autocaptured `[Amplitude] …` events, `$identify`, `session_start`, Guides & Surveys boot event. Library tag: `amplitude-ts-unified/1.2.9-amplitude-ts/2.50.1`.
  - **Live on GitHub Pages** (2026-11-27): https://fchuvilkin.github.io/amplilab/unified-sdk/. Verified from headless Chrome against the live URL with real uploads: `/2/httpapi` answers `200` with `events_ingested` > 0 (incl. `Lab Page Viewed`, `CTA Clicked`, `Plan Selected`); Session Replay uploads to `api-sr.amplitude.com/sessions/v2/track` answer `200`; events carry `[Amplitude] Session Replay ID`. Test device_ids: `6a4ccf09-5f9b-4043-9ac0-2fe6a1bdc916` (custom events), `e4b60412-5dd2-4b6f-b8f6-3e4b758fa2bd` (replay). Fedor confirmed on 2026-11-27 that the events arrive in the Amplitude project.
  - Debugging note: Session Replay uploads from a Web Worker, so page-level request listeners (Puppeteer `page.on('request')`, a fetch wrapper) never see them. Use DevTools or a Chrome net-log (`--log-net-log=…`) to see them. `amplitude.sessionReplay()` is a function that returns the plugin (`flush`, `getSessionReplayProperties`, …).
  - Rebuild after editing `src/main.js`: `cd unified-sdk && npm install && npm run build`.
- `CLAUDE.md` — project rules.
- Repo: https://github.com/FChuvilkin/amplilab (public). GitHub Pages serves `master` root at https://fchuvilkin.github.io/amplilab/. Pages builds on every push to `master`. `/favicon.ico` 404s (harmless).

## Key technical findings (don't re-derive)
- The Unified SDK is npm-only; there is no CDN build. The CDN "Unified Script" (`cdn.amplitude.com/script/<key>.js`) is a different product: it bundles Analytics + Session Replay + **Web** Experiment, while the npm Unified SDK bundles Analytics + Session Replay + **Feature** Experiment + Guides & Surveys. Amplitude does not document running Web Experiment with the npm Unified SDK.
- It works anyway because both share Amplitude's global analytics connector: `globalThis.analyticsConnectorInstances['$default_instance']`. The SDK publishes device/user ID there and receives Web Experiment's `$exposure` events through it. Two requirements: do NOT set `instanceName` in `initAll()` (Web Experiment only looks at `$default_instance`), and load the SDK bundle before the Web Experiment script. `window.amplitude = amplitude` is set in `src/main.js` for console use and for an optional plugin hook; not strictly required.
- Web Experiment needs only the script tag `https://cdn.amplitude.com/script/<API_KEY>.experiment.js`, synchronous, high in `<head>` (avoids flicker). No deployment key, no SDK calls. Experiments are built in Amplitude's visual editor; the page just needs stable element ids.
- Remote config (`https://sr-client-cfg.amplitude.com/config/<key>?config_group=browser`) can override autocapture settings in code. The FT project's config disables all autocapture; the `06556c56…` project's config does not, so autocapture works there.
- Amplitude's cookie is namespaced by API key, so variants on the same domain get separate device IDs. No cross-contamination.
- Amplitude docs do not say whether the Web Experiment visual editor works on `localhost`; untested. Ad blockers / privacy extensions block the editor.
- The FT site (separate repo) uses the standalone-scripts approach (Analytics SDK 2.47.2 + Session Replay plugin + Web Experiment script) with a hand-written `app.js`; useful reference for the `browser-sdk` variant: https://github.com/FChuvilkin/fedor-test (`app.js`, `index.html` head).

## Shared page + adapter (built 2026-11-27)
- Every variant page is rendered by `shared/lab.js`; a variant supplies only its `<head>` wiring and `adapter.js` (`window.LabAdapter = { info, ready, track, identify, setUserId, revenue, reset, flush, ids, status }`; contract at the top of `shared/lab.js`). `revenue` and `status` were added to the originally planned interface: revenue needs SDK-specific calls, and `status()` returns the product-specific state rows (replay, connector, flags, Web Experiment).
- Sections: header strip (variant, products, key, zone, versions, library seen on the wire, source link, variant switcher), hero + plans (Web Experiment targets, stable ids), playground (run_id, user_id, track simple/nested, identify, sign in/out, revenue, flush; autocapture form, outbound link, download link, `page-2.html`), live state + self-checks, two-layer log (intent + decoded wire incl. gzip, export JSON), expected-events table with live counts and "also seen", and "How this page is wired" (`<head>` as served, runtime scripts incl. SDK-injected, init options, source files, live remote config, caveats).
- `run_id`: from `?run=` or the input, kept in localStorage (`amplilab_run_id`). In `unified-sdk` it's attached by an enrichment plugin added in `src/main.js` before `initAll()`, so autocaptured events get it too. `src/main.js` now also exposes `window.amplitudeReady` (the `initAll()` promise) and `window.amplitudeInitOptions`.
- Event names changed from the first version: `Lab Page Viewed` now has `page: 'home' | 'second'` (was `unified_lab`); new lab events `Lab Simple Event`, `Lab Nested Event`, `Signed In`, `Signed Out`, `Signup Form Submitted`, `revenue_amount`, `$identify`.
- Verified locally in headless Chrome: all self-checks green, every lab event counted on the wire, run_id on every event, device/session carry to page 2, sign out resets device_id. Session Replay uploads are invisible to the tap (Web Worker), noted on the page.
- To add a variant: copy `unified-sdk/index.html` + `page-2.html`, replace the block between the "Amplitude wiring" comments, write `adapter.js`, add the registry entry.

## Next steps, in order
1. **Finish verifying the publish** in the Amplitude UI: check that a replay plays; create a Web Experiment targeting `https://fchuvilkin.github.io/amplilab/unified-sdk/` (e.g. edit `#hero-title`) and confirm `$exposure` arrives (the expected-events table counts it).
2. **Remaining variants**, each needing its own project API key from Fedor: `browser-sdk` (separate CDN scripts; mirror FT), `unified-script` (one `<key>.js` tag), `http-api` (fetch to `/2/httpapi`, hand-managed device/session IDs, standalone Session Replay SDK with `[Amplitude] Session Replay ID` on every event — verify whether the standalone SR SDK has a CDN build). Later candidates: GTM, Segment, server-side relay.

## Open questions for Fedor
- API keys / project names for `browser-sdk`, `unified-script`, `http-api`.
- Whether to add a root `build.sh` that rebuilds every npm-based variant.
