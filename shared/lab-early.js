// AmpliLab tooling, NOT part of any Amplitude wiring.
// Load this FIRST in <head>, before any Amplitude script, so that:
//   1. the run_id is known before the SDK sends its first event, and
//   2. the network tap is in place before the SDK grabs fetch / XMLHttpRequest / sendBeacon.
// It records every request to *.amplitude.com made from the page's main thread, decodes the payload
// (including gzip bodies) and the response, and hands them to shared/lab.js via the 'lab:net' event.
// Limitation: requests made from Web Workers (Session Replay uploads) are invisible to it.
(function () {
  'use strict';

  // ---------- run_id ----------
  // Comes from ?run=… in the URL, else from localStorage (shared by all pages of the lab on this origin).
  var RUN_KEY = 'amplilab_run_id';
  var fromUrl = new URLSearchParams(location.search).get('run');
  if (fromUrl) try { localStorage.setItem(RUN_KEY, fromUrl); } catch (e) {}
  var runId = fromUrl || (function () { try { return localStorage.getItem(RUN_KEY) || ''; } catch (e) { return ''; } })();

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

  window.LabEarly = {
    runId: function () { return runId; },
    setRunId: function (id) {
      runId = String(id || '').trim();
      try { runId ? localStorage.setItem(RUN_KEY, runId) : localStorage.removeItem(RUN_KEY); } catch (e) {}
      return runId;
    },
    entries: function () { return entries.slice(); }
  };
})();
