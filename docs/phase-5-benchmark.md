# Phase 5 — The Colon benchmark (v0.5.2)

**Release standard:** Saga's default is chosen by benchmark score, not popularity, and every model change is re-benchmarked first.

Code: `services/api/src/bench/` (graders, code sandbox, aggregation, report, gate, runner), CLI `services/api/scripts/bench.js`
(`npm run bench` in `services/api`), sets in `services/api/bench/sets/*.json`, results in `services/api/bench/results/`.
Tests: `services/api/test/bench.test.js` (in the root `npm test`).

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
clean. Every item is sent with **Saga's real system prompt** for its mode and reply language (`src/ai/prompts.js`) through the
**app's own provider client** (`src/ai/client.js`), so the numbers are what users get.

Graders (`src/bench/graders.js`):

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
npm run bench                                        # all candidates, all sets, new run id
npm run bench -- --models nvidia:z-ai/glm-5.3-flash --sets waec,jamb --limit 3
npm run bench -- --run 2026-11-12                    # resume: finished items are skipped
npm run bench -- --run 2026-11-12 --report --regrade # rebuild the report, re-grading saved replies
npm run bench -- --run 2026-11-12 --judge gemini:gemma-4-26b-a4b-it
npm run bench -- --run 2026-11-12 --save             # write eval_runs rows (needs DB_* env)
npm run bench -- --gate nvidia:minimaxai/minimax-m3.1-flash   # exit 1 unless freshly benchmarked
```

- Polite to free tiers: one request at a time per model (`--concurrency`, max 4), `--gap-ms 1500` between items, up to two
  retries with 10 s / 30 s back-off on 429/5xx/timeouts/empty replies (never on 404/401). All models run in parallel.
- First-token timeout 60 s (the app's is 25 s, the hedge covers the rest), `--max-tokens 4096` (the app's `AI_MAX_TOKENS`).
- A model with more than 50 % errors after 20 items is stopped and marked **unreliable** (it can't be the default).
- Output: `bench/results/<run>.md` (scoreboard + every failure), `<run>.json` (full report), `<run>.eval.json` (eval_runs rows)
  and `runs/<run>/*.jsonl` (one line per item with the reply, so a grader fix can re-grade without new API calls).
- `BENCH_SANDBOX=1` drops the client's own `Authorization` / `x-goog-api-key` headers. Only for sandboxes where a proxy injects
  the keys on the wire; the runner is the only code that reads it.

## Admin › Evaluation and the gate

Migration `0005_bench` adds to `eval_runs`: `kind` (`bench` for benchmark runs, `manual` otherwise), `provider`, `suite`,
`items`, `error_rate`, `first_token_ms`, `details` (per-set JSON) and an index. A run reaches the Evaluation page either with
`--save` (direct database access) or by posting `bench/results/<run>.eval.json` to `POST /admin/evaluation/bench` (admin).

The gate (`src/bench/gate.js`) refuses a model change with `409 needs_benchmark` unless a finished (`done`, not unreliable)
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
