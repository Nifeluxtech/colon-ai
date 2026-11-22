/* Colon AI · Workspace terminal commands (v0.27.0, Workspace step 3; docs/workspace/step-3.md). A small shell
   over the workspace's own files: ls, cd, cat, touch, echo > file, mv, cp, rm, grep, find, tree… plus `node`/`js`
   and `python`/`py`, which run code on the phone through lib/ws-runner.js. Nothing here runs on the server: file
   commands call the same Workspace API as the Files tab (each change is a new version you can undo in History).
   DOM-free; the I/O comes in through `io` so it is unit-tested in packages/ui/test/ws-shell.test.js.
   createShell(io) -> { exec(line) -> Promise, prompt() }
   io = { fs: { list() -> [{path,size}], read(p) -> {content, encoding}, write(p, text, note), remove(p),
          move(a, b) }, run(lang, code, {repl, cwd, onOut}) -> Promise, files() -> Promise<{path: text}>,
          print(kind, text) kind: out | err | info | cmd, clear(), open(path) } */

var HELP = [
  'Files:   ls [dir]  tree  cd <dir>  pwd  cat <file>  head [-n N] <file>  wc <file>',
  '         touch <file>  echo <text> > <file>  echo <text> >> <file>  mv <from> <to>  cp <from> <to>  rm <file>',
  '         grep <text> [dir]  find [name]  open <page.html>',
  'Code:    node / js           start a JavaScript prompt (exit to leave)',
  '         node <file.js>      run a script        js <code>       run one line',
  '         python / py         start a Python prompt   python -c "<code>"   run one line',
  'Other:   clear  history  help',
  'Code runs on your phone, not on a server. Python loads once (about 10 MB). File changes are saved as versions.',
].join('\n');

