// Workspace connections (v0.30.0): sign-in and database services a published site talks to straight from the
// browser (Supabase, Firebase, Appwrite, PocketBase, Clerk). Only each service's PUBLIC client settings are kept
// here (a Supabase anon key, a Firebase web config...): they end up in the site's files anyway, and the service's
// own rules (Row Level Security, Firebase rules) protect the data. Private keys (a Supabase service_role key, a
// Clerk secret key) are refused here and belong in the Data tab's secret keys, used through Colon's proxy.
// recipe() tells the Workspace chat model how to build sign up / log in / log out with each connected service.
const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });

const URL_RE = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[\w./-]*)?$/i;
const TOKEN = /^[\w.-]{10,2000}$/;
const field = (name, label, re, hint) => ({ name, label, re, hint });

const PROVIDERS = {
  supabase: { label: 'Supabase', fields: [
    field('url', 'Project URL', URL_RE, 'https://xyz.supabase.co'),
    field('anonKey', 'Anon (public) key', TOKEN, 'eyJ… or sb_publishable_…')] },
  firebase: { label: 'Firebase', fields: [
    field('apiKey', 'API key', /^[\w-]{20,60}$/, 'AIza…'),
    field('authDomain', 'Auth domain', /^[a-z0-9.-]+$/i, 'project.firebaseapp.com'),
    field('projectId', 'Project ID', /^[a-z0-9-]{4,40}$/, 'my-project'),
    field('appId', 'App ID', /^[\w:.-]{6,100}$/, '1:123:web:abc'),
    field('storageBucket', 'Storage bucket (optional)', /^$|^[a-z0-9._-]+$/i, ''),
    field('messagingSenderId', 'Sender ID (optional)', /^$|^\d{4,20}$/, '')] },
  appwrite: { label: 'Appwrite', fields: [
    field('endpoint', 'API endpoint', URL_RE, 'https://cloud.appwrite.io/v1'),
    field('projectId', 'Project ID', /^[\w.-]{3,40}$/, '')] },
  pocketbase: { label: 'PocketBase', fields: [field('url', 'Server URL', URL_RE, 'https://pb.example.com')] },
  clerk: { label: 'Clerk', fields: [field('publishableKey', 'Publishable key', /^pk_(test|live)_[\w$-]{10,200}$/,
    'pk_live_…')] },
};

function jwtRole(t) {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')).role || ''; }
  catch { return ''; }
}
// A private key pasted by mistake: never stored as a (public) connection.
function privateKey(provider, c) {
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

const providersOut = () => Object.keys(PROVIDERS).map((id) => ({ id, label: PROVIDERS[id].label,
  fields: PROVIDERS[id].fields.map(({ name, label, hint }) => ({ name, label, hint })) }));

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

module.exports = { PROVIDERS, clean, providersOut, recipe, privateKey };
