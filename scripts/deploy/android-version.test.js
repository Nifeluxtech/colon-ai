// The Android update manifest (apps/chat/public/android/version.json, served at
// https://chat.apparatus.name.ng/android/version.json) must match the release: same version as package.json, the
// versionCode rule the Gradle build uses, and an APK on GitHub Releases with the name the Android workflow uploads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('version.json follows package.json', () => {
  const version = JSON.parse(read('package.json')).version;
  const m = JSON.parse(read('apps/chat/public/android/version.json'));
  const [a, b, c] = version.split('.').map(Number);
  assert.equal(m.versionName, version);
  assert.equal(m.versionCode, a * 10000 + b * 100 + c);
  const releases = 'https://github.com/Nifeluxtech/colon-ai/releases';
  assert.equal(m.apkUrl, `${releases}/download/v${version}/colon-ai-${version}.apk`);
  assert.equal(m.releaseUrl, `${releases}/tag/v${version}`);
  assert.ok(Number.isInteger(m.minSupportedVersionCode) && m.minSupportedVersionCode <= m.versionCode);
});

test('the Gradle build and the workflow use the same names and rule', () => {
  const gradle = read('apps/android/app/build.gradle.kts');
  assert.match(gradle, /major \* 10000 \+ minor \* 100 \+ patch/);
  assert.match(gradle, /applicationId = "ng\.nifelux\.colonai"/);
  const wf = read('.github/workflows/android.yml');
  assert.match(wf, /colon-ai-\$\{?VERSION\}?\.apk/);
  assert.match(wf, /colon-ai\.apk/);
  assert.doesNotMatch(wf, /echo "\$\{\{ secrets\./); // secrets are never echoed
});
