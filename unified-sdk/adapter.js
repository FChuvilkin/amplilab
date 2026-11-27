// AmpliLab adapter for the unified-sdk variant: maps the shared page's actions (shared/lab.js) onto
// the Unified SDK client that src/main.js exposes as window.amplitude. Contract: see the top of shared/lab.js.
(function () {
  'use strict';
  var amp = window.amplitude;
  var API_KEY = '06556c56eb0e04dd109403f006794241';

  function promiseOf(r) { return r && r.promise ? r.promise : r; }

  window.LabAdapter = {
    info: {
      slug: 'unified-sdk',
      title: 'Unified SDK (npm) + Web Experiment',
      products: ['Analytics', 'Session Replay', 'Feature Experiment', 'Guides & Surveys', 'Web Experiment'],
      apiKey: API_KEY,
      serverZone: 'US',
      versions: {
        '@amplitude/unified': '1.2.9',
        'analytics-browser': '2.50.1',
        'plugin-session-replay-browser': '1.38.2',
        'experiment-js-client': '1.24.0',
        'engagement-browser': '1.0.13',
        'Web Experiment script': 'CDN, unversioned'
      },
      initOptions: window.amplitudeInitOptions,
      sources: ['src/main.js', 'package.json'],
      remoteConfigUrl: 'https://sr-client-cfg.amplitude.com/config/' + API_KEY + '?config_group=browser',
      caveats: [
        'The Unified SDK is npm-only; dist/amplitude-unified.js is an esbuild bundle of src/main.js, committed to the repo.',
        'Web Experiment is not part of the npm Unified SDK. It is loaded as a separate script and talks to the SDK through the global analytics connector ($default_instance), so initAll() must not set instanceName and the bundle must load first.',
        'Remote config (below) can override the autocapture settings in the init options.',
        'Session Replay uploads go out from a Web Worker. The Wire log captures them by wrapping Worker in shared/lab-early.js; untick "Show Session Replay Workers" to hide them.'
      ]
    },

    ready: window.amplitudeReady,

    track: function (name, props) { return promiseOf(amp.track(name, props)); },

    identify: function (ops) {
      var id = new amp.Identify();
      Object.keys(ops.set || {}).forEach(function (k) { id.set(k, ops.set[k]); });
      Object.keys(ops.add || {}).forEach(function (k) { id.add(k, ops.add[k]); });
      return promiseOf(amp.identify(id));
    },

    setUserId: function (userId) { amp.setUserId(userId || undefined); },

    revenue: function (r) {
      var rev = new amp.Revenue().setProductId(r.productId).setPrice(r.price).setQuantity(r.quantity || 1);
      if (r.revenueType) rev.setRevenueType(r.revenueType);
      return promiseOf(amp.revenue(rev));
    },

    reset: function () { amp.reset(); },

    flush: function () { return promiseOf(amp.flush()); },

    ids: function () { return { deviceId: amp.getDeviceId(), sessionId: amp.getSessionId(), userId: amp.getUserId() }; },

    status: function () {
      var rows = [];

      var sr = amp.sessionReplay();
      var replayId = sr && sr.getSessionReplayProperties ? sr.getSessionReplayProperties()['[Amplitude] Session Replay ID'] : null;
      // Left (state list): just the replay ID. Right (self-checks): just whether it is recording.
      rows.push({ label: 'Session Replay ID', value: replayId || '–' });
      rows.push({ label: 'Session Replay', value: !sr ? 'plugin not loaded' : replayId ? 'recording' : 'plugin loaded, not recording (not sampled?)', ok: !!replayId, checkOnly: true });

      rows.push({ label: 'Web Experiment', value: window.webExperiment ? 'script loaded (window.webExperiment present)' : 'script not loaded', ok: !!window.webExperiment });

      var exp = amp.experiment();
      if (!exp) { rows.push({ label: 'Feature Experiment', value: 'plugin not loaded', ok: false }); return Promise.resolve(rows); }
      return exp.fetch().then(function () {
        var all = exp.all(), keys = Object.keys(all);
        rows.push({ label: 'Feature Experiment', value: keys.length ? keys.map(function (k) { return k + '=' + all[k].value; }).join(', ') : 'fetched, no flags for this user' });
        return rows;
      }, function (err) {
        rows.push({ label: 'Feature Experiment', value: 'fetch failed: ' + err, ok: false });
        return rows;
      });
    }
  };
})();
