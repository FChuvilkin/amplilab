// AmpliLab shared page. Every variant loads this same file, so every variant has the same copy, buttons,
// element ids, event names and properties. Only the Amplitude wiring (in each variant's <head>) and the
// variant's adapter.js differ.
//
// Load it as a synchronous <script> as the first thing in <body>: it renders the page before first paint,
// which keeps Web Experiment's element changes flicker-free.
//
// The adapter contract: each variant defines window.LabAdapter (in its adapter.js) as
//   {
//     info:      { slug, title, products[], apiKey, serverZone, versions{}, initOptions, sources[],
//                  remoteConfigUrl, caveats[], expectedExtra[{ name, source, trigger, props }] },
//     ready:     Promise that resolves when the SDK is initialised,
//     track(name, props), identify({ set, add }), setUserId(id), revenue({ productId, price, quantity, revenueType }),
//     reset(), flush(),                              -> may return promises
//     ids():     { deviceId, sessionId, userId },
//     status():  Promise<[{ label, value, ok }]>  product-specific state rows (replay, flags, ...)
//   }
// The adapter is also responsible for putting window.LabEarly.runId() on every event as run_id.
(function () {
  'use strict';

  var A = window.LabAdapter;
  var early = window.LabEarly || { runId: function () { return ''; }, setRunId: function (v) { return v; }, entries: function () { return []; } };
  var info = (A && A.info) || {};
  var PAGE = document.body.getAttribute('data-lab-page') || 'home';
  var registry = window.LAB_REGISTRY || [];
  var REPO = window.LAB_REPO || '';

  // ---------- events the lab itself sends (identical in every variant) ----------
  var LAB_EVENTS = [
    { name: 'Lab Page Viewed', source: 'lab', trigger: 'page load', props: 'page' },
    { name: 'CTA Clicked', source: 'lab', trigger: '#cta-primary, #cta-secondary', props: 'cta, cta_text' },
    { name: 'Plan Selected', source: 'lab', trigger: '#plan-*-btn', props: 'plan, price' },
    { name: 'Lab Simple Event', source: 'lab', trigger: '#btn-track-simple', props: '(none)' },
    { name: 'Lab Nested Event', source: 'lab', trigger: '#btn-track-nested', props: 'order{ id, total, items[]{ sku, qty, price }, shipping{ country, express } }, tags[]' },
    { name: '$identify', source: 'lab', trigger: '#btn-identify', props: 'user props: $set lab_favorite_plan, lab_tester; $add lab_identify_count' },
    { name: 'Signed In', source: 'lab', trigger: '#btn-sign-in (after setUserId)', props: 'method' },
    { name: 'Signed Out', source: 'lab', trigger: '#btn-sign-out (before reset)', props: 'method' },
    { name: 'revenue_amount', source: 'lab', trigger: '#btn-revenue', props: '$productId, $price, $quantity, $revenueType' },
    { name: 'Signup Form Submitted', source: 'lab', trigger: '#signup-form submit', props: 'email_domain' }
  ];
  var EXPECTED = LAB_EVENTS.concat(info.expectedExtra || []);
  // Everything except run_id is the same across variants. run_id is added by the adapter.

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pretty(v) { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); }
  function time(t) { var d = new Date(t); return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
  function when(p) { return p && typeof p.then === 'function' ? p : Promise.resolve(p); }
  function eventsOf(entry) { var r = entry.request; return r && typeof r === 'object' && Array.isArray(r.events) ? r.events : []; }
  function pathOf(url) { try { var u = new URL(url); return u.host + u.pathname; } catch (e) { return url; } }

  // ---------- render ----------
  var others = registry.filter(function (v) { return v.status === 'live'; });
  var switcher = '<select id="variant-switcher" aria-label="Switch variant">' + others.map(function (v) {
    return '<option value="' + esc(v.slug) + '"' + (v.slug === info.slug ? ' selected' : '') + '>' + esc(v.title) + '</option>';
  }).join('') + '</select>';
  var versions = Object.keys(info.versions || {}).map(function (k) { return '<span>' + esc(k) + ' <b>' + esc(info.versions[k]) + '</b></span>'; }).join('');

  var header =
    '<header class="lab-strip" id="lab-strip">' +
      '<div class="strip-row">' +
        '<a href="../" id="back-to-lab" class="strip-home">AmpliLab</a>' +
        '<span class="strip-title" id="variant-title">' + esc(info.title || 'No adapter loaded') + '</span>' +
        '<span class="strip-spacer"></span>' +
        switcher +
        (REPO && info.slug ? '<a id="source-link" href="' + esc(REPO + '/tree/master/' + info.slug) + '" target="_blank" rel="noopener">source ↗</a>' : '') +
      '</div>' +
      '<div class="strip-row strip-meta">' +
        (info.products || []).map(function (p) { return '<span class="badge">' + esc(p) + '</span>'; }).join('') +
        '<span>api key <code id="api-key">' + esc(info.apiKey || '—') + '</code></span>' +
        '<span>zone <code>' + esc(info.serverZone || '—') + '</code></span>' +
        '<span>library on wire <code id="wire-library">–</code></span>' +
      '</div>' +
      (versions ? '<div class="strip-row strip-meta strip-versions">' + versions + '</div>' : '') +
    '</header>';

  var wiring =
    '<section class="panel" id="wiring">' +
      '<h2>How this page is wired</h2>' +
      '<details open id="wiring-head"><summary>&lt;head&gt; as served</summary><pre id="head-source">loading…</pre></details>' +
      '<details id="wiring-runtime"><summary>Scripts in the page right now (incl. ones the SDKs injected)</summary><pre id="runtime-scripts"></pre></details>' +
      '<details id="wiring-init"><summary>Init options</summary><pre id="init-options">' + esc(pretty(info.initOptions || '(none)')) + '</pre></details>' +
      (info.sources || []).map(function (f, i) {
        return '<details id="wiring-source-' + i + '" data-src="' + esc(f) + '"><summary>Source: ' + esc(info.slug + '/' + f) + '</summary><pre>loading…</pre></details>';
      }).join('') +
      (info.remoteConfigUrl ? '<details id="wiring-remote"><summary>Remote config (fetched live)</summary><div class="small"><code>' + esc(info.remoteConfigUrl) + '</code></div><pre id="remote-config">loading…</pre></details>' : '') +
      ((info.caveats || []).length ? '<details open id="wiring-caveats"><summary>Caveats</summary><ul>' + info.caveats.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></details>' : '') +
    '</section>';

  var playground = PAGE === 'second' ?
    '<section class="hero" id="hero">' +
      '<h1 id="hero-title">Second page</h1>' +
      '<p id="hero-subtitle">A second page load in the same session. Check that device_id and session_id carry over.</p>' +
      '<a class="btn btn-secondary" id="link-home" href="./">← Back to the first page</a>' +
    '</section>'
    :
    '<section class="hero" id="hero">' +
      '<h1 id="hero-title">Analytics, replay and experiments on one test page</h1>' +
      '<p id="hero-subtitle">The same page in every AmpliLab variant. Only the Amplitude wiring differs.</p>' +
      '<button class="btn btn-primary" id="cta-primary" data-cta="start_trial">Start free trial</button>' +
      '<button class="btn btn-secondary" id="cta-secondary" data-cta="book_demo">Book a demo</button>' +
    '</section>' +
    '<section class="plans" id="plans">' +
      plan('starter', 'Starter', 'For side projects.', '$0', '0', 'Choose Starter', false) +
      plan('growth', 'Growth', 'For growing teams.', '$49', '49', 'Choose Growth', true) +
      plan('enterprise', 'Enterprise', 'For large organisations.', 'Custom', '', 'Contact sales', false) +
    '</section>';

  function plan(key, name, blurb, price, priceVal, cta, featured) {
    return '<div class="plan' + (featured ? ' featured' : '') + '" id="plan-' + key + '">' +
      '<h3>' + name + '</h3><p>' + blurb + '</p><div class="price">' + price + '</div>' +
      '<button class="btn ' + (featured ? 'btn-primary' : 'btn-secondary') + '" id="plan-' + key + '-btn" data-plan="' + key + '" data-price="' + priceVal + '">' + cta + '</button></div>';
  }

  var actions =
    '<section class="panel" id="actions">' +
      '<h2>Playground</h2>' +
      '<div class="row">' +
        '<label for="run-id">run_id <span class="small">(sent on every event; also settable with ?run=…)</span></label>' +
        '<input id="run-id" placeholder="e.g. test-42" value="' + esc(early.runId()) + '">' +
        '<button class="btn btn-small" id="run-id-apply">Set</button>' +
        '<button class="btn btn-small btn-secondary" id="run-id-new">New</button>' +
      '</div>' +
      '<div class="row">' +
        '<label for="user-id-input">user_id for sign in</label>' +
        '<input id="user-id-input" value="lab-tester">' +
      '</div>' +
      '<div class="row buttons">' +
        '<button class="btn btn-small" id="btn-track-simple">Track simple</button>' +
        '<button class="btn btn-small" id="btn-track-nested">Track nested props</button>' +
        '<button class="btn btn-small" id="btn-identify">Identify</button>' +
        '<button class="btn btn-small" id="btn-sign-in">Sign in</button>' +
        '<button class="btn btn-small" id="btn-sign-out">Sign out (reset)</button>' +
        '<button class="btn btn-small" id="btn-revenue">Revenue $49</button>' +
        '<button class="btn btn-small btn-secondary" id="btn-flush">Flush</button>' +
      '</div>' +
      (PAGE === 'second' ? '' :
      '<h3>Autocapture targets <span class="small">(the lab tracks only the form submit; anything else here comes from the SDK)</span></h3>' +
      '<form id="signup-form" class="row" autocomplete="off">' +
        '<label for="signup-email">Email</label>' +
        '<input id="signup-email" name="email" type="email" placeholder="you@example.com" required>' +
        '<select id="signup-role" name="role"><option value="pm">Product manager</option><option value="eng">Engineer</option><option value="data">Data</option></select>' +
        '<button class="btn btn-small" id="signup-submit" type="submit">Sign up</button>' +
      '</form>' +
      '<div class="row links">' +
        '<a id="link-outbound" href="https://amplitude.com/docs" target="_blank" rel="noopener">Outbound link (amplitude.com/docs)</a>' +
        '<a id="link-download" href="../shared/lab-sample.csv" download>Download link (lab-sample.csv)</a>' +
        '<a id="link-second-page" href="page-2.html">Second page →</a>' +
      '</div>') +
    '</section>';

  var state =
    '<section class="panel dark" id="state">' +
      '<h2>Live state</h2>' +
      '<dl id="state-list"></dl>' +
      '<h2>Self-checks</h2>' +
      '<ul class="checks" id="checks"></ul>' +
    '</section>';

  var log =
    '<section class="panel dark" id="log-panel">' +
      '<div class="log-head"><h2>Log</h2><span class="strip-spacer"></span>' +
        '<button class="btn btn-small btn-ghost" id="log-clear">Clear view</button>' +
        '<button class="btn btn-small btn-ghost" id="log-export">Export JSON</button></div>' +
      '<div class="log-cols">' +
        '<div><h3>Intent <span class="small">what the page asked the adapter to do</span></h3><div id="log-intent" class="log"></div></div>' +
        '<div><h3>Wire <span class="small">requests to *.amplitude.com, decoded</span></h3><div id="log-wire" class="log"></div>' +
          '<div class="small muted">Session Replay uploads run in a Web Worker and do not appear here. Use DevTools → Network to see them.</div></div>' +
      '</div>' +
    '</section>';

  var expected =
    '<section class="panel" id="expected">' +
      '<h2>Expected events <span class="small">count = seen in decoded uploads on this page load</span></h2>' +
      '<table><thead><tr><th>Event</th><th>Source</th><th>Trigger</th><th>Properties</th><th>Seen</th></tr></thead><tbody id="expected-body"></tbody></table>' +
      '<div id="unexpected" class="small"></div>' +
    '</section>';

  document.body.insertAdjacentHTML('beforeend',
    header + '<main>' + playground + actions + '<div class="two-col">' + state + log + '</div>' + expected + wiring + '</main>');

  // ---------- logs ----------
  var intents = [];
  var hiddenBefore = 0; // "Clear view" hides entries up to this time
  var openWire = {};

  function intent(action, name, detail, error) {
    var e = { t: Date.now(), action: action, name: name || '', detail: detail === undefined ? null : detail, error: error || null };
    intents.push(e);
    renderIntent(e);
  }
  function renderIntent(e) {
    var d = document.createElement('div');
    d.className = 'log-line' + (e.error ? ' bad' : '');
    d.innerHTML = '<span class="muted">' + time(e.t) + '</span> <b>' + esc(e.action) + '</b> ' + esc(e.name) +
      (e.detail != null ? ' <span class="muted">' + esc(JSON.stringify(e.detail)) + '</span>' : '') +
      (e.error ? ' <span class="bad">' + esc(e.error) + '</span>' : '');
    $('log-intent').prepend(d);
  }

  function renderWire() {
    var list = early.entries().filter(function (e) { return e.status !== null && e.t >= hiddenBefore; });
    $('log-wire').innerHTML = list.reverse().map(function (e) {
      var names = eventsOf(e).map(function (ev) { return ev.event_type; });
      var cls = e.ok ? 'ok' : (e.status === 0 || e.status >= 400 ? 'bad' : '');
      return '<details class="log-line" data-seq="' + e.seq + '"' + (openWire[e.seq] ? ' open' : '') + '><summary>' +
        '<span class="muted">' + time(e.t) + '</span> <b>' + esc(e.method) + '</b> ' + esc(pathOf(e.url)) +
        ' <span class="' + cls + '">' + (e.status || 'ERR') + '</span>' +
        (e.transport !== 'fetch' ? ' <span class="muted">' + esc(e.transport) + '</span>' : '') +
        (names.length ? ' <span class="evs">[' + esc(names.join(', ')) + ']</span>' : '') +
        '</summary>' +
        '<div class="small muted">' + esc(e.url) + '</div>' +
        (e.request != null && e.request !== '' ? '<div class="small">request' + (e.requestEncoding === 'gzip' ? ' (gzip, decoded)' : '') + '</div><pre>' + esc(pretty(e.request)) + '</pre>' : '') +
        '<div class="small">response</div><pre>' + esc(pretty(e.response)) + '</pre>' +
        '</details>';
    }).join('');
  }
  $('log-wire').addEventListener('toggle', function (ev) {
    var s = ev.target.getAttribute && ev.target.getAttribute('data-seq');
    if (s) openWire[s] = ev.target.open;
  }, true);

  // ---------- expected events + library ----------
  function renderExpected() {
    var counts = {}, library = '';
    early.entries().forEach(function (e) {
      eventsOf(e).forEach(function (ev) {
        counts[ev.event_type] = (counts[ev.event_type] || 0) + 1;
        if (ev.library) library = ev.library;
      });
    });
    $('expected-body').innerHTML = EXPECTED.map(function (x) {
      var n = counts[x.name] || 0;
      return '<tr><td><code>' + esc(x.name) + '</code></td><td>' + esc(x.source) + '</td><td>' + esc(x.trigger) + '</td><td>' + esc(x.props || '') + '</td>' +
        '<td class="' + (n ? 'ok' : 'muted') + '">' + n + '</td></tr>';
    }).join('');
    var known = {}; EXPECTED.forEach(function (x) { known[x.name] = 1; });
    var extra = Object.keys(counts).filter(function (k) { return !known[k]; });
    $('unexpected').innerHTML = extra.length ? 'Also seen: ' + extra.map(function (k) { return '<code>' + esc(k) + '</code> ×' + counts[k]; }).join(', ') : '';
    if (library) $('wire-library').textContent = library;
  }

  // ---------- state + self-checks ----------
  var readyAt = null, readyError = null; // readyAt = ms since navigation start
  var statusRows = [];

  function renderState() {
    var ids = {};
    try { ids = A && A.ready && readyAt !== null ? A.ids() || {} : {}; } catch (e) { ids = {}; }
    var rows = [
      { label: 'SDK', value: !A ? 'no adapter (window.LabAdapter missing)' : readyError ? 'init failed: ' + readyError : readyAt === null ? 'initialising…' : 'ready ' + readyAt + ' ms after navigation start', ok: !!A && readyAt !== null && !readyError },
      { label: 'device_id', value: ids.deviceId || '–', id: 'd-device' },
      { label: 'session_id', value: ids.sessionId || '–', id: 'd-session' },
      { label: 'user_id', value: ids.userId || '(none)', id: 'd-user' },
      { label: 'run_id', value: early.runId() || '(none)', id: 'd-run' }
    ].concat(statusRows);
    $('state-list').innerHTML = rows.map(function (r) {
      return '<dt>' + esc(r.label) + '</dt><dd' + (r.id ? ' id="' + r.id + '"' : '') + (r.ok === false ? ' class="bad"' : '') + '>' + esc(r.value) + '</dd>';
    }).join('');

    var entries = early.entries().filter(function (e) { return e.status !== null; });
    var uploads = entries.filter(function (e) { return e.method === 'POST' && eventsOf(e).length; });
    var accepted = uploads.filter(function (e) { return e.ok; });
    var failed = entries.filter(function (e) { return e.status === 0 || e.status >= 400; });
    var lastEvents = uploads.length ? eventsOf(uploads[uploads.length - 1]) : [];
    var run = early.runId();
    var checks = [
      [!!A, 'Adapter loaded'],
      [readyAt !== null && !readyError, 'SDK initialised'],
      [!!ids.deviceId, 'device_id set'],
      [!!ids.sessionId, 'session_id set'],
      [accepted.length > 0, 'Amplitude accepted an event upload (' + accepted.length + '/' + uploads.length + ' uploads 2xx)'],
      [failed.length === 0, failed.length ? failed.length + ' failed request(s) to Amplitude' : 'No failed requests to Amplitude']
    ];
    if (run) checks.push([lastEvents.length > 0 && lastEvents.every(function (ev) { return ev.event_properties && ev.event_properties.run_id === run; }), 'run_id "' + run + '" on every event in the last upload']);
    statusRows.forEach(function (r) { if (typeof r.ok === 'boolean') checks.push([r.ok, r.label + ': ' + r.value]); });
    $('checks').innerHTML = checks.map(function (c) { return '<li class="' + (c[0] ? 'ok' : 'bad') + '">' + (c[0] ? '✓ ' : '✗ ') + esc(c[1]) + '</li>'; }).join('');
  }

  function refreshStatus() {
    if (!A || !A.status) return;
    when(A.status()).then(function (rows) { statusRows = rows || []; renderState(); }, function (err) { statusRows = [{ label: 'status()', value: String(err), ok: false }]; renderState(); });
  }

  function refreshAll() { renderWire(); renderExpected(); renderState(); }
  var pending = false;
  document.addEventListener('lab:net', function () {
    if (pending) return; pending = true;
    setTimeout(function () { pending = false; refreshAll(); }, 50);
  });

  // ---------- actions ----------
  function call(action, name, detail, fn) {
    intent(action, name, detail);
    if (!A) return Promise.resolve();
    try {
      return when(fn()).catch(function (err) { intent(action + ' failed', name, null, String(err)); });
    } catch (err) { intent(action + ' failed', name, null, String(err)); return Promise.resolve(); }
  }
  function track(name, props) { return call('track', name, props, function () { return A.track(name, props); }); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-cta], [data-plan]');
    if (!el) return;
    if (el.dataset.cta) track('CTA Clicked', { cta: el.dataset.cta, cta_text: el.textContent.trim() });
    if (el.dataset.plan) track('Plan Selected', { plan: el.dataset.plan, price: el.dataset.price ? Number(el.dataset.price) : null });
  });

  function on(id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); }

  $('variant-switcher').addEventListener('change', function () { location.href = '../' + this.value + '/'; });

  function applyRun(v) { $('run-id').value = early.setRunId(v); intent('set run_id', early.runId() || '(cleared)'); renderState(); }
  on('run-id-apply', function () { applyRun($('run-id').value); });
  on('run-id-new', function () { applyRun('run-' + new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '') + '-' + Math.random().toString(36).slice(2, 6)); });
  $('run-id').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyRun(this.value); });

  on('btn-track-simple', function () { track('Lab Simple Event', {}); });
  on('btn-track-nested', function () {
    track('Lab Nested Event', {
      order: { id: 'ord-1001', total: 98.5, items: [{ sku: 'growth-plan', qty: 1, price: 49 }, { sku: 'addon-replay', qty: 1, price: 49.5 }], shipping: { country: 'NL', express: false } },
      tags: ['lab', 'nested', 'array']
    });
  });
  on('btn-identify', function () {
    var ops = { set: { lab_favorite_plan: 'growth', lab_tester: true }, add: { lab_identify_count: 1 } };
    call('identify', '', ops, function () { return A.identify(ops); });
  });
  on('btn-sign-in', function () {
    var uid = ($('user-id-input').value || '').trim() || 'lab-tester';
    call('setUserId', uid, null, function () { return A.setUserId(uid); }).then(function () {
      track('Signed In', { method: 'lab_button' }); renderState();
    });
  });
  on('btn-sign-out', function () {
    track('Signed Out', { method: 'lab_button' }).then(function () {
      return call('reset', '', null, function () { return A.reset(); });
    }).then(function () { renderState(); refreshStatus(); });
  });
  on('btn-revenue', function () {
    var r = { productId: 'growth_plan', price: 49, quantity: 1, revenueType: 'purchase' };
    call('revenue', '', r, function () { return A.revenue(r); });
  });
  on('btn-flush', function () { call('flush', '', null, function () { return A.flush(); }); });

  var form = $('signup-form');
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('signup-email').value || '';
    track('Signup Form Submitted', { email_domain: email.split('@')[1] || null });
    form.reset();
  });

  on('log-clear', function () { hiddenBefore = Date.now(); $('log-intent').innerHTML = ''; renderWire(); });
  on('log-export', function () {
    var ids = {}; try { ids = A ? A.ids() : {}; } catch (e) {}
    var dump = { exported_at: new Date().toISOString(), variant: info.slug, page: PAGE, url: location.href, run_id: early.runId(), ids: ids, intents: intents, wire: early.entries() };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }));
    a.download = 'amplilab-' + (info.slug || 'page') + '-' + Date.now() + '.json';
    a.click();
  });

  // ---------- wiring section ----------
  var servedHead = '';
  fetch(location.href, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (html) {
    var m = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    servedHead = m ? m[1] : '';
    $('head-source').textContent = m ? m[1].replace(/^\n+|\s+$/g, '') : '(could not find <head>)';
    renderRuntimeScripts();
  }, function (err) { $('head-source').textContent = 'fetch failed: ' + err; });

  // [lab] = lab tooling, [page] = written in this page's HTML, [injected] = added at runtime by an SDK.
  function renderRuntimeScripts() {
    $('runtime-scripts').textContent = Array.prototype.map.call(document.querySelectorAll('script[src]'), function (s) {
      var attr = s.getAttribute('src');
      var tag = s.hasAttribute('data-lab') ? '[lab]      ' : servedHead.indexOf('"' + attr + '"') !== -1 ? '[page]     ' : '[injected] ';
      return tag + s.src;
    }).join('\n');
  }

  Array.prototype.forEach.call(document.querySelectorAll('details[data-src]'), function (d) {
    fetch(d.getAttribute('data-src'), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : 'HTTP ' + r.status; })
      .then(function (t) { d.querySelector('pre').textContent = t; }, function (err) { d.querySelector('pre').textContent = 'fetch failed: ' + err; });
  });

  if (info.remoteConfigUrl) {
    // Fetched with the page's original fetch path, so it also shows up in the Wire log (it's an amplitude.com request).
    fetch(info.remoteConfigUrl).then(function (r) { return r.text(); }).then(function (t) {
      try { t = JSON.stringify(JSON.parse(t), null, 2); } catch (e) {}
      $('remote-config').textContent = t;
    }, function (err) { $('remote-config').textContent = 'fetch failed: ' + err; });
  }

  // ---------- boot ----------
  refreshAll();
  if (A) {
    track('Lab Page Viewed', { page: PAGE });
    when(A.ready).then(function () {
      readyAt = Math.round(performance.now());
      intent('ready', '', { ms: readyAt });
      renderState(); refreshStatus(); renderRuntimeScripts();
    }, function (err) { readyError = String(err); renderState(); });
  } else {
    intent('error', 'window.LabAdapter is missing: check this variant\'s adapter.js', null, 'no adapter');
  }
  setInterval(function () { renderState(); }, 2000);
  setTimeout(function () { refreshStatus(); renderRuntimeScripts(); }, 4000);
})();
