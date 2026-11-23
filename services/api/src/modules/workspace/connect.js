// Workspace connections (v0.30.0): sign-in and database services a published site talks to straight from the
// browser (Supabase, Firebase, Appwrite, PocketBase, Clerk). Only each service's PUBLIC client settings are kept
// here (a Supabase anon key, a Firebase web config...): they end up in the site's files anyway, and the service's
// own rules (Row Level Security, Firebase rules) protect the data. Private keys (a Supabase service_role key, a
// Clerk secret key) are refused here and belong in the Data tab's secret keys, used through Colon's proxy.
// recipe() tells the Workspace chat model how to build sign up / log in / log out with each connected service.
// v0.31.0: optional SERVER access per service (`server` fields: a Supabase service_role / secret key and personal
// access token, a Firebase service account, an Appwrite API key, a PocketBase superuser login) lets Colon itself work
// in the database (remote/); GitHub and Bitbucket (kind 'git') take a repository and a token (git/). Server values
// are encrypted by data.js (secret_enc) and never returned; cleanServer() checks them, keeping saved ones left empty.
const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });

const URL_RE = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[\w./-]*)?$/i;
const TOKEN = /^[\w.-]{10,2000}$/;
const field = (name, label, re, hint) => ({ name, label, re, hint });
const secret = (name, label, re, hint, more) => ({ name, label, re, hint, ...more });
const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;
const BRANCH = /^$|^(?!-)(?!.*\.\.)[\w./@+-]{1,200}(?<![/.])$/;
const FOLDER = /^$|^[\w.-]{1,64}(\/[\w.-]{1,64}){0,5}$/;
const GIT_TOKEN = /^[\x21-\x7e]{8,512}$/;
const gitFields = (hint) => [field('repo', 'Repository', REPO, hint),
  field('branch', 'Branch', BRANCH, 'main'), field('folder', 'Folder in the repository (optional)', FOLDER, 'site')];

// v0.31.0: the Supabase personal access token (sbp_) is an ACCOUNT token, not a project key: say so where it's pasted
const SBP_WARN = 'Careful: a personal access token controls your whole Supabase account (every project and '
  + 'organization you can reach), not just this database. Colon keeps it encrypted on its server, never puts it in '
  + 'your site, and uses it only for schema changes in this project (create a table, add a column) when you ask in '
  + 'Chat. Leave it empty if you’d rather create tables yourself in Supabase’s SQL editor. Create or revoke it at '
  + 'supabase.com/dashboard/account/tokens.';
