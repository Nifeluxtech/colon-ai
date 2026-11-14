# Configuration

Every setting of the Colon API (`services/api`) is an environment variable. On the server they are set in
**cPanel › Setup Node.js App › Environment variables**; locally, export them in your shell. Nothing secret is ever
committed: this repository is public.

| File | What it is |
|---|---|
| `api.env.example` | Every variable the API reads, with production-shaped values and comments. Copy the names into cPanel. |
| `e2e.env.example` | A local environment for the end-to-end scripts (`services/api/tests/e2e/`): MariaDB on 127.0.0.1 and the mock provider (`services/api/tests/helpers/mock-provider.js`) in every model slot. |

## How it is read and validated

- **One schema**: `services/api/src/config/defaults.js` lists every key with its type, default and purpose.
  `services/api/src/config/index.js` builds the config object from it. Code never reads a variable that is not in the
  schema.
- **Unset and empty mean the same thing**: use the default.
- **Validated at boot**: `http/server.js` calls `config.assertValid()` before anything else starts. The API refuses to
  start, with one message listing every problem, when:
  - a key marked *required* is unset for the current `NODE_ENV` (today: `DB_USER` and `DB_NAME` in `production`);
  - a `number` key is not numeric (e.g. `AI_HEDGE=two`);
  - a `url` key is set but is not an `http(s)://` URL.
  Fix the variable in cPanel and restart the Node app.
- **Kept in sync**: `node scripts/check.js` fails when `api.env.example` is missing a schema key or lists a key the
  schema does not have. Adding a variable means adding it to `defaults.js`, `api.env.example` and the table below.
- **Secrets** (type *secret* below) belong only in cPanel; the admin screens show stored keys masked (`••••1234`). Provider and web-search keys can also be stored in the database
  from Admin › Models and Admin › System › Web search; those copies are AES-256-GCM encrypted with `APP_SECRET`
  and take precedence over the environment. Rotating `APP_SECRET`: `docs/runbooks/key-rotation.md`.
- **Not optional in practice**: `APP_SECRET` has no default; without it 2FA and stored keys cannot work. Set 48+
  random characters (32 minimum) before the first staff account enables 2FA.

## Variables

### Runtime

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `NODE_ENV` | string | no | `development` | production on cPanel |
| `PORT` | number | no | `3000` | HTTP port (Passenger sets it) |
| `ALLOWED_ORIGINS` | string | no | `https://chat.apparatus.name.ng,https://browser.apparatus.name.ng,https://admin.apparatus.name.ng` | comma-separated web app origins allowed to call the API |

### Database

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `DB_HOST` | string | no | `localhost` | MySQL/MariaDB host |
| `DB_PORT` | number | no | `3306` | MySQL/MariaDB port |
| `DB_USER` | string | **yes, in production** | (empty) | MySQL/MariaDB user |
| `DB_PASSWORD` | secret | no | (empty) | MySQL/MariaDB password |
| `DB_NAME` | string | **yes, in production** | (empty) | MySQL/MariaDB database name |

### Accounts and security

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `APP_SECRET` | secret | no | (empty) | 32+ random characters; encrypts 2FA secrets and stored provider keys |
| `COOKIE_DOMAIN` | string | no | (empty) | cookie domain shared by all apps, e.g. .apparatus.name.ng |
| `SESSION_DAYS` | number | no | `30` | sign-in session length in days |
| `OWNER_EMAIL` | string | no | (empty) | this account becomes Super Admin when it registers |
| `GOOGLE_CLIENT_ID` | string | no | (empty) | Google sign-in OAuth client id (optional) |
| `APP_URL_CHAT` | url | no | `https://chat.apparatus.name.ng` | Colon AI web app URL (links in emails) |

### Email

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `BREVO_API_KEY` | secret | no | (empty) | Brevo key for verification and reset emails (optional) |
| `MAIL_FROM` | string | no | `no-reply@apparatus.name.ng` | sender address |
| `MAIL_FROM_NAME` | string | no | `Colon AI` | sender name |

### Chat limits and uploads

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `CHAT_DAILY_LIMIT` | number | no | `100` | replies per signed-in user per UTC day |
| `CHAT_GUEST_DAILY_LIMIT` | number | no | `15` | replies per guest browser per UTC day |
| `CHAT_GUEST_IP_DAILY_LIMIT` | number | no | `300` | replies for all guests on one IP per UTC day |
| `UPLOAD_DIR` | string | no | `services/api/storage/uploads` | uploaded files, outside every web root |
| `UPLOAD_QUOTA_MB` | number | no | `200` | per-user upload quota |