/** 'echo "a b" > x' -> ['echo', 'a b', '>', 'x'] */
function tokenize(line) {
  var out = [], cur = '', q = null, has = false, s = String(line);
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (q) {
      if (ch === q) q = null;
      else if (ch === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) { out.push(cur); cur = ''; has = false; } continue; }
    if (ch === '>') {
      if (cur || has) { out.push(cur); cur = ''; has = false; }
      if (s[i + 1] === '>') { out.push('>>'); i++; } else out.push('>');
      continue;
    }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** cwd "css", arg "../img/a.png" -> "img/a.png"; null when it climbs above the site. */
function joinPath(cwd, arg) {
  var a = String(arg || '');
  var parts = a.charAt(0) === '/' || a.charAt(0) === '~' ? [] : String(cwd || '').split('/').filter(Boolean);
  a = a.replace(/^~\/?/, '');
  var bad = false;
  a.split('/').forEach(function (s) {
    if (!s || s === '.') return;
    if (s === '..') { if (parts.length) parts.pop(); else bad = true; } else parts.push(s);
  });
  return bad ? null : parts.join('/');
}

// Code after -e / -c: the rest of the line as typed, without one pair of wrapping quotes.
function unq(s) {
  var t = String(s).trim(), q = t.charAt(0);
  return t.length > 1 && (q === '"' || q === "'") && t.charAt(t.length - 1) === q ? t.slice(1, -1) : t;
}

function dirsOf(list) {
  var d = {};
  list.forEach(function (f) {
    var p = f.path.split('/');
    for (var i = 1; i < p.length; i++) d[p.slice(0, i).join('/')] = 1;
  });
  return d;
}

function createShell(io) {
  var cwd = '', hist = [], repl = null, buf = [];
  function out(t) { io.print('out', t); }
  function err(t) { io.print('err', t); }
  function prompt() {
    if (repl) return buf.length ? '... ' : repl === 'py' ? '>>> ' : '> ';
    return '~' + (cwd ? '/' + cwd : '') + ' $ ';
  }
  function need(args, n, usage) { if (args.length < n) { err('Usage: ' + usage); return false; } return true; }
  function path(a) { var p = joinPath(cwd, a); if (p === null) err('“' + a + '” is outside your site.'); return p; }
  function list() { return Promise.resolve(io.fs.list()); }
  function readText(p) {
    return Promise.resolve(io.fs.read(p)).then(function (f) {
      if (f.encoding === 'base64') throw new Error(p + ' is a binary file (image or font).');
      return String(f.content);
    });
  }
  function runCode(lang, code, isRepl) {
    return io.files().then(function (files) {
      return io.run(lang, code, { repl: isRepl, cwd: cwd, files: files,
        onOut: function (k, t) { io.print(k === 'info' ? 'info' : k, t); } });
    });
  }

  var CMDS = {
    help: function () { out(HELP); },
    clear: function () { io.clear(); },
    history: function () {
      out(hist.map(function (h, i) { return String(i + 1).padStart(4) + '  ' + h; }).join('\n'));
    },
    pwd: function () { out('/' + cwd); },
    ls: function (a) {
      var dir = a[0] ? path(a[0]) : cwd;
      if (dir === null) return;
      return list().then(function (fs) {
        var pre = dir ? dir + '/' : '', seen = {}, rows = [];
        fs.forEach(function (f) {
          if (f.path.indexOf(pre) !== 0) return;
          var rest = f.path.slice(pre.length), i = rest.indexOf('/'), name = i < 0 ? rest : rest.slice(0, i) + '/';
          if (!seen[name]) { seen[name] = 1; rows.push(name); }
        });
        if (dir && !rows.length) return err('ls: no folder “' + a[0] + '”.');
        out(rows.sort().join('\n') || '(no files)');
      });
    },
    tree: function () {
      return list().then(function (fs) { out(fs.map(function (f) { return f.path; }).sort().join('\n')); });
    },
    cd: function (a) {
      var p = a[0] ? path(a[0]) : '';
      if (p === null) return;
      return list().then(function (fs) {
        if (p && !dirsOf(fs)[p]) return err('cd: no folder “' + a[0] + '”.');
        cwd = p;
      });
    },
    cat: function (a) {
      if (!need(a, 1, 'cat <file>')) return;
      var p = path(a[0]); if (p === null) return;
      return readText(p).then(out);
    },
    head: function (a) {
      var n = 10;
      if (a[0] === '-n') { n = Math.max(1, parseInt(a[1], 10) || 10); a = a.slice(2); }
      if (!need(a, 1, 'head [-n N] <file>')) return;
      var p = path(a[0]); if (p === null) return;
      return readText(p).then(function (t) { out(t.split('\n').slice(0, n).join('\n')); });
    },
    wc: function (a) {
      if (!need(a, 1, 'wc <file>')) return;
      var p = path(a[0]); if (p === null) return;
      return readText(p).then(function (t) {
        out(t.split('\n').length + ' lines  ' + (t.match(/\S+/g) || []).length + ' words  ' + t.length
          + ' chars  ' + p);
      });
    },
    touch: function (a) {
      if (!need(a, 1, 'touch <file>')) return;
      var p = path(a[0]); if (p === null) return;
      return list().then(function (fs) {
        if (fs.some(function (f) { return f.path === p; })) return;
        return io.fs.write(p, '', 'Created ' + p + ' (terminal)').then(function () { out('Created ' + p); });
      });
    },
    echo: function (a) {
      var i = a.indexOf('>'), j = a.indexOf('>>'), k = j > -1 ? j : i;
      if (k < 0) return out(a.join(' '));
      var text = a.slice(0, k).join(' ') + '\n', p = a[k + 1] && path(a[k + 1]);
      if (!a[k + 1]) return err('echo: give a file after ' + a[k]);
      if (p === null) return;
      var prev = j > -1 ? readText(p).catch(function () { return ''; }) : Promise.resolve('');
      return prev.then(function (old) { return io.fs.write(p, old + text, 'Edited ' + p + ' (terminal)'); })
        .then(function () { io.print('info', (j > -1 ? 'Appended to ' : 'Wrote ') + p); });
    },
    rm: function (a) {
      if (!need(a, 1, 'rm <file>')) return;
      var p = path(a[0]); if (p === null) return;
      return Promise.resolve(io.fs.remove(p)).then(function () {
        io.print('info', 'Deleted ' + p + '. Undo it in History.');
      });
    },
    mv: function (a) {
      if (!need(a, 2, 'mv <from> <to>')) return;
      var f = path(a[0]), t = path(a[1]); if (f === null || t === null) return;
      return list().then(function (fs) {
        if (dirsOf(fs)[t]) t = t + '/' + f.split('/').pop();
        return io.fs.move(f, t);
      }).then(function () { io.print('info', 'Moved ' + f + ' → ' + t); });
    },
    cp: function (a) {
      if (!need(a, 2, 'cp <from> <to>')) return;
      var f = path(a[0]), t = path(a[1]); if (f === null || t === null) return;
      return list().then(function (fs) {
        if (dirsOf(fs)[t]) t = t + '/' + f.split('/').pop();
        return readText(f);
      }).then(function (text) { return io.fs.write(t, text, 'Copied ' + f + ' to ' + t + ' (terminal)'); })
        .then(function () { io.print('info', 'Copied ' + f + ' → ' + t); });
    },
    grep: function (a) {
      if (!need(a, 1, 'grep <text> [dir]')) return;
      var needle = a[0].toLowerCase(), dir = a[1] ? path(a[1]) : cwd;
      if (dir === null) return;
      return io.files().then(function (files) {
        var hits = [];
        Object.keys(files).sort().forEach(function (p) {
          if (dir && p.indexOf(dir + '/') !== 0 && p !== dir) return;
          files[p].split('\n').forEach(function (l, n) {
            if (l.toLowerCase().indexOf(needle) > -1) hits.push(p + ':' + (n + 1) + ': ' + l.trim().slice(0, 160));
          });
        });
        out(hits.slice(0, 200).join('\n') || 'No matches.');
      });
    },
    find: function (a) {
      var n = (a[0] || '').toLowerCase().replace(/\*/g, '');
      return list().then(function (fs) {
        out(fs.map(function (f) { return f.path; }).filter(function (p) { return p.toLowerCase().indexOf(n) > -1; })
          .sort().join('\n') || 'Nothing found.');
      });
    },
    open: function (a) {
      if (!need(a, 1, 'open <page.html>')) return;
      var p = path(a[0]); if (p === null) return;
      io.open(p);
    },
    node: function (a, raw) {
      if (!a.length) { repl = 'js'; io.print('info', 'JavaScript prompt. Type exit to leave.'); return; }
      if (a[0] === '-e' || a[0] === '-p') return runCode('js', unq(raw.slice(2)), true);
      var p = path(a[0]); if (p === null) return;
      return readText(p).then(function (code) { return runCode('js', code, false); });
    },
    js: function (a, raw) { return a.length ? runCode('js', raw, true) : CMDS.node([]); },
    python: function (a, raw) {
      if (!a.length) { repl = 'py'; io.print('info', 'Python prompt. Type exit() to leave.'); return; }
      if (a[0] === '-c') return runCode('py', unq(raw.slice(2)), true);
      if (/\.py$/i.test(a[0])) {
        return err('Website workspaces can’t store .py files. Use python -c "…" or the python prompt.');
      }
      return runCode('py', raw, true);
    },
  };
  CMDS.py = CMDS.python; CMDS.python3 = CMDS.python; CMDS.dir = CMDS.ls; CMDS.cls = CMDS.clear; CMDS.type = CMDS.cat;

  function replLine(line) {
    var t = line.trim();
    if (!buf.length && /^(exit(\(\))?|quit(\(\))?|\.exit)$/.test(t)) { repl = null; return Promise.resolve(); }
    if (repl === 'py' && (buf.length || /:\s*$/.test(t))) {
      if (t) { buf.push(line); return Promise.resolve(); }
      var code = buf.join('\n'); buf = [];
      return runCode('py', code, true);
    }
    if (!t) return Promise.resolve();
    return runCode(repl, line, true);
  }

  function exec(line) {
    io.print('cmd', prompt() + line);
    if (repl) return replLine(line).catch(function (e) { err(e.message); });
    var t = String(line).trim();
    if (!t) return Promise.resolve();
    hist.push(t); if (hist.length > 200) hist.shift();
    var a = tokenize(t), c = a.shift(), fn = CMDS[c.toLowerCase()], raw = t.replace(/^\S+\s*/, '');
    if (!fn) { err(c + ': command not found. Type help to see what you can do.'); return Promise.resolve(); }
    return Promise.resolve().then(function () { return fn(a, raw); })
      .catch(function (e) { err(c + ': ' + e.message); });
  }
  return { exec: exec, prompt: prompt, history: function () { return hist.slice(); } };
}

export { createShell, joinPath, tokenize, HELP };
