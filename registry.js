// Amplitude Implementation Lab: one entry per implementation variant.
// Plain data, no tracking. The landing page (index.html) renders its cards from this list.
// Browser API keys are public by design, so they are committed.
window.LAB_REPO = 'https://github.com/FChuvilkin/amplilab';

window.LAB_REGISTRY = [
  {
    slug: 'browser-sdk',
    title: 'Browser SDK (separate scripts)',
    method: 'Analytics SDK, Session Replay plugin and Web Experiment script loaded as separate CDN script tags. Same approach as the FT site.',
    products: ['Analytics', 'Session Replay', 'Web Experiment'],
    build: 'none',
    apiKey: null,
    status: 'planned'
  },
  {
    slug: 'unified-script',
    title: 'Unified Script (one tag)',
    method: 'Single cdn.amplitude.com/script/<key>.js tag that bundles Analytics, Session Replay and Web Experiment.',
    products: ['Analytics', 'Session Replay', 'Web Experiment'],
    build: 'none',
    apiKey: null,
    status: 'planned'
  },
  {
    slug: 'unified-sdk',
    title: 'Unified SDK (npm) + Web Experiment',
    method: '@amplitude/unified from npm, bundled with esbuild, initialised with initAll(). Web Experiment loaded as a separate script.',
    products: ['Analytics', 'Session Replay', 'Feature Experiment', 'Guides & Surveys', 'Web Experiment'],
    build: 'esbuild',
    apiKey: '06556c56eb0e04dd109403f006794241',
    status: 'live'
  },
  {
    slug: 'http-api',
    title: 'HTTP API + standalone Session Replay',
    method: 'No analytics SDK. Events sent with fetch() to /2/httpapi; device, session and replay IDs managed by hand; Session Replay via the standalone SDK.',
    products: ['Analytics (HTTP API)', 'Session Replay'],
    build: 'tbd',
    apiKey: null,
    status: 'planned'
  }
];
