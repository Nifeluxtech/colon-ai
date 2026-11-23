/* Colon AI · Workspace packages for the Terminal (v0.30.1). `npm install` and `pip install` without a server:
   - npm: looks the package up on the npm registry and records it in package.json "dependencies". Pages load it
     from esm.sh (free CDN that serves npm packages as browser modules) through an import map that Preview and
     Publish add to every page, so `import { createClient } from '@supabase/supabase-js'` just works in a
     <script type="module">. In `node`, use `await import('name')`.
   - pip: installs into the phone's Python (Pyodide micropip: pure-Python wheels from PyPI plus Pyodide's own
     builds such as numpy and pandas) and records it in requirements.txt, which is installed again whenever
     Python starts. Packages that need Node built-ins, servers or native code can't run here.
   DOM-free (uses fetch only); unit-tested in packages/ui/test/ws-pkg.test.js.
   addPkgCommands(CMDS, h) h = { out, err, info, readText(p), write(p, text, note), runPy(code) -> Promise<{ok}> } */

var ESM = 'https://esm.sh/';
var REGISTRY = 'https://registry.npmjs.org/';
// Names people type that mean another package in the browser.
var NPM_ALIAS = { supabase: '@supabase/supabase-js', appwrite: 'appwrite', pocketbase: 'pocketbase',
  clerk: '@clerk/clerk-js' };
var NPM_NO = { node: 'Node.js is the runtime, not a package. The node command already runs JavaScript here.',
  'node.js': 'Node.js is the runtime, not a package. The node command already runs JavaScript here.',
  npm: 'npm is already built in.', express: 'express is a server; sites here are static and can’t run one.' };
var PY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,_-]+\])?([<>=!~]=?[A-Za-z0-9.*+!-]+)?$/;
var NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** "@scope/pkg@^2" -> { name: '@scope/pkg', range: '^2' } */
function splitSpec(spec) {
  var s = String(spec).trim(), i = s.lastIndexOf('@');
  return i > 0 ? { name: s.slice(0, i).toLowerCase(), range: s.slice(i + 1) } : { name: s.toLowerCase(), range: '' };
}

function parseJson(text) {
  try { var j = JSON.parse(text); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; }
  catch (e) { return null; }
}

/** package.json text -> import map object, or null when there are no dependencies. */
function importMap(pkgText) {
  var j = parseJson(pkgText || ''), deps = j && j.dependencies, imports = {}, n = 0;
  if (!deps || typeof deps !== 'object') return null;
  Object.keys(deps).forEach(function (name) {
    if (!NPM_NAME.test(name)) return;
    var v = String(deps[name] || '').replace(/^[\^~=v\s]+/, '');
    if (!/^[0-9A-Za-z.+-]*$/.test(v)) v = '';
    var url = ESM + name + (v ? '@' + v : '');
    imports[name] = url; imports[name + '/'] = url + '/'; n++;
  });
  return n ? { imports: imports } : null;
}