### Model router tuning

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `AI_FIRST_TOKEN_TIMEOUT_MS` | number | no | `25000` | give up on a model that has not started answering |
| `AI_HEDGE` | number | no | `2` | models asked at once per wave (1 = one after another) |
| `AI_SPECIALIST_ROUTING` | on/off | no | `on` | specialist routing: the benchmark winner per task category leads the chain (Admin › Routing overrides) |
| `AI_IDLE_TIMEOUT_MS` | number | no | `30000` | give up on a stream that went quiet |
| `AI_MAX_REPLY_MS` | number | no | `180000` | hard cap on one reply |
| `AI_MAX_TOKENS` | number | no | `4096` | max tokens per reply |
| `AI_DEVELOPER_MAX_TOKENS` | number | no | `8192` | max tokens per Developer-mode reply (whole files of code) |

### AI providers

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `GROQ_API_KEY` | secret | no | (empty) | Groq key |
| `GROQ_BASE_URL` | url | no | `https://api.groq.com/openai/v1` | Groq base URL |
| `GROQ_MODEL` | string | no | `qwen/qwen3.8-27b` | Groq model id |
| `GROQ_VISION` | string | no | `0` | 1 if the Groq model reads images |
| `OPENROUTER_API_KEY` | secret | no | (empty) | OpenRouter key |
| `OPENROUTER_BASE_URL` | url | no | `https://openrouter.ai/api/v1` | OpenRouter base URL |
| `OPENROUTER_DEEPSEEK_MODEL` | string | no | `deepseek/deepseek-v4-flash:free` | OpenRouter DeepSeek id |
| `OPENROUTER_DEEPSEEK_VISION` | string | no | `0` | 1 if that model reads images |
| `OPENROUTER_GEMMA_MODEL` | string | no | `google/gemma-4-31b-it:free` | OpenRouter Gemma id |
| `OPENROUTER_GEMMA_VISION` | string | no | `1` | 1 if that model reads images |
| `GEMINI_API_KEY` | secret | no | (empty) | Google AI Studio key |
| `GEMINI_BASE_URL` | url | no | `https://generativelanguage.googleapis.com/v1beta` | Google AI Studio base URL |
| `GEMINI_MODEL` | string | no | `gemma-4-26b-a4b-it` | Saga first choice |
| `GEMINI_FALLBACK_MODEL` | string | no | `gemma-4-31b-it` | second Google model ("off" to skip) |
| `GEMINI_THINKING` | string | no | `minimal` | minimal, high or off |
| `GEMINI_VISION` | string | no | `1` | 1 if Gemma reads images |
| `NVIDIA_API_KEY` | secret | no | (empty) | NVIDIA build key |
| `NVIDIA_BASE_URL` | url | no | `https://integrate.api.nvidia.com/v1` | NVIDIA base URL |
| `NVIDIA_DEEPSEEK_MODEL` | string | no | `deepseek-ai/deepseek-v4.1-flash` | NVIDIA DeepSeek id |
| `NVIDIA_DEEPSEEK_THINKING` | string | no | `off` | "on" = hidden reasoning first (slower) |
| `NVIDIA_GEMMA_MODEL` | string | no | (empty) | NVIDIA Gemma id (empty = off) |
| `NVIDIA_GLM_MODEL` | string | no | `z-ai/glm-5.3-flash` | NVIDIA GLM id |
| `NVIDIA_GLM_REASONING` | string | no | `low` | GLM reasoning_effort: low, high, max, or "default" (host default = max) |
| `NVIDIA_MINIMAX_MODEL` | string | no | `minimaxai/minimax-m3.1-flash` | NVIDIA MiniMax id |
| `NATLAS_BASE_URL` | url | no | (empty) | OpenAI-compatible host serving N-ATLaS |
| `NATLAS_API_KEY` | secret | no | (empty) | N-ATLaS key |
| `NATLAS_MODEL` | string | no | `n-atlas` | N-ATLaS model id |

### Benchmark gate

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `BENCH_GATE` | string | no | `on` | "off" lets models into routing without a fresh benchmark |
| `BENCH_MAX_AGE_DAYS` | number | no | `30` | how fresh a benchmark must be |

