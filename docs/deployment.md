# Deployment: GitHub to cPanel (no shell needed)

1. cPanel > Git Version Control > Create: Clone URL `https://github.com/Nifeluxtech/colon-ai.git`, path `/home/apparatu/repositories/colon-ai`.
2. cPanel > Setup Node.js App > Create: Node 24.x, Production, root `repositories/colon-ai/services/api`, URL `api.apparatus.name.ng`, startup file `app.js`. Add env vars: DB_HOST=localhost, DB_NAME, DB_USER, DB_PASSWORD, ALLOWED_ORIGINS (plus the Phase 2 and Phase 3 vars below and in `.env.example`). Then "Run NPM Install" and Start.
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


## Phase 3 (v0.4.0): AI providers, limits and uploads

No new npm packages: the chat API, model router and file reading use Node built-ins (`fetch`, `crypto`, `zlib`).
Migrations `0003_chat` and `0004_admin` run by themselves when the API starts.

### 1. Get free AI keys (add at least one; more keys = more fallbacks)

| Provider | Where | Env var | Used for |
|---|---|---|---|
| Groq | <https://console.groq.com/keys> (sign in, Create API Key) | `GROQ_API_KEY` | Qwen (`GROQ_MODEL`, default `qwen/qwen3.8-27b`): first choice for General, Study, Research |
| OpenRouter | <https://openrouter.ai/settings/keys> | `OPENROUTER_API_KEY` | DeepSeek (`OPENROUTER_DEEPSEEK_MODEL`) and Gemma 4 (`OPENROUTER_GEMMA_MODEL`, default `google/gemma-4-31b-it:free`) |
| Google AI Studio | <https://aistudio.google.com/apikey> | `GEMINI_API_KEY` | Gemma 4 (`GEMINI_MODEL`, default `gemma-4-31b-it`, native Gemini API), also reads images |
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
`AI_IDLE_TIMEOUT_MS`, `AI_MAX_REPLY_MS`, `AI_MAX_TOKENS`. The full list with comments is in `.env.example`.
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
