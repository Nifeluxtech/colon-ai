# Deployment: GitHub to cPanel (no shell needed)

1. cPanel > Git Version Control > Create: Clone URL `https://github.com/Nifeluxtech/colon-ai.git`, path `/home/apparatu/repositories/colon-ai`.
2. cPanel > Setup Node.js App > Create: Node 24.x, Production, root `repositories/colon-ai/services/api`, URL `api.apparatus.name.ng`, startup file `app.js`. Add env vars: DB_HOST=localhost, DB_NAME, DB_USER, DB_PASSWORD, ALLOWED_ORIGINS. Then "Run NPM Install" and Start.
3. Every update: push to `main` on GitHub, then cPanel > Git Version Control > Manage > Pull or Deploy > "Update from Remote", then "Deploy HEAD Commit". `.cpanel.yml` copies the static apps to their subdomains and restarts the API.

Secrets never go in this repo. It is public.