### Web search (Research mode)

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `WEB_SEARCH` | string | no | `on` | "off" switches web search off until an admin turns it on |
| `BRAVE_SEARCH_API_KEY` | secret | no | (empty) | Brave Search API key (optional) |
| `TAVILY_API_KEY` | secret | no | (empty) | Tavily key (optional) |
| `SEARXNG_URL` | url | no | (empty) | SearXNG base URL (optional) |
| `SEARXNG_API_KEY` | secret | no | (empty) | SearXNG bearer token (optional) |

### Safety layer

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `SAFETY` | on/off | no | `on` | "off" switches the rule filters off (child-safety rules always stay on) |
| `SAFETY_LOG_TEXT` | off/hash/excerpt | no | `off` | what a safety event keeps of the message: nothing, a keyed hash (HMAC-SHA-256 with `APP_SECRET`), or the first 80 characters |
| `SAFETY_PROVIDER_MODERATION` | on/off | no | `off` | "on" also asks a moderation endpoint (needs `SAFETY_MODERATION_API_KEY`); Admin › Safety can override it live |
| `SAFETY_MODERATION_URL` | url | no | `https://api.openai.com/v1/moderations` | OpenAI-compatible moderation endpoint |
| `SAFETY_MODERATION_API_KEY` | secret | no | (empty) | key for the moderation endpoint (optional) |
| `SAFETY_MODERATION_MODEL` | string | no | `omni-moderation-latest` | moderation model id |
| `SAFETY_MODERATION_TIMEOUT_MS` | number | no | `3000` | give up on the moderation endpoint after this long; the message then goes through on the rules alone (fail open, logged) |

The rule filters (`services/api/src/modules/safety`) need no key, no model and no network. The child-safety rules
run whatever `SAFETY` or the admin settings say, and whether or not the moderation endpoint answers (fail closed).

### Colon Browser server reader (Phase 8)

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `BROWSER_READER` | on/off | no | `on` | "off" switches `GET /browser/fetch` off (answers `501 not_enabled`; the web apps fall back to the "open in the app" prompt) |
| `BROWSER_READER_GUESTS` | on/off | no | `on` | "off" keeps the server reader for signed-in users only (guests get `401`) |
| `BROWSER_READER_BLOCKLIST` | string | no | (empty) | extra hosts the reader refuses, comma-separated; a host covers its subdomains |

The session manager (`/browser/session`, `/browser/sessions`, `/browser/history`, `session_sync` on `/ws`) needs no
setting: it uses the database and the signed-in session. Contract: `docs/phase8-backend-contract.md`.

### Saga browser automation (Phase 9, 0.9.0)

Saga drives the browser panel of the Colon AI Android app through the bridge (`/ws`), with `POST /browser/agent`
and the action log in `saga_tasks` / `saga_actions` (migration `0009`). Approvals (payments, purchases, form
submissions, messages, personal data) are always tapped on the phone; no setting switches them off.

| Variable | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `SAGA_BROWSE` | on/off | no | `on` | "off" answers `501 not_enabled` on `POST /browser/agent` (the web reader's AI Browse keeps working) |
| `SAGA_MAX_STEPS` | number | no | `15` | most actions Saga takes for one task; then it stops and reports the pages it read |
| `SAGA_TASK_TIMEOUT_MS` | number | no | `300000` | hard cap on one task |
| `SAGA_MODEL_TIMEOUT_MS` | number | no | `60000` | one Saga decision (model call); two in a row fail the task |
| `SAGA_STEP_TIMEOUT_MS` | number | no | `20000` | the phone's answer to one command; two timeouts in a row fail the task |
| `SAGA_APPROVAL_TIMEOUT_MS` | number | no | `120000` | the user's consent ("Let Saga browse?") or approval tap on the phone |
| `SAGA_TASKS_PER_HOUR` | number | no | `20` | browsing tasks one user may start per hour |
| `SAGA_HANDOFF_TIMEOUT_MS` | number | no | `600000` | Phase 10: how long Saga waits for the user to type a password, code or card details and tap Return to AI |
| `SAGA_USER_CONTROL_TIMEOUT_MS` | number | no | `900000` | 0.10.3: how long Saga waits for the user to give the browser back after Take control or Pause, then stops the task |
| `SAGA_RECONNECT_GRACE_MS` | number | no | `90000` | 0.10.4: how long a Saga task whose phone socket dropped waits for the same phone (Colon AI) to reconnect, on this or another worker, before it ends as interrupted |
