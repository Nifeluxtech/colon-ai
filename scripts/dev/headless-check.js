// Headless mobile (360x780) checks of the three web apps against a running API (mock provider is fine).
//   node scripts/dev/headless-check.js <label> <chatPort> <browserPort> <adminPort> <apiUrl>
// Serve docroots built by scripts/deploy/build-docroot.sh with scripts/dev/static-server.js first. The API must
// allow the three http://localhost:<port> origins (ALLOWED_ORIGINS). Playwright is not a repo dependency:
// point PLAYWRIGHT at an install (default: require('playwright')). Screenshots and report.json go to
// $OUT_DIR/<label> (default /tmp/colon-headless). Compare two labels with any image diff tool.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const [label, cp, bp, ap, API] = process.argv.slice(2);
const OUT = `${process.env.OUT_DIR || '/tmp/colon-headless'}/${label}`;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const report = { label, checks: [], errors: [], http: [] };
const ok = (name, pass, info) => { report.checks.push({ name, pass: !!pass, info }); };
const EMAIL = `ada.${Date.now()}@example.com`;

async function ctxFor(b, app) {
  const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 1, reducedMotion: 'reduce', timezoneId: 'Africa/Lagos', locale: 'en-GB' });
  await ctx.addInitScript((api) => { window.COLON_API = api; sessionStorage.setItem('colonIntroSeen', '1'); }, API);
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') report.errors.push(`${app} console: ${m.text()}`); });
  p.on('pageerror', e => report.errors.push(`${app} pageerror: ${e.message}`));
  p.on('response', (r) => {
    if (r.status() >= 400) report.http.push(`${app} ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  p.on('requestfailed', r => report.errors.push(`${app} requestfailed: ${r.url()} ${r.failure().errorText}`));
  return { ctx, p };
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
async function register(p, email, name) {
  return p.evaluate(async ([api, email, name]) => {
    const r = await fetch(api + '/auth/register', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Colon-Client': 'chat' },
      body: JSON.stringify({ email, password: 'pass1234word', name, language: 'en', accept_terms: true }) });
    await r.text(); return r.status;
  }, [API, email, name]);
}
async function sendAndWait(p, text, n) {
  const sse = p.waitForResponse(r => /\/(chat\/guest|messages)$/.test(new URL(r.url()).pathname) && r.request().method(
    ) === 'POST', { timeout: 15000 });
  await p.fill('#cw-input', text); await p.click('[data-a="send"]');
  const r = await sse; const ct = r.headers()['content-type'] || '';
  await p.waitForFunction((t) => document.body.innerText.includes('Mock reply'), null, { timeout: 15000 }).catch(() => {
    });
  await p.waitForTimeout(1500);
  const body = await p.evaluate(() => document.body.innerText);
  ok(n, ct.includes('text/event-stream') && /Mock reply/.test(body), { status: r.status(), ct, sample: (body.match(
    /Mock reply[^\n]*/) || [''])[0] });
  await shot(p, n);
}

(async () => {
  const b = await chromium.launch();
  // ---- Chat (guest)
  let { ctx, p } = await ctxFor(b, 'chat');
  await p.goto(`http://localhost:${cp}/`); await p.waitForSelector('#cw-input', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  ok('chat welcome renders', await p.isVisible('#cw-input') && await p.isVisible('.cw'), await p.title());
  await shot(p, '01-chat-welcome');
  await p.click('[data-a="sidebar"]'); await p.waitForTimeout(800);
  ok('chat drawer opens', await p.evaluate(() => document.querySelector('.cw').classList.contains('drawer-open') &&
    document.querySelector('#cw-side').getBoundingClientRect().left >= -1));
  await shot(p, '02-chat-drawer');
  await p.click('#cw-side [data-a="drawer-close"]'); await p.waitForTimeout(600);
  await p.goto(`http://localhost:${cp}/#/settings`); await p.waitForTimeout(1200);
  ok('chat settings (guest) opens', /log in|Settings/i.test(await p.evaluate(() => document.body.innerText)));
  await shot(p, '03-chat-settings-guest');
  await p.goto(`http://localhost:${cp}/#/`); await p.waitForTimeout(1200);
  await sendAndWait(p, 'Hello from a guest', '04-chat-guest-reply');
  // ---- Chat (signed in)
  const st = await register(p, EMAIL, 'Ada Test'); ok('chat register', st === 201, st);
  await p.goto(`http://localhost:${cp}/#/`); await p.reload(); await p.waitForSelector('#cw-input');
    await p.waitForTimeout(1500);
  await shot(p, '05-chat-signed-in');
  await p.click('[data-a="more"]'); await p.waitForTimeout(500);
  await shot(p, '06-chat-more-menu');
  await p.getByRole('menuitem', { name: 'Settings' }).click().catch(async () => { await p.click('text=Settings'); });
  await p.waitForTimeout(1200);
  ok('chat settings opens (signed in)', /Settings/.test(await p.title()) || await p.isVisible('.set-row'),
    await p.title());
  // Settings opens in the chat's scroll box, which keeps the thread's offset; start at the top so runs compare.
  await p.evaluate(() => document.querySelectorAll('.cw-scroll').forEach((e) => { e.scrollTop = 0; }));
  await shot(p, '07-chat-settings');
  await p.goto(`http://localhost:${cp}/#/`); await p.waitForTimeout(1000);
  await sendAndWait(p, 'Hello from Ada', '08-chat-user-reply');
  let j = 0;
  for (const r of ['/history', '/saved', '/explore', '/help', '/account']) {
    await p.goto(`http://localhost:${cp}/#${r}`); await p.waitForTimeout(1200); await shot(p, `09${'abcde'[
      j++]}-chat${r.replace(/\//g, '-')}`);
  }
  await ctx.close();
  // ---- Browser
  ({ ctx, p } = await ctxFor(b, 'browser'));
  await p.goto(`http://localhost:${bp}/`); await p.waitForTimeout(2500);
  await shot(p, '10-browser-signed-out');
  ok('browser signed-out screen renders', (await p.evaluate(() => document.getElementById(
    'app').innerText)).length > 20);
  ok('browser register', (await register(p, 'b.' + EMAIL, 'Ben Test')) === 201);
  await p.goto(`http://localhost:${bp}/#/`); await p.reload(); await p.waitForTimeout(2500);
  ok('browser app home renders', await p.isVisible('[data-host]') || await p.isVisible('.cb'), await p.title());
  await shot(p, '11-browser-home');
  j = 0;
  for (const r of ['/tabs', '/bookmarks', '/history', '/downloads', '/ai', '/settings', '/help']) {
    await p.goto(`http://localhost:${bp}/#${r}`); await p.waitForTimeout(1200); await shot(p, `11${'abcdefg'[
      j++]}-browser${r.replace(/\//g, '-')}`);
  }
  await ctx.close();
  // ---- Admin
  ({ ctx, p } = await ctxFor(b, 'admin'));
  await p.goto(`http://localhost:${ap}/`); await p.waitForTimeout(2500);
  ok('admin login screen renders', await p.isVisible('input[type="email"], input[name="email"]'), await p.title());
  await shot(p, '12-admin-login');
  // Signed in as the owner (OWNER_EMAIL, default owner@example.com) on a fresh database: every admin screen.
  if (process.env.ADMIN_PAGES !== '0') {
    const owner = process.env.OWNER_EMAIL || 'owner@example.com';
    ok('admin owner register', (await register(p, owner, 'Owner Test')) === 201);
    let i = 20;
    for (const r of ['/', '/users', '/moderation', '/models', '/routing', '/limits', '/evaluation', '/registry',
      '/voice', '/browser', '/system', '/security', '/security?tab=audit', '/more']) {
      await p.goto(`http://localhost:${ap}/#${r}`); if (r === '/') await p.reload();
      await p.waitForTimeout(1500);
      await shot(p, `${i++}-admin${r.replace(/[/?=]/g, '-')}`);
    }
    ok('admin pages render', !(await p.evaluate(() => document.body.innerText)).includes('Please refresh'));
  }
  await ctx.close();
  await b.close();
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  if (report.errors.length || report.http.length || report.checks.some(c => !c.pass)) process.exitCode = 1;
})().catch(e => { console.error('FATAL', e); fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  process.exit(1); });

