// Amplitude Browser Unified SDK (@amplitude/unified), bundled by esbuild into dist/amplitude-unified.js.
// Rebuild after editing: `cd lab/unified-sdk && npm install && npm run build`.
//
// initAll() sets up Analytics, Session Replay, Feature Experiment and Guides & Surveys in one call.
// Web Experiment is NOT part of the Unified SDK; index.html loads its script separately, right after this bundle.
// The two talk through Amplitude's global analytics connector (globalThis.analyticsConnectorInstances['$default_instance']):
// the SDK publishes device/user ID there, and Web Experiment's exposure events are sent through the SDK's track().
import * as amplitude from '@amplitude/unified';

var API_KEY = '06556c56eb0e04dd109403f006794241';

// Expose the client for the console and for Web Experiment, which looks for window.amplitude.
window.amplitude = amplitude;

amplitude.initAll(API_KEY, {
  serverZone: 'US',
  analytics: { autocapture: true },
  sessionReplay: { sampleRate: 1 }, // record every session (demo page; default is 0)
  experiment: {} // Feature Experiment; deploymentKey falls back to API_KEY
}).then(function () {
  console.log('[unified] initAll done. device_id:', amplitude.getDeviceId(), 'session_id:', amplitude.getSessionId());
  document.dispatchEvent(new Event('amplitude:ready'));
});
