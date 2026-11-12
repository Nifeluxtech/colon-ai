/* Colon AI · Server-Sent Events reader for streamed replies (guest and account chats). */

/* ---------- Streaming (SSE) reader shared by Remote and Guest ---------- */
// Hardened: a non-stream answer (e.g. a hosting firewall page), a stream that goes silent, or one that ends
// without "done"/"error" becomes a clear error instead of leaving "Colon Saga is thinking…" forever.
var SSE_STALL_MS = 90000;
function readSSE(res, emit) {
  if (!res.ok) return res.json().catch(function () { return {}; }).then(function (d) { throw Object.assign(new Error(
    d.message || 'Colon Saga couldn’t answer.'), { code: d.error, status: res.status, field: d.field }); });
  var type = String((res.headers && res.headers.get('content-type')) || '');
  if (type && type.indexOf('text/event-stream') < 0) {
    if (res.body && res.body.cancel) res.body.cancel().catch(function () {});
    return Promise.reject(Object.assign(new Error((
      'Colon couldn’t reach its server properly (the connection was intercepted). Please reload the page and try '
      + 'again.')), { code: 'bad_response' }));
  }
  var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', last = null, finished = false, stalled = false,
    timer = null;
  function arm() {
    clearTimeout(timer);
    timer = setTimeout(function () { stalled = true; reader.cancel().catch(function () {}); }, SSE_STALL_MS);
  }
  function pump() {
    arm();
    return reader.read().then(function (r) {
      if (r.done) {
        clearTimeout(timer);
        if (stalled) throw Object.assign(new Error('Colon Saga took too long to answer. Please try again.'),
          { code: 'timeout' });
        if (!finished) throw Object.assign(new Error(
          'This reply didn’t finish — the connection closed early. Please try again.'), { code: 'incomplete' });
        return last;
      }
      buf += dec.decode(r.value, { stream: true });
      var parts = buf.split(/\n\n/); buf = parts.pop();
      parts.forEach(function (block) {
        var ev = 'message', data = '';
        block.split('\n').forEach(function (l) { if (l.indexOf('event:') === 0) ev = l.slice(6).trim();
          else if (l.indexOf('data:') === 0) data += l.slice(5).trim(); });
        if (!data) return;  // keep-alive comments
        var d = {}; try { d = JSON.parse(data); } catch (e) { return; }
        if (ev === 'error') { finished = true; throw Object.assign(new Error(d.message
          || 'Colon Saga couldn’t answer.'), { code: d.code }); }
        if (ev === 'done') { finished = true; last = d.message; }
        emit(Object.assign({ type: ev }, d));
      });
      return pump();
    }, function (e) { clearTimeout(timer); throw e; }).catch(function (e) { clearTimeout(timer); throw e; });
  }
  return pump();
}
function offline(e) { if (e && e.name === 'AbortError') throw e; if (e instanceof TypeError) throw Object.assign(
  new Error('Can’t reach Colon right now. Check your connection.'), { code: 'offline' }); throw e; }

export { offline, readSSE };
