# Phase 5 — The Colon benchmark (v0.5.2, rerun fixes v0.5.6)

**Release standard:** Saga's default is chosen by benchmark score, not popularity, and every model change is re-benchmarked first.

Code: `services/api/src/modules/bench/` (graders, code sandbox, aggregation, report, gate, runner), CLI `services/api/scripts/bench.js`
(`npm run bench` in `services/api`), sets in `services/api/bench/sets/*.json`, results in `services/api/bench/results/`.
Tests: `services/api/tests/unit/bench-*.test.js` (in the root `npm test`).

## The sets (suite `colon-bench-1`, 135 items)

| Set | Items | Mode / reply language | Graded by |
|---|---|---|---|
| `everyday` Nigerian everyday questions | 13 | General | keywords, numbers, multiple choice, regex |
| `waec` WAEC/SSCE-style | 14 | Study | numbers, multiple choice |
| `jamb` JAMB/UTME-style | 14 | Study | numbers, multiple choice |
| `university` University study | 13 | Study | numbers, multiple choice |
| `coding` JavaScript | 12 | Developer | unit tests run in a sandbox |
| `reasoning` | 13 | General | numbers, multiple choice, regex |
| `tooluse` tool calls and structured JSON | 12 | Developer | JSON parse + schema + expected values |
| `pidgin` Naijá | 11 | General, `pcm` | language check + keywords |
| `yoruba` Yorùbá | 11 | General, `yo` | language check + keywords (tone marks optional, rewarded) |
| `hausa` | 11 | General, `ha` | language check + keywords |
| `igbo` | 11 | General, `ig` | language check + keywords |

All questions are original (WAEC/JAMB *style*, no past-paper text). Each item has an `id`, a `prompt` and a `grade` spec
(`mc`, `number`, `keywords`, `regex`, `json`, `code`, `lang`, or `all` of several). The answer-format line ("Reply with the
letter…", "end with `Answer: <number>`", "only the code in one javascript block") is added from the grader type, so prompts stay
clean. Every item is sent with **Saga's real system prompt** for its mode and reply language (`src/modules/ai/prompts.js`) through the
**app's own provider client** (`src/modules/ai/client.js`), so the numbers are what users get.

Graders (`src/modules/bench/graders.js`):

- **mc**: the chosen letter (`B`, `**C**`, `Answer: (B)`, `C. Mitochondrion`).
- **number**: the `Answer:` line, else the last number; `₦`, commas and `a/b` fractions are understood; tolerance per item.
- **keywords / regex**: whole words, case- and accent-insensitive (`Ẹ káàrọ̀` matches `e kaaro`; Hausa `ɗ ƙ ɓ` fold to `d k b`).
- **json**: bare or fenced JSON, a JSON-schema subset (type, required, properties, `additionalProperties:false`, enum, items,
  min/maxItems, uniqueItems, pattern, minimum/maximum) and expected values (strings compared loosely, objects as a subset).
- **code**: the reply's code runs in a **separate Node process** inside a fresh `vm` context (no `require`, `process`, files or
  network), 64 MB heap, CPU timeout per call, and the whole process is killed after a deadline. Score = tests passed / tests.
- **lang**: is the reply in the target language? Target-language function words vs English function words (Pidgin threshold
  30 %, others 50 %), plus an orthography score (Yorùbá subdots and tone marks, Igbo `ị ọ ụ ṅ`, Hausa hooked letters).
  Language quality per item = 0.75 × language score + 0.25 × orthography.
- **Optional LLM judge** (`--judge provider:model`): rates each language-set answer 1–5 as a native-speaker examiner; when
  present it is blended 50/50 with the automatic language quality.

## The score

```
overall = 100 × (0.60 × accuracy + 0.15 × language + 0.10 × speed + 0.15 × reliability)
```

- **accuracy**: mean of the 11 per-set accuracies (each set counts equally; an item that errored scores 0; partial credit for
  code tests passed and keyword parts found).
- **language**: mean language quality over the Pidgin, Yorùbá, Hausa and Igbo sets.
- **speed**: median time to first token on a log scale, 1 s or less = 1, 20 s or more = 0 (≈ 4.5 s = 0.5).
- **reliability**: 1 − error rate (errors after polite retries: timeouts, 4xx/5xx, empty replies).
- **cost** is recorded and is **$0 on every free tier** used; it only breaks ties (then speed).

Per model and per set the report also gives median/p90 first-token and total time, error counts and tokens.

## Running it

