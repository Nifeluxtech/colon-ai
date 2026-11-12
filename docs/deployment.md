# Deployment: GitHub to cPanel (no shell needed)

1. cPanel > Git Version Control > Create: Clone URL `https://github.com/Nifeluxtech/colon-ai.git`, path `/home/apparatu/repositories/colon-ai`.
2. cPanel > Setup Node.js App > Create: Node 24.x, Production, root `repositories/colon-ai/services/api`, URL `api.apparatus.name.ng`, startup file `app.js`. Add env vars: DB_HOST=localhost, DB_NAME, DB_USER, DB_PASSWORD, ALLOWED_ORIGINS (plus the Phase 2 and Phase 3 vars below and in `config/api.env.example`; every key is explained in `config/README.md`). Then "Run NPM Install" and Start.
3. Every update: push to `main` on GitHub, then cPanel > Git Version Control > Manage > Pull or Deploy > "Update from Remote", then "Deploy HEAD Commit". `.cpanel.yml` builds each static app into its subdomain with `scripts/deploy/build-docroot.sh` and touches the API restart file; press Restart in Setup Node.js App too. Full checklist: `docs/runbooks/deploy.md`.

Secrets never go in this repo. It is public.

## Releasing frontend changes (versioned folders)

There is no `?v=` find-and-replace any more. The version lives in the root `package.json`; `node scripts/check.js`
fails unless `apps/*/public/index.html`, `Colon.version` (`packages/ui/js/colon.js`) and every `package.json` agree.
To release: bump the version in every `package.json`, `Colon.version`, and the `/v<version>/` paths and `?v=` query
strings in the three `index.html` files, then run `node scripts/check.js`.

On deploy, `scripts/deploy/build-docroot.sh` (run by `.cpanel.yml`) copies each app's ES modules, the UI kit and the
brand files to `<docroot>/v<version>/`, swaps that folder in whole, and copies `index.html` last. `index.html` loads
everything from `/v<version>/`, so a phone holding an old page keeps loading the old folder and a fresh page loads only
the new one. Old `v*` folders stay until pruned (`docs/runbooks/deploy.md`).

**`.htaccess` is never touched by the deploy.** It is server-only (gitignored, and the build refuses a repo copy).
Each document root's `.htaccess` must send `Cache-Control: no-cache` for `index.html`; keep anything else cPanel put
there (HTTPS redirects). Snippet: `docs/runbooks/deploy.md`.

## API start-up checks and request ids

- The API validates its environment at boot against `services/api/src/config/defaults.js`. In production it
  **refuses to start** when `DB_USER` or `DB_NAME` is missing, and anywhere when a numeric variable (`PORT`,
  `DB_PORT`, `SESSION_DAYS`, the `CHAT_*` and `AI_*` limits, `UPLOAD_QUOTA_MB`, `BENCH_MAX_AGE_DAYS`) is not a number
  or a `*_BASE_URL`/`*_URL` is not an http(s) URL. The message in `services/api/stderr.log` lists every problem; fix
  them in Setup Node.js App › Environment variables and Restart. All variables: `config/README.md`.
- Every response carries an `X-Request-Id` header (an incoming plain id of 8–128 characters is kept, otherwise a UUID
  is made), and every log line written for that request has `req_id`. Ask users or testers for it when reporting a
  failed request.

Runbooks: `docs/runbooks/deploy.md`, `rollback.md`, `key-rotation.md`, `backup-restore.md`.

## Phase 3 (v0.4.0): AI providers, limits and uploads

No new npm packages: the chat API, model router and file reading use Node built-ins (`fetch`, `crypto`, `zlib`).
Migrations `0003_chat` and `0004_admin` run by themselves when the API starts.

### 1. Get free AI keys (add at least one; more keys = more fallbacks)

Current routing order (0.5.2+): Gemma 4 26B (Google) → MiniMax M3.1 Flash (NVIDIA) → Gemma 4 31B → Qwen → DeepSeek →
GLM; African languages add N-ATLaS after Gemma 4 31B. Keys can also be stored (encrypted) in Admin › Models.

