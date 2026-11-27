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
//                  remoteConfigUrl, caveats[] },
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
  var versions = Object.keys(info.versions || {}).map(function (k) { return '<span class="ver">' + esc(k) + ' <b>' + esc(info.versions[k]) + '</b></span>'; }).join('');

  function metaRow(label, value) { return '<div class="meta-row"><dt>' + label + '</dt><dd>' + value + '</dd></div>'; }

  var header =
    '<header class="lab-strip" id="lab-strip">' +
      '<div class="strip-row">' +
        '<a href="../" id="back-to-lab" class="strip-home" aria-label="AmpliLab home">' +
          '<img class="strip-logo" src="../shared/brand/awora-wordmark.svg" alt="Awora" width="1784" height="335">' +
          '<span class="strip-divider" aria-hidden="true"></span>' +
          '<span class="strip-name">AmpliLab</span>' +
        '</a>' +
        '<span class="strip-spacer"></span>' +
        switcher +
        (REPO && info.slug ? '<a id="source-link" class="strip-link" href="' + esc(REPO + '/tree/master/' + info.slug) + '" target="_blank" rel="noopener">Source ↗</a>' : '') +
      '</div>' +
    '</header>';

  var meta =
    '<section class="meta" id="meta">' +
      '<dl>' +
        metaRow('Implementation', '<span class="meta-title" id="variant-title">' + esc(info.title || 'No adapter loaded') + '</span>') +
        metaRow('Products implemented', '<span id="variant-products">' + ((info.products || []).map(function (p) { return '<span class="badge">' + esc(p) + '</span>'; }).join('') || '–') + '</span>') +
        metaRow('Data center', '<span id="data-center">' + esc(info.serverZone || '–') + '</span>') +
        (versions ? metaRow('Versions', '<span class="versions" id="variant-versions">' + versions + '</span>') : '') +
      '</dl>' +
    '</section>';

  function sectionHead(num, title, extra) {
    return '<div class="section-head"><p class="eyebrow"><b>' + num + '</b>' + title + '</p>' + (extra || '') + '</div>';
  }

  var wiring =
    '<section class="panel" id="wiring">' +
      sectionHead('04', 'How this page is wired') +
      '<details open id="wiring-head"><summary>&lt;head&gt; as served</summary><pre id="head-source">loading…</pre></details>' +
      '<details id="wiring-runtime"><summary>Scripts in the page right now (incl. ones the SDKs injected)</summary><pre id="runtime-scripts"></pre></details>' +
      '<details id="wiring-init"><summary>Init options</summary><pre id="init-options">' + esc(pretty(info.initOptions || '(none)')) + '</pre></details>' +
      (info.sources || []).map(function (f, i) {
        return '<details id="wiring-source-' + i + '" data-src="' + esc(f) + '"><summary>Source: ' + esc(info.slug + '/' + f) + '</summary><pre>loading…</pre></details>';
      }).join('') +
      (info.remoteConfigUrl ? '<details id="wiring-remote"><summary>Remote config (fetched live)</summary><div class="small"><code>' + esc(info.remoteConfigUrl) + '</code></div><pre id="remote-config">loading…</pre></details>' : '') +
      ((info.caveats || []).length ? '<details open id="wiring-caveats"><summary>Caveats</summary><ul>' + info.caveats.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></details>' : '') +
    '</section>';

  // Actions: one card per action. Add new actions as more .action cards in #actions-grid.
  var actions =
    '<section class="panel" id="actions">' +
      sectionHead('01', 'Actions') +
      '<div class="actions-grid" id="actions-grid">' +
        '<div class="action" id="action-track">' +
          '<div class="action-text"><h3>Track event</h3><p>Sends <code>Lab Simple Event</code>.</p></div>' +
          '<div class="action-controls"><button class="btn btn-primary" id="btn-track-event">Track event</button></div>' +
        '</div>' +
        '<div class="action" id="action-identify">' +
          '<div class="action-text"><h3>Identify call</h3><p>Sets user properties. Type <code>key=value</code> pairs (comma separated) or plain text, which is sent as <code>lab_input</code>.</p></div>' +
          '<form class="action-controls" id="identify-form" autocomplete="off">' +
            '<label class="visually-hidden" for="identify-input">Identify input</label>' +
            '<input id="identify-input" name="identify" placeholder="e.g. plan=growth, role=pm">' +
            '<button class="btn btn-primary" id="btn-identify" type="submit">Identify call</button>' +
          '</form>' +
        '</div>' +
      '</div>' +
    '</section>';

  var state =
    '<section class="panel" id="state">' +
      sectionHead('02', 'Live state') +
      '<div class="state-cols">' +
        '<dl id="state-list"></dl>' +
        '<ul class="checks" id="checks"></ul>' +
      '</div>' +
    '</section>';

  var log =
    '<section class="panel" id="log-panel">' +
      sectionHead('03', 'Log',
        '<span class="strip-spacer"></span>' +
        '<button class="btn btn-small btn-secondary" id="log-clear">Clear view</button>' +
        '<button class="btn btn-small btn-secondary" id="log-export">Export JSON</button>') +
      '<div class="log-cols">' +
        '<div><h3>Intent <span class="small muted">what the page asked the adapter to do</span></h3><div id="log-intent" class="log"></div></div>' +
        '<div><h3>Wire <span class="small muted">requests to *.amplitude.com, decoded</span></h3><div id="log-wire" class="log"></div>' +
          '<div class="small muted note">Session Replay uploads run in a Web Worker and do not appear here. Use DevTools → Network to see them.</div></div>' +
      '</div>' +
    '</section>';

  if (!document.querySelector('link[rel="icon"]')) document.head.insertAdjacentHTML('beforeend', '<link rel="icon" href="../shared/brand/awora-mark.svg" type="image/svg+xml">');
  document.body.insertAdjacentHTML('beforeend',
    header + '<main>' + meta + actions + state + log + wiring + '</main>');

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
    $('checks').innerHTML = checks.map(function (c) { return '<li class="' + (c[0] ? 'ok' : 'bad') + '"><span class="check-mark" aria-hidden="true">' + (c[0] ? '✓' : '✗') + '</span>' + esc(c[1]) + '</li>'; }).join('');
  }

  function refreshStatus() {
    if (!A || !A.status) return;
    when(A.status()).then(function (rows) { statusRows = rows || []; renderState(); }, function (err) { statusRows = [{ label: 'status()', value: String(err), ok: false }]; renderState(); });
  }

  function refreshAll() { renderWire(); renderState(); }
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

  function on(id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); }

  $('variant-switcher').addEventListener('change', function () { location.href = '../' + this.value + '/'; });

  on('btn-track-event', function () { track('Lab Simple Event', {}); });

  // "plan=growth, role=pm" -> { plan: 'growth', role: 'pm' }; anything without "=" -> { lab_input: text }.
  // Values that look like numbers or booleans are sent as such.
  function parseProps(text) {
    var out = {}, loose = [];
    text.split(',').forEach(function (part) {
      part = part.trim(); if (!part) return;
      var i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = typed(part.slice(i + 1).trim());
      else loose.push(part);
    });
    if (loose.length) out.lab_input = loose.join(', ');
    return out;
  }
  function typed(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v !== '' && !isNaN(Number(v))) return Number(v);
    return v;
  }

  $('identify-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = ($('identify-input').value || '').trim();
    var ops = { set: text ? parseProps(text) : {}, add: { lab_identify_count: 1 } };
    call('identify', '', ops, function () { return A.identify(ops); }).then(renderState);
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
