/* Colon AI · Workspace code runner (v0.27.0, Workspace step 3; docs/workspace/step-3.md). Runs JavaScript and
   Python for the Terminal tab ON THE USER'S PHONE, never on the server. A hidden iframe with
   sandbox="allow-scripts" (an opaque origin: no cookies, no Colon session, no access to the app) owns the Web
   Workers that run the code, so a runaway loop can be stopped by terminating its worker, and code can't reach
   the user's account. JavaScript: one fresh worker per run, stopped after JS_MS. Python: Pyodide (free,
   CPython compiled to WebAssembly) from jsDelivr, loaded once on first use (~10 MB), kept warm between runs and
   restarted after a stop. The site's text files are copied into Python's /site folder (its working folder) and
   into `files` for JavaScript, so scripts can read them; changes made there are not saved back.
   createRunner() -> { run(lang, code, opts) -> Promise<{ok}>, stop(), dispose() }
   opts: { files: {path: text}, repl: bool (print the last value), onOut(kind, text) kind: out | err | info } */

// 0.29.x: the last line that runs in a classic worker (newer ones need module workers, which an opaque-origin
// sandbox can't start).
var PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/';
var JS_MS = 15000, PY_MS = 60000, PY_BOOT_MS = 120000;

var JS_WORKER = [
  'function fmt(a,top){if(typeof a==="string")return top?a:JSON.stringify(a);if(typeof a==="function")',
  'return "[Function "+(a.name||"anonymous")+"]";if(a instanceof Error)return a.stack||String(a);',
  'try{var s=JSON.stringify(a);if(s&&s.length>80)s=JSON.stringify(a,null,2);return s===undefined?String(a):s}',
  'catch(e){return String(a)}}',
  'function out(t,args){postMessage({type:t,text:[].map.call(args,function(a){return fmt(a,1)}).join(" ")})}',
  'console.log=console.info=console.debug=function(){out("out",arguments)};',
  'console.warn=console.error=function(){out("err",arguments)};',
  'onmessage=async function(e){var d=e.data;self.files=d.files||{};try{var r=(0,eval)(d.code);',
  'if(r&&typeof r.then==="function")r=await r;if(d.repl&&r!==undefined)postMessage({type:"out",text:fmt(r)});',
  'postMessage({type:"done",ok:true})}catch(x){postMessage({type:"err",text:String(x&&x.stack||x)});',
  'postMessage({type:"done",ok:false})}};',
].join('\n');

var PY_WORKER = [
  'var py=null;',
  'async function boot(){if(py)return py;',
  'postMessage({type:"info",text:"Loading Python (first time only, about 10 MB)…"});',
  'if(typeof loadPyodide==="undefined"){var r=await fetch(' + JSON.stringify(PYODIDE + 'pyodide.js') + ');',
  'if(!r.ok)throw new Error("Python couldn’t download ("+r.status+").");(0,eval)(await r.text())}',
  'py=await loadPyodide({indexURL:' + JSON.stringify(PYODIDE) + '});',
  'py.setStdout({batched:function(s){postMessage({type:"out",text:s})}});',
  'py.setStderr({batched:function(s){postMessage({type:"err",text:s})}});postMessage({type:"booted"});return py}',
  'onmessage=async function(e){var d=e.data;try{var p=await boot();var fs=p.FS;',
  'try{fs.mkdirTree("/site")}catch(x){}Object.keys(d.files||{}).forEach(function(k){var i=k.lastIndexOf("/");',
  'if(i>0)fs.mkdirTree("/site/"+k.slice(0,i));fs.writeFile("/site/"+k,d.files[k])});',
  'try{fs.chdir("/site/"+(d.cwd||""))}catch(x){fs.chdir("/site")}',
  'try{await p.loadPackagesFromImports(d.code)}catch(x){}',
  'var r=await p.runPythonAsync(d.code);if(d.repl&&r!==undefined&&r!==null){',
  'postMessage({type:"out",text:r&&r.toString?r.toString():String(r)})}if(r&&r.destroy)r.destroy();',
  'postMessage({type:"done",ok:true})}catch(x){var m=String(x&&x.message||x);',
  'postMessage({type:"err",text:m.replace(/^Traceback[\\s\\S]*?File "<exec>"/,"File \\"<exec>\\"").trim()});',
  'postMessage({type:"done",ok:false})}};',
].join('\n');