| Provider | Where | Env var | Used for |
|---|---|---|---|
| Google AI Studio | <https://aistudio.google.com/apikey> | `GEMINI_API_KEY` | Gemma 4 26B (`GEMINI_MODEL`, default `gemma-4-26b-a4b-it`, native Gemini API): **first choice in every mode since 0.5.2**; Gemma 4 31B as `GEMINI_FALLBACK_MODEL`; reads images |
| NVIDIA | <https://build.nvidia.com> (free developer key `nvapi-...`) | `NVIDIA_API_KEY` | MiniMax M3.1 Flash (second choice), DeepSeek, GLM (`NVIDIA_*_MODEL`) |
| Groq | <https://console.groq.com/keys> (sign in, Create API Key) | `GROQ_API_KEY` | Qwen (`GROQ_MODEL`, default `qwen/qwen3.8-27b`) |
| OpenRouter | <https://openrouter.ai/settings/keys> | `OPENROUTER_API_KEY` | DeepSeek (`OPENROUTER_DEEPSEEK_MODEL`) and Gemma 4 (`OPENROUTER_GEMMA_MODEL`, default `google/gemma-4-31b-it:free`) |
| N-ATLaS (optional) | any OpenAI-compatible host serving the model (for example a Hugging Face Inference Endpoint or a vLLM server) | `NATLAS_BASE_URL` (ending in `/v1`), `NATLAS_API_KEY`, `NATLAS_MODEL` | Naijá, Yorùbá, Hausa and Igbo replies |

Free models change often. If one disappears, the router skips it automatically (and logs `ai_provider_failed` with
`model_not_found`); set the env var to a live id from the provider's model list. On 11 Nov 2026 OpenRouter listed no
free DeepSeek model, so set `OPENROUTER_DEEPSEEK_MODEL` to a current DeepSeek id from
<https://openrouter.ai/models?q=deepseek> (a paid id such as `deepseek/deepseek-v4-flash` uses OpenRouter credits).

### 2. Add the env vars in cPanel

cPanel > Setup Node.js App > (the API app) > Edit > Environment variables > Add Variable, for each:

```
GROQ_API_KEY=...            OPENROUTER_API_KEY=...       GEMINI_API_KEY=...
OPENROUTER_DEEPSEEK_MODEL=<a live DeepSeek id>
CHAT_DAILY_LIMIT=100        CHAT_GUEST_DAILY_LIMIT=15    CHAT_GUEST_IP_DAILY_LIMIT=300
UPLOAD_DIR=/home/apparatu/colon-uploads                  UPLOAD_QUOTA_MB=200
```

Optional: `GROQ_MODEL`, `OPENROUTER_GEMMA_MODEL`, `GEMINI_MODEL`, `NATLAS_BASE_URL`, `NATLAS_API_KEY`, `NATLAS_MODEL`,
`GEMINI_VISION` / `OPENROUTER_GEMMA_VISION` / `GROQ_VISION` (1 = that model reads images), `AI_FIRST_TOKEN_TIMEOUT_MS`,
`AI_IDLE_TIMEOUT_MS`, `AI_MAX_REPLY_MS`, `AI_MAX_TOKENS`. The full list with comments is in `config/api.env.example` and `config/README.md`.
`UPLOAD_DIR` is created on first upload; keep it outside `public_html`, the subdomain folders and the repository.

### 3. Deploy

1. Git Version Control > Manage > Pull or Deploy > **Update from Remote**, then **Deploy HEAD Commit**.
2. Setup Node.js App > **Restart** (no "Run NPM Install" needed for this release, but it does no harm).
3. Open `https://api.apparatus.name.ng/health`: `database.migrations` should include `0004_admin` and
   `ai.configured` should be `true` with your providers listed.
4. Open Colon AI signed out: you can chat as a guest. Sign in: your chats appear in the sidebar and survive reloads.

Replies stream as server-sent events. Passenger honours `X-Accel-Buffering: no`; if replies arrive all at once
instead of word by word, make sure nothing in the API subdomain's `.htaccess` enables `mod_deflate` for
`text/event-stream`.
