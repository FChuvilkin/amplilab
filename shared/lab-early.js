// AmpliLab tooling, NOT part of any Amplitude wiring.
// Load this FIRST in <head>, before any Amplitude script, so the network tap is in place
// before the SDK grabs fetch / XMLHttpRequest / sendBeacon.
// It records every request to *.amplitude.com made from the page or from its Web Workers (Session Replay uploads), decodes the payload
// (including gzip bodies) and the response, and hands them to shared/lab.js via the 'lab:net' event.
// Limitation: module workers and requests made by service workers are not covered.
(function () {
  'use strict';

  // ---------- network tap ----------
  var entries = [];
  var seq = 0;

  function isAmplitude(url) {
    try { return /(^|\.)amplitude\.com$/.test(new URL(url, location.href).hostname); } catch (e) { return false; }
  }

  function bytesOf(body) {
    if (body instanceof Uint8Array) return Promise.resolve(body);
    if (body instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(body));
    if (ArrayBuffer.isView(body)) return Promise.resolve(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    if (typeof Blob !== 'undefined' && body instanceof Blob) return body.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return null;
  }

  function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('no DecompressionStream'));
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  // Returns a promise of { text, encoding } for any request body type the SDKs use.
  function decodeBody(body) {
    if (body == null) return Promise.resolve({ text: '', encoding: 'none' });
    if (typeof body === 'string') return Promise.resolve({ text: body, encoding: 'text' });
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return Promise.resolve({ text: body.toString(), encoding: 'form' });
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var o = {}; body.forEach(function (v, k) { o[k] = String(v); });
      return Promise.resolve({ text: JSON.stringify(o), encoding: 'form-data' });
    }
    var b = bytesOf(body);
    if (!b) return Promise.resolve({ text: '[' + Object.prototype.toString.call(body) + ']', encoding: 'unknown' });
    return b.then(function (bytes) {
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        return gunzip(bytes).then(function (t) { return { text: t, encoding: 'gzip' }; },
          function () { return { text: '[gzip, ' + bytes.length + ' bytes, could not decode]', encoding: 'gzip' }; });
      }
      return { text: new TextDecoder().decode(bytes), encoding: 'bytes' };
    });
  }

  function tryJson(text) { try { return JSON.parse(text); } catch (e) { return undefined; } }

  function record(method, url, body, transport) {
    var entry = {
      seq: ++seq, t: Date.now(), transport: transport, method: String(method || 'GET').toUpperCase(),
      url: String(url), status: null, ok: null, request: null, requestEncoding: null, response: null, error: null
    };
    entries.push(entry);
    var bodyDone = decodeBody(body).then(function (d) {
      entry.request = tryJson(d.text); if (entry.request === undefined) entry.request = d.text;
      entry.requestEncoding = d.encoding;
    });
    return {
      entry: entry,
      done: function (status, responseText, error) {
        entry.status = status; entry.ok = status >= 200 && status < 300; entry.error = error || null;
        var r = tryJson(responseText); entry.response = r === undefined ? (responseText || '').slice(0, 2000) : r;
        bodyDone.then(function () { document.dispatchEvent(new CustomEvent('lab:net', { detail: entry })); });
      }
    };
  }

  // fetch
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (!isAmplitude(url)) return origFetch.apply(this, arguments);
      var method = (init && init.method) || (input && input.method) || 'GET';
      var rec = record(method, url, init && init.body, 'fetch');
      return origFetch.apply(this, arguments).then(function (res) {
        res.clone().text().then(function (t) { rec.done(res.status, t); }, function () { rec.done(res.status, ''); });
        return res;
      }, function (err) { rec.done(0, '', String(err)); throw err; });
    };
  }

  // XMLHttpRequest
  var X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (X) {
    var origOpen = X.open, origSend = X.send;
    X.open = function (method, url) { this.__lab = isAmplitude(url) ? { method: method, url: url } : null; return origOpen.apply(this, arguments); };
    X.send = function (body) {
      if (this.__lab) {
        var rec = record(this.__lab.method, this.__lab.url, body, 'xhr'), xhr = this;
        xhr.addEventListener('loadend', function () {
          var text = ''; try { text = xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : ''; } catch (e) {}
          rec.done(xhr.status, text, xhr.status === 0 ? 'network error' : null);
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  // sendBeacon (used by SDKs on page hide; no response is available)
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      var queued = origBeacon(url, data);
      if (isAmplitude(url)) record('POST', url, data, 'beacon').done(queued ? 202 : 0, queued ? '(beacon queued, no response available)' : '', queued ? null : 'beacon rejected');
      return queued;
    };
  }

  // Web Workers (Session Replay uploads). Page-side patches can't see requests made inside a worker, so wrap
  // `Worker`: each classic worker starts from a tiny prelude that patches fetch/XHR inside the worker and reports
  // every amplitude.com request over a BroadcastChannel (not postMessage, so the SDK's own messages are untouched),
  // then loads the original script with importScripts(). Module workers are left as they are.
  var CH = 'amplilab-net';
  function workerPrelude(target) {
    return '(' + function (target, CH) {
      var ch = new BroadcastChannel(CH);
      function isA(u) { try { return /(^|\.)amplitude\.com$/.test(new URL(u, self.location.href).hostname); } catch (e) { return false; } }
      function send(m) { m.__lab = true; m.t = Date.now(); try { ch.postMessage(m); } catch (e) { m.body = '[body not cloneable]'; try { ch.postMessage(m); } catch (e2) {} } }
      var of = self.fetch;
      if (of) self.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (!isA(url)) return of.apply(this, arguments);
        var method = (init && init.method) || (input && input.method) || 'GET', body = init && init.body;
        return of.apply(this, arguments).then(function (res) {
          res.clone().text().then(function (t) { send({ method: method, url: url, body: body, status: res.status, text: t, transport: 'fetch (worker)' }); },
            function () { send({ method: method, url: url, body: body, status: res.status, text: '', transport: 'fetch (worker)' }); });
          return res;
        }, function (err) { send({ method: method, url: url, body: body, status: 0, text: '', error: String(err), transport: 'fetch (worker)' }); throw err; });
      };
      var X = self.XMLHttpRequest && self.XMLHttpRequest.prototype;
      if (X) {
        var oo = X.open, os = X.send;
        X.open = function (m, u) { this.__l = isA(u) ? { m: m, u: u } : null; return oo.apply(this, arguments); };
        X.send = function (b) {
          if (this.__l) {
            var l = this.__l, x = this;
            x.addEventListener('loadend', function () {
              var t = ''; try { t = x.responseType === '' || x.responseType === 'text' ? x.responseText : ''; } catch (e) {}
              send({ method: l.m, url: l.u, body: b, status: x.status, text: t, error: x.status === 0 ? 'network error' : null, transport: 'xhr (worker)' });
            });
          }
          return os.apply(this, arguments);
        };
      }
      importScripts(target);
    } + ')(' + JSON.stringify(target) + ',' + JSON.stringify(CH) + ');';
  }
  var OrigWorker = window.Worker;
  if (OrigWorker && window.BroadcastChannel && window.Blob && window.URL) {
    window.Worker = function (url, options) {
      if (options && options.type === 'module') return new OrigWorker(url, options);
      var target; try { target = new URL(String(url), location.href).href; } catch (e) { return new OrigWorker(url, options); }
      var blobUrl = URL.createObjectURL(new Blob([workerPrelude(target)], { type: 'text/javascript' }));
      return new OrigWorker(blobUrl, options);
    };
    window.Worker.prototype = OrigWorker.prototype;
    new BroadcastChannel(CH).onmessage = function (ev) {
      var m = ev.data;
      if (!m || !m.__lab) return;
      var rec = record(m.method, m.url, m.body, m.transport);
      rec.entry.t = m.t;
      rec.done(m.status, m.text, m.error);
    };
  }

  window.LabEarly = {
    entries: function () { return entries.slice(); }
  };
})();