```
cd services/api
npm run bench -- --probe                             # one tiny request per model: status, queue, thinking, answer
npm run bench                                        # all candidates, all sets, new run id
npm run bench -- --models nvidia:z-ai/glm-5.3-flash --sets waec,jamb --limit 3
npm run bench -- --resume                            # continue the latest stopped run (or --resume <run>)
npm run bench -- --run 2026-11-12 --report --regrade # rebuild the report, re-grading saved replies
npm run bench -- --run 2026-11-12 --judge gemini:gemma-4-26b-a4b-it
npm run bench -- --run 2026-11-12 --save             # write eval_runs rows (needs DB_* env)
npm run bench -- --gate nvidia:minimaxai/minimax-m3.1-flash   # exit 1 unless freshly benchmarked
```

- **Provider limits** (`src/modules/bench/limiter.js`): every model on one provider shares one key, so one limiter per
  provider caps request starts per rolling minute and requests in flight for all of its models together. Defaults:
  NVIDIA 30 requests/min (free tier ≈ 40) and 4 in flight; Google unlimited. Override with `--rpm-nvidia N`,
  `--inflight-nvidia N` (0 = no cap) or `BENCH_RPM_NVIDIA`. Every attempt, retries included, goes through it.
- **Concurrency per model**: `--concurrency` (default 1, max 4) or per provider `--concurrency-nvidia 2`; `--gap-ms 1500`
  between items. All models run in parallel.
- **Retries** (`src/modules/bench/retry.js`): 5xx, timeouts, network errors and empty replies get two retries after
  10 s / 30 s; a 429 waits for `Retry-After` (or 20 / 40 / 60 s) up to six times without using a normal retry; waits
  have ±20 % jitter. 400 (a parameter the model refuses), 401/403 (key) and 404 (model id) are never retried, and a
  401/403/404/402 stops that model at once (`failed`) instead of after 20 items.
- **Per-model request options** (`src/modules/bench/candidates.js`): a model's own `body` and `opts` (token cap,
  first-token timeout) win over the run defaults; a flag given explicitly on the command line wins over both. Models
  that are also in Saga's routing (DeepSeek, GLM) are benchmarked with exactly the body routing sends.
- Defaults: first-token timeout 60 s (180 s for the slow NVIDIA endpoints: DeepSeek, GLM, Mistral Large 4; 120 s for
  Nemotron), `--max-tokens 2048` (4096 for Nemotron, whose reasoning counts against it).