var HOST = [
  'var jsw=null,pyw=null,booted=false;',
  'function mk(src){return new Worker(URL.createObjectURL(new Blob([src],{type:"text/javascript"})))}',
  'function up(m){parent.postMessage(Object.assign({colonRun:1},m),"*")}',
  'function wire(w,id,lang){w.onmessage=function(e){var d=e.data;if(d.type==="booted"){booted=true;up({id:id,',
  'type:"booted"});return}up(Object.assign({id:id},d))};w.onerror=function(e){e.preventDefault();',
  'up({id:id,type:"err",text:String(e.message||"The runner failed.")});up({id:id,type:"done",ok:false})}}',
  'addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data||{};',
  'if(d.op==="stop"){if(jsw){jsw.terminate();jsw=null}if(d.lang==="py"&&pyw){pyw.terminate();pyw=null;',
  'booted=false}return}if(d.op!=="run")return;try{if(d.lang==="py"){if(!pyw)pyw=mk(PYSRC);wire(pyw,d.id);',
  'pyw.postMessage(d)}else{if(jsw)jsw.terminate();jsw=mk(JSSRC);wire(jsw,d.id);jsw.postMessage(d)}}',
  'catch(x){up({id:d.id,type:"err",text:"Code can’t run here: "+x.message});up({id:d.id,type:"done",ok:false})}});',
  'up({type:"ready"});',
].join('\n');

function srcdoc() {
  return '<!doctype html><meta charset="utf-8"><script>var JSSRC=' + JSON.stringify(JS_WORKER).replace(/</g, '\\u003c')
    + ';var PYSRC=' + JSON.stringify(PY_WORKER).replace(/</g, '\\u003c') + ';\n' + HOST + '\n</script>';
}

function createRunner() {
  var frame = document.createElement('iframe'), seq = 0, cur = null, booted = false;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  var ready = new Promise(function (resolve) {
    function onReady(e) {
      if (e.source === frame.contentWindow && e.data && e.data.colonRun && e.data.type === 'ready') {
        window.removeEventListener('message', onReady); resolve();
      }
    }
    window.addEventListener('message', onReady);
  });
  function onMsg(e) {
    var d = e.data;
    if (e.source !== frame.contentWindow || !d || !d.colonRun || !cur || d.id !== cur.id) return;
    if (d.type === 'booted') { booted = true; cur.arm(PY_MS); return; }
    if (d.type === 'done') { finish(d.ok); return; }
    cur.onOut(d.type, String(d.text == null ? '' : d.text));
  }
  window.addEventListener('message', onMsg);
  frame.srcdoc = srcdoc();
  document.body.appendChild(frame);

  function finish(ok) {
    if (!cur) return;
    var c = cur; cur = null; clearTimeout(c.timer); c.resolve({ ok: ok });
  }
  function stop(why) {
    if (!cur) return;
    frame.contentWindow.postMessage({ op: 'stop', lang: cur.lang }, '*');
    if (cur.lang === 'py') booted = false;
    cur.onOut('err', why || 'Stopped.');
    finish(false);
  }
  function run(lang, code, opts) {
    opts = opts || {};
    if (cur) stop();
    var id = ++seq;
    return ready.then(function () {
      return new Promise(function (resolve) {
        cur = { id: id, lang: lang, resolve: resolve, onOut: opts.onOut || function () {}, timer: 0,
          arm: function (ms) {
            clearTimeout(this.timer);
            this.timer = setTimeout(function () {
              stop('Stopped after ' + Math.round(ms / 1000) + ' seconds. Long or endless loops can’t run here.');
            }, ms);
          } };
        cur.arm(lang === 'js' ? JS_MS : booted ? PY_MS : PY_BOOT_MS);
        frame.contentWindow.postMessage({ op: 'run', id: id, lang: lang, code: String(code), repl: !!opts.repl,
          files: opts.files || {}, cwd: opts.cwd || '' }, '*');
      });
    });
  }
  function dispose() {
    if (cur) stop();
    window.removeEventListener('message', onMsg);
    frame.remove();
  }
  return { run: run, stop: function () { stop(); }, dispose: dispose, busy: function () { return !!cur; } };
}

export { createRunner };
