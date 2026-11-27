# HANDOVER — AmpliLab

Last updated: 2026-11-27. Written by the agent that built the first pieces inside the FT demo-site repo (`FChuvilkin/fedor-test`) and moved them here.

## Goal
An "implementation lab": identical pages, each wired to Amplitude differently, each streaming into its own Amplitude project, published on GitHub Pages so external people can open them. Pages are for debugging: they show exactly how Amplitude is implemented on them, plus live SDK state and a log.

## What exists right now
- `index.html` + `registry.js` — tracking-free landing page with 4 variant cards. Only `unified-sdk` is live; the other 3 are placeholders (`status: 'planned'`, no API key).
- `unified-sdk/` — **working**. npm `@amplitude/unified` 1.2.9 bundled with esbuild into `dist/amplitude-unified.js` (committed, ~812 KB), initialised with `initAll()` (Analytics with autocapture on, Session Replay sampleRate 1, Feature Experiment, Guides & Surveys), plus the separate Web Experiment script tag loaded right after the bundle in `<head>`.
  - API key: `06556c56eb0e04dd109403f006794241` (its own Amplitude project, US zone).
  - Events it sends: `Lab Page Viewed`, `CTA Clicked`, `Plan Selected`, plus autocaptured `[Amplitude] …` events, `$identify`, `session_start`, Guides & Surveys boot event. Library tag: `amplitude-ts-unified/1.2.9-amplitude-ts/2.50.1`.
  - Verified in headless Chrome (uploads intercepted): events batch to `/2/httpapi`, Session Replay uploads to `api-sr.amplitude.com`, Web Experiment script loads, no console errors. **No real event has reached the project yet.**
  - Rebuild after editing `src/main.js`: `cd unified-sdk && npm install && npm run build`.
- `CLAUDE.md` — project rules.
- Git repo initialised on `master`, nothing committed, no GitHub remote yet.

## Key technical findings (don't re-derive)
- The Unified SDK is npm-only; there is no CDN build. The CDN "Unified Script" (`cdn.amplitude.com/script/<key>.js`) is a different product: it bundles Analytics + Session Replay + **Web** Experiment, while the npm Unified SDK bundles Analytics + Session Replay + **Feature** Experiment + Guides & Surveys. Amplitude does not document running Web Experiment with the npm Unified SDK.
- It works anyway because both share Amplitude's global analytics connector: `globalThis.analyticsConnectorInstances['$default_instance']`. The SDK publishes device/user ID there and receives Web Experiment's `$exposure` events through it. Two requirements: do NOT set `instanceName` in `initAll()` (Web Experiment only looks at `$default_instance`), and load the SDK bundle before the Web Experiment script. `window.amplitude = amplitude` is set in `src/main.js` for console use and for an optional plugin hook; not strictly required.
- Web Experiment needs only the script tag `https://cdn.amplitude.com/script/<API_KEY>.experiment.js`, synchronous, high in `<head>` (avoids flicker). No deployment key, no SDK calls. Experiments are built in Amplitude's visual editor; the page just needs stable element ids.
- Remote config (`https://sr-client-cfg.amplitude.com/config/<key>?config_group=browser`) can override autocapture settings in code. The FT project's config disables all autocapture; the `06556c56…` project's config does not, so autocapture works there.
- Amplitude's cookie is namespaced by API key, so variants on the same domain get separate device IDs. No cross-contamination.
- Amplitude docs do not say whether the Web Experiment visual editor works on `localhost`; untested. Ad blockers / privacy extensions block the editor.
- The FT site (separate repo) uses the standalone-scripts approach (Analytics SDK 2.47.2 + Session Replay plugin + Web Experiment script) with a hand-written `app.js`; useful reference for the `browser-sdk` variant: https://github.com/FChuvilkin/fedor-test (`app.js`, `index.html` head).

## Next steps, in order
1. **Publish.** Create the GitHub repo (public), push `master`, enable GitHub Pages from `master` root. Confirm `https://<user>.github.io/<repo>/` shows the landing page and `/unified-sdk/` initialises. Open it in a real browser and check that events, Session Replay and `$identify` land in the `06556c56…` project (User Look-Up by the `device_id` shown on the page). Then create a Web Experiment in that project targeting the `/unified-sdk/` URL (e.g. edit `#hero-title`) and confirm `$exposure` arrives.
2. **Shared page + adapter structure** (planned, not built). To keep variants identical, move the page body, buttons, state panel and log into `shared/lab.js` + `shared/lab.css`, and have each variant provide only its `<head>` scripts and a small `adapter.js` exposing `window.LabAdapter = { info, ready, track, identify, setUserId, reset, ids, flush }`. Port `unified-sdk` onto it first. Planned page sections: header strip (variant, products, project/key, versions, source link, variant switcher); "how this page is wired" (actual `<head>` script tags read at runtime, init options JSON, adapter source, remote config fetched live, caveats); playground (hero with stable ids, buttons: track simple, track nested props, identify, sign in, sign out, revenue, flush; autocapture fodder: form, outbound link, download link, second page; `run_id` field attached to every event); live state panel with self-checks; two-layer log (intent + network tap on `*.amplitude.com` with decoded payloads and response codes; export JSON); expected-events table.
3. **Remaining variants**, each needing its own project API key from Fedor: `browser-sdk` (separate CDN scripts; mirror FT), `unified-script` (one `<key>.js` tag), `http-api` (fetch to `/2/httpapi`, hand-managed device/session IDs, standalone Session Replay SDK with `[Amplitude] Session Replay ID` on every event — verify whether the standalone SR SDK has a CDN build). Later candidates: GTM, Segment, server-side relay.

## Open questions for Fedor
- GitHub repo name and account (assumed `FChuvilkin`).
- API keys / project names for `browser-sdk`, `unified-script`, `http-api`.
- Whether to add a root `build.sh` that rebuilds every npm-based variant.