- A model with more than 50 % errors after 20 items is stopped and marked **unreliable** (it can't be the default);
  `--reset-unreliable` asks it again.
- **Checkpoints and resume** (`src/modules/bench/checkpoint.js`): each graded item is appended to
  `runs/<run>/<model>.jsonl` at once, and `<model>.status.json` says `running`, `done`, `stopped`, `unreliable` or
  `failed`. Ctrl-C or SIGTERM marks running models `stopped`; `--resume [run]` continues with the same flags (saved in
  `meta.json`), skipping every item already answered. Each row carries a settings fingerprint (`cfg`: model, body,
  token cap, temperature); a row made with other settings is asked again rather than mixed in. `--retry-errors`
  re-asks error rows too (`--retry-errors timeout` only timeouts).
- **Error reasons**: error rows carry `error` (one line: code, HTTP status, where it stalled, attempts, time),
  `error_code`, `error_status`, `error_phase` (`connect` = no response headers, the host is queueing;
  `first_token` = stream open but no answer; `idle`; `max`) and `attempt_log`. A reply cut at the token cap says
  "cut off at max_tokens" instead of "got null". The report adds "Errors by reason" per model.
- Output: `bench/results/<run>.md` (scoreboard + every failure), `<run>.json` (full report), `<run>.eval.json` (eval_runs rows)
  and `runs/<run>/*.jsonl` (one line per item with the reply, so a grader fix can re-grade without new API calls).
- `BENCH_SANDBOX=1` drops the client's own `Authorization` / `x-goog-api-key` headers. Only for sandboxes where a proxy injects
  the keys on the wire; the runner is the only code that reads it.

## The 2026-11-12 run: what went wrong (fixed in v0.5.6)

- **DeepSeek V4.1 Flash and GLM-5.3 Flash (NVIDIA): 15 of 15 errors.** Both ids are in NVIDIA's catalog
  (`GET https://integrate.api.nvidia.com/v1/models`), so not a wrong id. Every attempt was a first-token timeout at
  exactly 60 s (3 attempts per item, no reasoning or answer chunk ever arrived). GLM-5.3 Flash defaults to
  `reasoning_effort: max` on NVIDIA (model card), and both endpoints had queued 7–34 s before the first token in
  production on 2026-11-11; with five NVIDIA models running at once on one key, 60 s was too short. Now: GLM sends
  `reasoning_effort: low` (routing and bench, `NVIDIA_GLM_REASONING`), both get 180 s to start, and timeouts record
  whether the host answered at all. Run `--probe` first to see which is the case before a long run.
- **Nemotron 3.5 Lightning: stopped at 130 of 135; Mistral Large 4: stopped at 42.** No `.status.json` was written,
  so neither was stopped by the runner: the process ended about an hour after it started (Nemotron's items alone add up
  to 54 min) and was never resumed. Mistral Large 4 averaged about 80 s per item including retries (first token up to
  187 s), so it needed about 3 hours. Separately, 16 of Nemotron's 130 replies ended at `finish_reason: length`
  ("got null"): its reasoning (default budget 16,384 tokens) counts against `max_tokens` (2048). Now: Nemotron sends
  `reasoning_budget: 1024` with 4096 max tokens, Mistral `reasoning_effort: none` explicitly, and a stopped run is
  resumed with `--resume`.

## Rerunning DeepSeek, GLM, Nemotron and Mistral Large 4 (v0.5.6)

The benchmark is a command-line run, not a button: Admin › Evaluation "Add run" only logs a hand-written result. Run
it on any machine with Node 24 and this repository at v0.5.6 (a laptop, or the cPanel account over SSH inside
`screen`/`nohup`), with the production keys exported in that shell (cPanel keeps them in Setup Node.js App, not in a
file): `NVIDIA_API_KEY` (required for these four models) and `GEMINI_API_KEY` (only for Gemini models or `--judge`).
`DB_*` only if you use `--save`.

```
cd services/api
npm run bench -- --probe --models nvidia:deepseek-ai/deepseek-v4.1-flash,nvidia:z-ai/glm-5.3-flash,nvidia:nvidia/nemotron-3.5-lightning-30b-a3b,nvidia:mistralai/mistral-large-4-1t-a52b
nohup npm run bench -- --run 2026-11-13-rerun --order interleave --concurrency-nvidia 2 \
  --models nvidia:deepseek-ai/deepseek-v4.1-flash,nvidia:z-ai/glm-5.3-flash,nvidia:nvidia/nemotron-3.5-lightning-30b-a3b,nvidia:mistralai/mistral-large-4-1t-a52b \
  > bench-rerun.log 2>&1 &
tail -f bench-rerun.log                                   # stopped or the SSH session dropped? npm run bench -- --resume 2026-11-13-rerun
npm run bench -- --run 2026-11-13-rerun --judge gemini:gemini-3.5-flash-lite   # optional, same judge as 2026-11-12
```

- Leave out of the run any model whose probe says FAIL (fix the reason it prints first), or a model stuck in
  `connect` will hold NVIDIA slots for up to 20 items before it is marked unreliable.
- Use a **new run id**: rows from before v0.5.6 carry no settings fingerprint and would be kept as they are, and all
  four models now run with different settings than on 2026-11-12.
- The NVIDIA key is shared with live Saga traffic; the default cap of 30 requests/min leaves room for it. Lower it
  (`--rpm-nvidia 20`) at busy times.
- Then put the results on Admin › Evaluation: `npm run bench -- --run 2026-11-13-rerun --save` (with `DB_*`), or
  POST `bench/results/2026-11-13-rerun.eval.json` to `/admin/evaluation/bench` as an admin. The gate then accepts these
  models for 30 days (`BENCH_MAX_AGE_DAYS`).

## Admin › Evaluation and the gate

Migration `0005_bench` adds to `eval_runs`: `kind` (`bench` for benchmark runs, `manual` otherwise), `provider`, `suite`,
`items`, `error_rate`, `first_token_ms`, `details` (per-set JSON) and an index. A run reaches the Evaluation page either with
`--save` (direct database access) or by posting `bench/results/<run>.eval.json` to `POST /admin/evaluation/bench` (admin).

The gate (`src/modules/bench/gate.js`) refuses a model change with `409 needs_benchmark` unless a finished (`done`, not unreliable)
benchmark run of **exactly that provider + model** is newer than `BENCH_MAX_AGE_DAYS` (default 30):

- `POST /admin/models` (unless added switched off), `PATCH /admin/models/:id` when the model id or provider changes or a model is
  switched back on, and `PATCH /admin/routing` when a mode gets a **new first choice** (each model in that slot is checked).
  Reordering fallbacks or priorities is not gated.
- A Super Admin can skip it once with `skip_benchmark: "<reason>"`; the skip is audited (`admin.bench_gate_skipped`).
- `BENCH_GATE=off` switches it off (for a fresh install before any run is imported).
- `GET /admin/models` shows each model's latest benchmark score and the gate settings.

## Deploy notes

- Migration `0005_bench` runs automatically on API start (new columns and an index only).
- New optional env: `BENCH_GATE` (default `on`), `BENCH_MAX_AGE_DAYS` (default 30). After deploying, import the latest
  `bench/results/<run>.eval.json` (or run with `--save`) **before** changing models or routing, or every change is refused.
