// A small fake DOM tree with geometry, styles and stacking, for the phone's page scripts (apps/android/app/src/main/
// assets/saga: tools.js, overlay.js). 0.11.2. node(tag, { attrs, text, rect, z, position, kids }) builds an element;
// page(root, { width, height }) gives { document, window, all }. elementFromPoint returns the topmost element under a
// point: the highest z (inherited from the nearest ancestor that sets one), then the latest in document order.
const SEL = /^(\w+)?((?:\[[^\]]+\])*)(:not\(\[type=hidden\]\))?$/;

function matchOne(el, sel) {
  const m = SEL.exec(sel.trim());
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  for (const a of (m[2] || '').match(/\[[^\]]+\]/g) || []) {
    const [k, v] = a.slice(1, -1).split('=');
    const have = el.getAttribute(k);
    if (have === null || (v !== undefined && have !== v.replace(/"/g, ''))) return false;
  }
  return !(m[3] && el.getAttribute('type') === 'hidden');
}
const matches = (el, sel) => sel.split(/,(?![^(]*\))/).some((s) => matchOne(el, s));

function node(tag, o = {}) {
  const attrs = { ...(o.attrs || {}) };
  const el = {
    tagName: tag.toUpperCase(), kids: [], parentElement: null, rect: o.rect || { left: 0, top: 0, width: 10,
      height: 10 }, z: o.z, position: o.position || 'static', disabled: false, isContentEditable: false, form: null,
    id: attrs.id || '', value: '', type: attrs.type || '', href: attrs.href || '', ownText: o.text || '',
    getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; }, hasAttribute: (k) => k in attrs,
    getBoundingClientRect: () => ({ ...el.rect }), scrollIntoView() {}, focus() {}, click() { el.clicked = true; },
    dispatchEvent: () => true, closest: () => null,
    contains: (x) => { for (let p = x; p; p = p.parentElement) if (p === el) return true; return false; },
    querySelectorAll: (sel) => descendants(el).filter((d) => matches(d, sel)),
    querySelector: (sel) => descendants(el).find((d) => matches(d, sel)) || null,
  };
  Object.defineProperty(el, 'textContent', { get: () => [el.ownText, ...el.kids.map((k) => k.textContent)]
    .filter(Boolean).join(' ') });
  Object.defineProperty(el, 'innerText', { get: () => el.textContent });
  (o.kids || []).forEach((k) => { k.parentElement = el; el.kids.push(k); });
  return el;
}
function descendants(el) { const out = []; el.kids.forEach((k) => { out.push(k, ...descendants(k)); }); return out; }
function zOf(el) { for (let p = el; p; p = p.parentElement) if (p.z !== undefined) return p.z; return 0; }

function page(root, o = {}) {
  const W = o.width || 400, H = o.height || 800;
  const html = node('html', { rect: { left: 0, top: 0, width: W, height: H } });
  const body = root.tagName === 'BODY' ? root : node('body', { rect: { left: 0, top: 0, width: W, height: H },
    kids: [root] });
  body.parentElement = html; html.kids.push(body);
  const all = () => descendants(body);
  const document = {
    title: o.title || 'Page', body, documentElement: html, activeElement: body,
    querySelectorAll: (sel) => all().filter((e) => matches(e, sel)),
    querySelector: (sel) => all().find((e) => matches(e, sel)) || null,
    getElementById: (id) => all().find((e) => e.getAttribute('id') === id) || null,
    getElementsByTagName: () => ({ length: all().length }),
    elementFromPoint: (x, y) => {
      let best = null, bz = -Infinity;
      all().forEach((e) => {
        const r = e.rect;
        if (x < r.left || x > r.left + r.width || y < r.top || y > r.top + r.height || r.width < 1) return;
        const z = zOf(e);
        if (z >= bz) { best = e; bz = z; }
      });
      return best;
    },
  };
  class Ev { constructor(type, init) { this.type = type; this.init = init; } }
  const window = { location: { href: o.url || 'https://www.google.com/search?q=yolotask' }, innerWidth: W,
    innerHeight: H, scrollY: 0, visualViewport: { offsetLeft: 0, offsetTop: 0, width: W, height: H },
    getComputedStyle: (e) => ({ visibility: 'visible', display: 'block', opacity: '1',
      position: e.position || 'static' }),
    HTMLInputElement: { prototype: {} }, HTMLTextAreaElement: { prototype: {} }, HTMLSelectElement: { prototype: {} },
    Event: Ev, KeyboardEvent: Ev, MouseEvent: Ev, PointerEvent: Ev, scrollTo() {}, scrollBy() {} };
  return { document, window, all };
}

module.exports = { node, page, matches };
