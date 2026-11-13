// Developer mode: which project files the model reads, and what language each one is.
//   ignored  folders such as node_modules, .git, vendor, dist, build: counted, never listed file by file
//   skipped  listed in the file tree with a reason, contents never sent: binaries, images, fonts, archives,
//            minified bundles, lockfiles (one-line summary) and secret files (.env, private keys)
const IGNORE_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', 'bower_components', '.next', '.nuxt',
  '.svelte-kit', '.cache', '.parcel-cache', '.turbo', 'coverage', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.venv', 'venv', 'env', '.tox', 'target', '.gradle', '.idea', '.vscode', '.dart_tool', 'Pods', 'DerivedData',
  '__MACOSX', '.svn', '.hg', 'storage', 'tmp', '.terraform', '.expo']);

const BINARY_EXT = new RegExp(String.raw`\.(png|jpe?g|gif|webp|bmp|ico|icns|tiff?|psd|ai|sketch|fig|svgz|heic|avif|`
  + String.raw`mp3|mp4|m4a|wav|ogg|webm|mov|avi|mkv|flac|woff2?|ttf|otf|eot|zip|rar|7z|gz|tgz|bz2|xz|tar|jar|war|`
  + String.raw`apk|aab|ipa|exe|dll|so|dylib|bin|o|a|lib|class|pyc|pyo|wasm|pdf|docx?|xlsx?|pptx?|odt|sqlite3?|db|`
  + String.raw`mdb|keystore|jks|p12|pfx|dmg|iso|map)$`, 'i');

const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Gemfile.lock',
  'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'pubspec.lock', 'bun.lockb', 'npm-shrinkwrap.json',
  'Podfile.lock', 'mix.lock', 'packages.lock.json']);

// Files that usually hold real secrets: listed, never read (an example/sample/template file is fine).
const SECRET = new RegExp(String.raw`(^|\/)(\.env(\.[\w-]+)?|\.npmrc|\.pypirc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)|`
  + String.raw`[^/]*\.(pem|key|p8|crt|cer))$`, 'i');
const SECRET_OK = /\.(example|sample|template|dist)$/i;

const MINIFIED = /\.min\.(js|css)$|[.-]bundle\.js$|\.chunk\.js$/i;

const LANG = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript (JSX)', ts: 'TypeScript',
  tsx: 'TypeScript (TSX)', vue: 'Vue', svelte: 'Svelte', py: 'Python', php: 'PHP', rb: 'Ruby', java: 'Java',
  kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift', dart: 'Dart', go: 'Go', rs: 'Rust', c: 'C', h: 'C', cpp: 'C++',
  hpp: 'C++', cc: 'C++', cs: 'C#', lua: 'Lua', r: 'R', pl: 'Perl', sh: 'Shell', bash: 'Shell', bat: 'Batch',
  ps1: 'PowerShell', sql: 'SQL', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less', json: 'JSON',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', xml: 'XML', md: 'Markdown', graphql: 'GraphQL', gql: 'GraphQL',
  prisma: 'Prisma', ejs: 'EJS', hbs: 'Handlebars', twig: 'Twig', ini: 'INI', gradle: 'Gradle',
};
const NAMED = { Dockerfile: 'Dockerfile', Makefile: 'Makefile', Procfile: 'Procfile', '.htaccess': 'Apache config' };

const base = (p) => String(p).split('/').pop();
const extOf = (p) => ((base(p).match(/\.([^.]+)$/) || [])[1] || '').toLowerCase();

function languageOf(path) {
  const b = base(path);
  if (NAMED[b]) return NAMED[b];
  if (/\.blade\.php$/i.test(b)) return 'Blade (PHP)';
  return LANG[extOf(path)] || null;
}

// true when any folder on the path is one we never read (node_modules, .git, …).
function ignoredDir(path) {
  const parts = String(path).split('/').slice(0, -1);
  return parts.some((d) => IGNORE_DIRS.has(d));
}

// null = read it; otherwise why its contents are not sent.
function skipReason(path, size = 0) {
  const b = base(path);
  if (LOCKFILES.has(b)) return 'lockfile';
  if (SECRET.test(path) && !SECRET_OK.test(b)) return 'secret';
  if (BINARY_EXT.test(b)) return 'binary';
  if (MINIFIED.test(b)) return 'minified';
  if (size > 1048576) return 'too_large';
  return null;
}

const REASON_TEXT = {
  lockfile: 'lockfile, summary only', secret: 'may hold secrets, not read', binary: 'binary or media file',
  minified: 'minified or bundled code', too_large: 'over 1 MB', budget: 'over the context budget',
  not_text: 'not readable text', snapshot: 'not kept in the stored project',
};

// Files that explain a project: manifests, configs, READMEs and the usual entry points.
const ENTRY = new RegExp(String.raw`^(package\.json|composer\.json|requirements\.txt|pyproject\.toml|setup\.py|`
  + String.raw`Pipfile|Gemfile|go\.mod|Cargo\.toml|pubspec\.yaml|pom\.xml|build\.gradle(\.kts)?|tsconfig\.json|`
  + String.raw`readme(\.\w+)?|dockerfile|docker-compose\.ya?ml|procfile|\.htaccess|\.env\.example|manage\.py|`
  + String.raw`artisan|(main|app|index|server|wsgi|asgi|routes?|config|settings)\.[a-z]+|`
  + String.raw`[\w-]+\.config\.[cm]?[jt]s|vite\.config\.\w+|webpack\.config\.\w+)$`, 'i');
const isEntry = (path) => ENTRY.test(base(path));

module.exports = { IGNORE_DIRS, languageOf, ignoredDir, skipReason, isEntry, REASON_TEXT, base, extOf };
