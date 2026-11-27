// Amplitude Browser Unified SDK (@amplitude/unified), bundled by esbuild into dist/amplitude-unified.js.
// Rebuild after editing: `cd unified-sdk && npm install && npm run build`.
//
// initAll() sets up Analytics, Session Replay, Feature Experiment and Guides & Surveys in one call.
// Web Experiment is NOT part of the Unified SDK; index.html loads its script separately, right after this bundle.
// The two talk through Amplitude's global analytics connector (globalThis.analyticsConnectorInstances['$default_instance']):
// the SDK publishes device/user ID there, and Web Experiment's exposure events are sent through the SDK's track().
// So: do NOT set instanceName below, and load this bundle before the Web Experiment script.
import * as amplitude from '@amplitude/unified';

var API_KEY = '06556c56eb0e04dd109403f006794241';

var INIT_OPTIONS = {
  serverZone: 'US',
  analytics: { autocapture: true },
  sessionReplay: { sampleRate: 1 }, // record every session (lab page; default is 0)
  experiment: {} // Feature Experiment; deploymentKey falls back to API_KEY
};

// Expose the client for the console, for adapter.js and for Web Experiment, which looks for window.amplitude.
window.amplitude = amplitude;

// Lab plumbing: put the lab's run_id (shared/lab-early.js) on every event, autocaptured ones included.
// Added before initAll() so that it also catches the first events (session_start, page view).
amplitude.add({
  name: 'amplilab-run-id',
  type: 'enrichment',
  execute: function (event) {
    var runId = window.LabEarly && window.LabEarly.runId();
    if (runId) event.event_properties = Object.assign({}, event.event_properties, { run_id: runId });
    return Promise.resolve(event);
  }
});

window.amplitudeInitOptions = INIT_OPTIONS; // shown on the page under "Init options"
window.amplitudeReady = amplitude.initAll(API_KEY, INIT_OPTIONS);