const PROVIDERS = {
  supabase: { label: 'Supabase', kind: 'db', fields: [
    field('url', 'Project URL', URL_RE, 'https://xyz.supabase.co'),
    field('anonKey', 'Anon (public) key', TOKEN, 'eyJ… or sb_publishable_…')],
  server: [secret('serviceKey', 'service_role or secret key', /^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_secret_[\w-]{10,200})$/,
    'eyJ… (service_role) or sb_secret_…'), secret('accessToken', 'Personal access token (optional: lets Colon '
    + 'create and change tables)', /^sbp_[\w]{20,200}$/, 'sbp_…', { optional: true, warn: SBP_WARN })] },
  firebase: { label: 'Firebase', fields: [
    field('apiKey', 'API key', /^[\w-]{20,60}$/, 'AIza…'),
    field('authDomain', 'Auth domain', /^[a-z0-9.-]+$/i, 'project.firebaseapp.com'),
    field('projectId', 'Project ID', /^[a-z0-9-]{4,40}$/, 'my-project'),
    field('appId', 'App ID', /^[\w:.-]{6,100}$/, '1:123:web:abc'),
    field('storageBucket', 'Storage bucket (optional)', /^$|^[a-z0-9._-]+$/i, ''),
    field('messagingSenderId', 'Sender ID (optional)', /^$|^\d{4,20}$/, '')],
  server: [secret('serviceAccount', 'Service account JSON', /^\{[\s\S]{50,8000}\}$/, '{ "type": "service_account", … }',
    { multiline: true })] },
  appwrite: { label: 'Appwrite', kind: 'db', fields: [
    field('endpoint', 'API endpoint', URL_RE, 'https://cloud.appwrite.io/v1'),
    field('projectId', 'Project ID', /^[\w.-]{3,40}$/, ''),
    field('databaseId', 'Database ID (optional)', /^$|^[\w.-]{1,36}$/, '')],
  server: [secret('apiKey', 'API key (server)', /^[\w-]{20,1000}$/, 'standard_…')] },
  pocketbase: { label: 'PocketBase', kind: 'db', fields: [field('url', 'Server URL', URL_RE, 'https://pb.example.com')],
    server: [secret('email', 'Superuser email', /^[^\s@]{1,64}@[^\s@]{1,190}$/, 'admin@example.com', { secret: false }),
      secret('password', 'Superuser password', /^[\s\S]{6,200}$/, '')] },
  clerk: { label: 'Clerk', kind: 'auth', fields: [field('publishableKey', 'Publishable key',
    /^pk_(test|live)_[\w$-]{10,200}$/, 'pk_live_…')] },
  // v0.31.0: Git repositories Colon commits, pushes and merges to
  github: { label: 'GitHub', kind: 'git', fields: gitFields('owner/repository'),
    server: [secret('token', 'Access token', GIT_TOKEN, 'github_pat_… or ghp_…')] },
  bitbucket: { label: 'Bitbucket', kind: 'git', fields: gitFields('workspace/repository'),
    server: [secret('email', 'Atlassian email (for an API token; empty for an access token)',
      /^[^\s@]{1,64}@[^\s@]{1,190}$/, 'you@example.com', { secret: false, optional: true }),
    secret('token', 'API token or access token', GIT_TOKEN, 'ATATT… or ATCTT…')] },
};
PROVIDERS.firebase.kind = 'db';

function jwtRole(t) {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')).role || ''; }
  catch { return ''; }
}
// A private key pasted by mistake: never stored as a (public) connection.
function privateKey(provider, c) {
  if (PROVIDERS[provider] && PROVIDERS[provider].kind === 'git') return false;
  if (provider === 'supabase') return /^sb_secret_/.test(c.anonKey) || jwtRole(c.anonKey) === 'service_role';
  return Object.values(c).some((v) => /^(sk_(test|live)_|-----BEGIN)/.test(String(v)));
}

/** provider, body -> clean config, or a 422 naming the field */
function clean(provider, b = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw err(404, 'not_found', 'Colon doesn’t connect to that service yet.');
  const c = {};
  for (const f of p.fields) {
    const v = String(b[f.name] == null ? '' : b[f.name]).trim().replace(/\/+$/, '');
    if (!f.re.test(v)) throw err(422, 'invalid', `Check the ${f.label}.`, { field: f.name });
    if (v) c[f.name] = v;
  }
  if (privateKey(provider, c)) {
    throw err(422, 'private_key', 'That’s a private key. Use the public one here, and put private keys in Secret '
      + 'keys.', { field: p.fields[p.fields.length - 1].name });
  }
  return c;
}

