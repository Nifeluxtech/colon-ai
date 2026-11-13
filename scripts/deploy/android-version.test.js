// The Android update manifest (apps/chat/public/android/version.json, served at
// https://chat.apparatus.name.ng/android/version.json) must match the release: same version as package.json, the
// versionCode rule the Gradle build uses, and APKs on GitHub Releases with the names the Android workflow uploads.
// Since v0.8.0 one manifest serves two apps: the top-level fields are Colon AI (unchanged shape, so v0.7.x apps keep
// updating) and "browser" is Colon Browser; each app reads only its own entry (VersionManifest.forApp).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const releases = 'https://github.com/Nifeluxtech/colon-ai/releases';

function checkEntry(m, version, asset) {
  const [a, b, c] = version.split('.').map(Number);
  assert.equal(m.versionName, version);
  assert.equal(m.versionCode, a * 10000 + b * 100 + c);
  assert.equal(m.apkUrl, `${releases}/download/v${version}/${asset}-${version}.apk`);
  assert.equal(m.releaseUrl, `${releases}/tag/v${version}`);
  assert.ok(Number.isInteger(m.minSupportedVersionCode) && m.minSupportedVersionCode <= m.versionCode);
  assert.ok(String(m.notes || '').length <= 600);
}

test('version.json follows package.json for both apps', () => {
  const version = JSON.parse(read('package.json')).version;
  const m = JSON.parse(read('apps/chat/public/android/version.json'));
  checkEntry(m, version, 'colon-ai');
  assert.ok(m.browser && typeof m.browser === 'object', 'version.json needs a "browser" entry');
  checkEntry(m.browser, version, 'colon-browser');
});

test('the Gradle build and the workflow use the same names and rule', () => {
  const gradle = read('apps/android/app/build.gradle.kts');
  assert.match(gradle, /major \* 10000 \+ minor \* 100 \+ patch/);
  assert.match(gradle, /applicationId = "ng\.nifelux\.colonai"/);
  assert.match(gradle, /applicationId = "ng\.nifelux\.colonbrowser"/);
  const wf = read('.github/workflows/android.yml');
  for (const name of ['colon-ai', 'colon-browser']) {
    assert.match(wf, new RegExp(`${name}-\\$\\{?VERSION\\}?\\.apk`));
    assert.match(wf, new RegExp(`${name}\\.apk`));
  }
  assert.match(wf, /assembleColonaiRelease/);
  assert.match(wf, /assembleColonbrowserRelease/);
  assert.doesNotMatch(wf, /echo "\$\{\{ secrets\./); // secrets are never echoed
});

test('a two-digit minor keeps versionCode increasing (0.9.2 -> 902, 0.10.0 -> 1000)', () => {
  const code = (v) => { const [a, b, c] = v.split('.').map(Number); return a * 10000 + b * 100 + c; };
  assert.equal(code('0.9.2'), 902);
  assert.equal(code('0.10.0'), 1000);
  assert.ok(code('0.10.0') > code('0.9.2'), 'an installed 0.9.2 must see 0.10.0 as newer');
  const m = JSON.parse(read('apps/chat/public/android/version.json'));
  assert.ok(m.versionCode >= 1000 && m.browser.versionCode >= 1000, 'both APKs are on 0.10.0 or later');
});