/** Adds <script type="importmap"> right after <head> unless the page has its own. */
function withImportMap(html, map) {
  if (!map || /<script\b[^>]*type=["']?importmap/i.test(html)) return html;
  var tag = '<script type="importmap">' + JSON.stringify(map).replace(/</g, '\\u003c') + '</script>';
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, function (h) { return h + tag; }) : tag + html;
}

/** For `node`: import('pkg') of an installed package -> import('https://esm.sh/pkg@v'). */
function rewriteImports(code, map) {
  if (!map) return code;
  return String(code).replace(/\bimport\(\s*(["'])([^"']+)\1\s*\)/g, function (all, q, spec) {
    var hit = map.imports[spec], k;
    if (!hit) {
      for (k in map.imports) {
        if (/\/$/.test(k) && spec.indexOf(k) === 0) { hit = map.imports[k] + spec.slice(k.length); break; }
      }
    }
    return hit ? 'import(' + q + hit + q + ')' : all;
  });
}

/** requirements.txt text -> ['numpy', 'requests==2.31.0'] (comments, blanks and pip options skipped). */
function reqLines(text) {
  return String(text || '').split('\n').map(function (l) { return l.replace(/#.*/, '').trim(); })
    .filter(function (l) { return l && l.charAt(0) !== '-' && PY_NAME.test(l); });
}
function pyBase(spec) { return String(spec).replace(/[\[<>=!~].*$/, '').toLowerCase().replace(/_/g, '-'); }

/** Python code that installs requirements once per Python session (it reinstalls after a Stop restarts Python). */
function pyInstallCode(list, force) {
  var L = JSON.stringify(list);
  return 'import builtins, pyodide_js\n_c_l=' + L + '\n_c_k=repr(_c_l)\n'
    + 'if ' + (force ? 'True' : 'getattr(builtins,"_colon_req",None)!=_c_k') + ':\n'
    + '  print("Installing " + ", ".join(_c_l) + "…")\n'
    + '  await pyodide_js.loadPackage("micropip")\n  import micropip\n  await micropip.install(_c_l)\n'
    + '  builtins._colon_req=_c_k\n  import importlib.metadata as _m\n'
    + '  for _n in _c_l:\n'
    + '    _b=_n.split("=")[0].split("<")[0].split(">")[0].split("[")[0].split("!")[0].split("~")[0]\n'
    + '    try: print("  " + _b + " " + _m.version(_b))\n    except Exception: print("  " + _b)\n';
}

function addPkgCommands(CMDS, h) {
  function readPkg() {
    return h.readText('package.json').catch(function () { return ''; }).then(function (t) {
      if (!t) return { name: 'site', private: true, dependencies: {} };
      var j = parseJson(t);
      if (!j) throw new Error('package.json isn’t valid JSON. Fix it in Code first.');
      return j;
    });
  }
  function savePkg(j, note) { return h.write('package.json', JSON.stringify(j, null, 2) + '\n', note); }
  function resolve(spec) {
    var s = splitSpec(spec);
    var url = REGISTRY + s.name.replace('/', '%2f') + '/' + encodeURIComponent(s.range || 'latest');
    return fetch(url).then(function (r) {
      if (r.status === 404) throw new Error('no package “' + s.name + (s.range ? '@' + s.range : '') + '” on npm.');
      if (!r.ok) throw new Error('npm registry answered ' + r.status + '.');
      return r.json();
    }).then(function (m) { return { name: s.name, version: m.version }; });
  }

  function npm(a) {
    var sub = (a[0] || '').toLowerCase(), args = a.slice(1).filter(function (x) { return x.charAt(0) !== '-'; });
    if (sub === 'i' || sub === 'install' || sub === 'add') {
      if (!args.length) return h.info('Packages in package.json load from esm.sh, so there’s nothing to download.');
      var specs = [];
      for (var i = 0; i < args.length; i++) {
        var s = splitSpec(args[i]);
        if (NPM_NO[s.name]) { h.err(NPM_NO[s.name]); continue; }
        if (NPM_ALIAS[s.name] && NPM_ALIAS[s.name] !== s.name) {
          h.info(s.name + ' → ' + NPM_ALIAS[s.name] + ' (the browser library; “' + s.name + '” is the CLI).');
          s.name = NPM_ALIAS[s.name];
        }
        if (!NPM_NAME.test(s.name)) { h.err('“' + args[i] + '” isn’t a package name.'); continue; }
        specs.push(s.name + (s.range ? '@' + s.range : ''));
      }
      if (!specs.length) return;
      return Promise.all(specs.map(resolve)).then(function (got) {
        return readPkg().then(function (j) {
          j.dependencies = j.dependencies || {};
          got.forEach(function (g) { j.dependencies[g.name] = '^' + g.version; });
          return savePkg(j, 'npm install ' + got.map(function (g) { return g.name; }).join(' ') + ' (terminal)');
        }).then(function () {
          got.forEach(function (g) { h.out('+ ' + g.name + '@' + g.version); });
          h.info('Added to package.json. In a page: <script type="module"> import … from \'' + got[0].name
            + '\' </script>. In node: await import(\'' + got[0].name + '\').');
        });
      });
    }
    if (sub === 'uninstall' || sub === 'remove' || sub === 'rm' || sub === 'un') {
      if (!args.length) return h.err('Usage: npm uninstall <package>');
      return readPkg().then(function (j) {
        var deps = j.dependencies || {}, gone = args.map(function (x) { var n = splitSpec(x).name;
          return NPM_ALIAS[n] || n; }).filter(function (n) { return deps[n]; });
        if (!gone.length) return h.err('Not in package.json: ' + args.join(' '));
        gone.forEach(function (n) { delete deps[n]; });
        return savePkg(j, 'npm uninstall ' + gone.join(' ') + ' (terminal)')
          .then(function () { gone.forEach(function (n) { h.out('- ' + n); }); });
      });
    }
    if (sub === 'ls' || sub === 'list') {
      return readPkg().then(function (j) {
        var d = j.dependencies || {};
        h.out(Object.keys(d).map(function (n) { return n + '@' + d[n]; }).join('\n') || '(no packages)');
      });
    }
    h.err('Usage: npm install <package>   npm uninstall <package>   npm ls');
  }

  function pip(a) {
    var sub = (a[0] || '').toLowerCase(), args = a.slice(1).filter(function (x) { return x.charAt(0) !== '-'; });
    function readReq() { return h.readText('requirements.txt').catch(function () { return ''; }); }
    if (sub === 'install') {
      if (a.indexOf('-r') > -1) {
        return readReq().then(function (t) { return h.runPy(pyInstallCode(reqLines(t), true)); });
      }
      var bad = args.filter(function (x) { return !PY_NAME.test(x); });
      if (bad.length) return h.err('“' + bad[0] + '” isn’t a package name.');
      if (!args.length) return h.err('Usage: pip install <package>');
      return h.runPy(pyInstallCode(args, true)).then(function (r) {
        if (!r || !r.ok) return h.err('Nothing saved. Only pure-Python packages and Pyodide’s builds work here.');
        return readReq().then(function (t) {
          var have = reqLines(t).map(pyBase), add = args.filter(function (x) { return have.indexOf(pyBase(x)) < 0; });
          if (!add.length) return;
          var text = (t && !/\n$/.test(t) ? t + '\n' : t) + add.join('\n') + '\n';
          return h.write('requirements.txt', text, 'pip install ' + add.join(' ') + ' (terminal)')
            .then(function () { h.info('Added to requirements.txt. It installs again whenever Python starts.'); });
        });
      });
    }
    if (sub === 'uninstall') {
      if (!args.length) return h.err('Usage: pip uninstall <package>');
      return readReq().then(function (t) {
        var drop = args.map(pyBase), keep = String(t).split('\n').filter(function (l) {
          var x = l.replace(/#.*/, '').trim(); return !x || drop.indexOf(pyBase(x)) < 0; });
        return h.write('requirements.txt', keep.join('\n'), 'pip uninstall ' + args.join(' ') + ' (terminal)')
          .then(function () { h.info('Removed from requirements.txt. Python forgets it after the next restart.'); });
      });
    }
    if (sub === 'list' || sub === 'freeze') {
      return h.runPy('import pyodide_js\nawait pyodide_js.loadPackage("micropip")\nimport micropip\n'
        + 'for _n,_p in sorted(micropip.list().items()): print(_n+"=="+_p.version)');
    }
    h.err('Usage: pip install <package>   pip install -r requirements.txt   pip uninstall <package>   pip list');
  }

  CMDS.npm = npm; CMDS.pnpm = npm;
  CMDS.yarn = function (a) { return npm(a[0] === 'add' || a[0] === 'remove' ? a : ['install'].concat(a)); };
  CMDS.pip = pip; CMDS.pip3 = pip;
  CMDS.npx = function () { h.err('npx runs CLI tools, which need a server. Use npm install for libraries.'); };
}

export { addPkgCommands, importMap, withImportMap, rewriteImports, reqLines, pyInstallCode, splitSpec };