// v0.31.0: provider, body.server, the saved server values (decrypted) -> the server values to keep, or null.
// Empty fields keep the saved value; git providers need a token.
function cleanServer(provider, b = {}, saved = null) {
  const p = PROVIDERS[provider], out = { ...(saved || {}) };
  for (const f of p.server || []) {
    const raw = b && b[f.name] != null ? String(b[f.name]).trim() : '';
    if (!raw) continue;
    if (!f.re.test(raw)) throw err(422, 'invalid', `Check the ${f.label.replace(/ \(.*$/, '')}.`, { field: f.name });
    if (f.name === 'serviceAccount') {
      let j = null;
      try { j = JSON.parse(raw); } catch { /* checked below */ }
      if (!j || !j.client_email || !j.private_key || !j.project_id) {
        throw err(422, 'invalid', 'Paste the whole service account JSON file.', { field: f.name });
      }
    }
    out[f.name] = raw;
  }
  if (provider === 'supabase' && out.accessToken && !out.serviceKey) {
    throw err(422, 'invalid', 'Add the service_role or secret key too.', { field: 'serviceKey' });
  }
  const need = (p.server || []).filter((f) => !f.optional && !out[f.name]);
  if (p.kind === 'git' && need.length) throw err(422, 'invalid', `Add the ${need[0].label}.`, { field: need[0].name });
  if (need.length && need.length < (p.server || []).filter((f) => !f.optional).length) {
    throw err(422, 'invalid', `Add the ${need[0].label}.`, { field: need[0].name });
  }
  return Object.keys(out).length && !need.length ? out : null;
}

const providersOut = () => Object.keys(PROVIDERS).map((id) => ({ id, label: PROVIDERS[id].label,
  kind: PROVIDERS[id].kind || 'db',
  fields: PROVIDERS[id].fields.map(({ name, label, hint }) => ({ name, label, hint })),
  server: (PROVIDERS[id].server || []).map(({ name, label, hint, multiline, secret: s, optional, warn }) => ({ name,
    label, hint, multiline: Boolean(multiline), secret: s !== false, optional: Boolean(optional),
    ...(warn ? { warn } : {}) })) }));

const HOW = {
  supabase: (c) => `Supabase (${c.url}): import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  const supabase = createClient('${c.url}', '${c.anonKey}');
  Sign up: supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } });
  Log in: signInWithPassword({ email, password }); log out: signOut(); getSession(); onAuthStateChange(cb).
  Data: supabase.from('table').select() / insert() (protected by the user's Row Level Security policies).`,
  firebase: (c) => `Firebase (project ${c.projectId}): import from https://www.gstatic.com/firebasejs/10.12.2/
  firebase-app.js (initializeApp) and firebase-auth.js (getAuth, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, onAuthStateChanged); config ${JSON.stringify(c)}.
  Firestore if asked: firebase-firestore.js.`,
  appwrite: (c) => `Appwrite: import { Client, Account, ID } from 'https://esm.sh/appwrite@16';
  new Client().setEndpoint('${c.endpoint}').setProject('${c.projectId}'); account.create(ID.unique(), email,
  password, name), account.createEmailPasswordSession(email, password), account.get(), deleteSession('current').`,
  pocketbase: (c) => `PocketBase: import PocketBase from 'https://esm.sh/pocketbase@0.21';
  const pb = new PocketBase('${c.url}'); pb.collection('users').create({ email, password, passwordConfirm }),
  authWithPassword(email, password), pb.authStore.isValid / model / clear().`,
  clerk: (c) => `Clerk: <script async crossorigin="anonymous" data-clerk-publishable-key="${c.publishableKey}"
  src="https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js"></script>; after
  window.Clerk.load(): Clerk.mountSignIn(el), Clerk.mountSignUp(el), Clerk.user, Clerk.signOut().`,
};

/** [{ provider, config }] -> the prompt section for the Workspace chat */
function recipe(conns = []) {
  const on = conns.filter((c) => HOW[c.provider]);
  const names = Object.keys(PROVIDERS).join('|');
  return `Sign-in and database services (public client settings; safe in the site's files):
${on.length ? on.map((c) => '- ' + HOW[c.provider](c.config)).join('\n') : '(none connected)'}
For login and register pages use a connected service: put its settings in one file (js/connect.js) that the pages
import, show clear errors, keep the user signed in across pages and redirect after login. Never put a private key
(service_role, secret key) in the site. If the site needs sign-in and nothing is connected, still write the pages
and add to your note: === NEEDS: connection <${names}> -- <why>`;
}

module.exports = { PROVIDERS, clean, cleanServer, providersOut, recipe, privateKey };
