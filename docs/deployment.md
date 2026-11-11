# Deployment: GitHub to cPanel (no shell needed)

1. cPanel > Git Version Control > Create: Clone URL `https://github.com/Nifeluxtech/colon-ai.git`, path `/home/apparatu/repositories/colon-ai`.
2. cPanel > Setup Node.js App > Create: Node 24.x, Production, root `repositories/colon-ai/services/api`, URL `api.apparatus.name.ng`, startup file `app.js`. Add env vars: DB_HOST=localhost, DB_NAME, DB_USER, DB_PASSWORD, ALLOWED_ORIGINS. Then "Run NPM Install" and Start.
3. Every update: push to `main` on GitHub, then cPanel > Git Version Control > Manage > Pull or Deploy > "Update from Remote", then "Deploy HEAD Commit". `.cpanel.yml` copies the static apps to their subdomains and restarts the API.

Secrets never go in this repo. It is public.

## Releasing frontend changes (cache busting)

Phones cache `/ui/*.js` aggressively. Every local CSS/JS/font URL in `apps/*/public/index.html` (and the
`@font-face` URLs in `packages/ui/assets/colon-ui.css`) carries `?v=<version>`, and `Colon.version` in
`colon-app.js` must match. When you bump `package.json`, replace the old `?v=` everywhere (for example
`grep -rl 'v=0.3.1' apps packages | xargs sed -i 's/v=0\.3\.1/v=0.3.2/g'`) and update `Colon.version`.
`node scripts/check.js` fails if any reference is out of date. Each app's `public/.htaccess` sends `Cache-Control: no-cache` for
`index.html`, so phones always fetch the page that names the new versions. If the subdomain document root already has an
`.htaccess` (for example for HTTPS redirects), merge these lines into it, because the deploy copy replaces the file.

