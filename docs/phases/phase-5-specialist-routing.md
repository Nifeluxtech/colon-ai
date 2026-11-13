# Phase 5 — Specialist routing (v0.5.10)

Where one model clearly beats Saga's default on a kind of request (code, exams, a language), that model leads the
chain for those requests. The choice comes from the Colon benchmark, not from taste, and is re-derived every time a
new benchmark is imported (release standard: "the default is chosen by benchmark score; every model change is
re-benchmarked first").

## How a request is routed

1. **Classify** (`services/api/src/modules/ai/classify.js`, rule-based, no model call):
   - language: the reply language already chosen by `prompts.replyLanguage()` (an African setting wins, else the
     existing detector reads the message; fenced code is ignored);
   - task: `code` (Developer mode, a code file attached, code or programming words), `research` (Research mode,
     a web search ran, or "latest / news / today / sources…"), `exam` (Study mode, WAEC / NECO / JAMB / UTME /
     university course words, A–D options), `reasoning` (solve / calculate / equations), else `everyday`;
   - category = the African language when there is one (`pidgin`, `yoruba`, `hausa`, `igbo`), else the task.
2. **Reorder** (`modules/ai/specialists.js apply`, used by `generate.chainFor`): the category's specialist moves to
   the front of the mode's chain (or the African chain); demoted slots move to the back. Nothing is added or
   removed, so fallback, resting and hedging work exactly as before. Hedged waves never pull a demoted slot forward
   to mix providers (`hedge.js orderForHedge`), so a weak model only answers when the strong ones failed.
3. **Log**: `ai_reply_ok` in stderr.log carries `route`: `specialist:<category>` when the specialist led,
   `default:<category>` when the default kept the head, `default` when specialist routing is off.

## How specialists are derived (`specialists.derive`, pure)

Input: the rows of the newest imported benchmark (`eval_runs`, `kind = 'bench'`, one import = one run name), and
the live routes and model slots. Per category:

| Category | Benchmark sets (score = mean accuracy, %) | Judged against route |
|---|---|---|
| code | coding | developer |
| reasoning | reasoning | general |
| exam | waec, jamb, university | study |
| research | tooluse | research |
| everyday | everyday | general |
| pidgin / yoruba / hausa / igbo | the language's set | african |

- **Default** = the first slot of that route.
- A **specialist** must be complete in the benchmark (status `done`; incomplete runs such as DeepSeek, GLM, Mistral
  and Nemotron on 2026-11-12 are never picked), and score at least **default + 5 points + 0.5 point per second** of
  extra median first token in that category, with a median first token of **15 s or less**. Highest score wins,
  then the faster one.
- **Demoted** (moved last, never removed): complete slots scoring under **70** in the category, and MiniMax for
  Yorùbá, Hausa and Igbo whatever a later benchmark says (`NEVER_HEAD`).
- **No imported benchmark** (or rows without per-set data): the built-in `STATIC` table, which is this rule run on
  `bench/results/2026-11-12.eval.json` (a unit test keeps the two in step).

Importing a benchmark (Admin › Evaluation › Import benchmark, or `POST /admin/evaluation/bench`) clears the routing
cache, so the new table is live within seconds; on other workers within 30 s.

## Derived table from bench 2026-11-12

| Category | Default | Specialist | Last in chain | Why |
|---|---|---|---|---|
| Everyday | Gemma 4 26B | **MiniMax M3.1 Flash** | – | 100 vs 76.9 (needed 81.9; MiniMax is faster here) |
| Exam study | Gemma 4 26B | – | – | MiniMax 100 vs 97.4: under the margin |
| Code | Gemma 4 26B | – | – | tie at 100 |
| Reasoning | Gemma 4 26B | – | – | tie at 100 |
| Tools / research | Gemma 4 26B | – | – | tie at 100 |
| Naijá (Pidgin) | Gemma 4 26B | – | – | Gemma 4 26B 100 is best |
| Yorùbá | Gemma 4 26B | – | MiniMax | tie at 100 with Gemma 4 31B; MiniMax 66 |
| Hausa | Gemma 4 26B | – | MiniMax | Gemma 4 31B 100 vs 90.9 but 18.3 s median first token (needed 104.6, over 15 s); MiniMax 51 |
| Igbo | Gemma 4 26B | – | MiniMax | tie at 90.9; MiniMax 57 |

Caveat: Gemma 4 26B's lower Everyday (and Hausa/Igbo) scores come from Google free-tier 500 errors, which the benchmark
counts as wrong; in production those requests fall back. A re-benchmark with fewer upstream errors may give Everyday
back to Gemma 4 26B automatically.

## Admin

- **Admin › Routing**: a read-only "Specialist routing" card (who leads each category, the reason, what goes last,
  the rule and the source: imported benchmark or built-in) and an **On / Off** switch saved with the routing setting
  (`app_settings.routing.specialists`). `GET /admin/routing` returns it as `specialists`; `PATCH /admin/routing`
  accepts `specialists: true|false` (kept when not sent; no benchmark gate, since the table comes from the benchmark).
- **Admin › Evaluation › Import benchmark**: pick `bench/results/<run>.eval.json`; it is posted to
  `POST /admin/evaluation/bench`. The import now also accepts the report's local "finished" time
  (`Thu 2026-11-12 1:52 PM WAT (UTC+01:00)`) as well as ISO.
- Environment fallback when the admin switch was never saved: `AI_SPECIALIST_ROUTING=on|off` (default `on`).

## Tests

`tests/unit/specialists.test.js` (classifier, derivation: margin, latency budget, incomplete exclusion, weak/never-
head demotion, no-eval fallback, static table = committed bench; chain head reordering; hedging waves; on/off
setting; import time parsing) and `tests/integration/specialist-routing.test.js` (mock provider over HTTP through
`chat/reply.js`: the Hausa specialist answers and the log names the route, Off restores the default, MiniMax-like
weak models stay out of the first hedged wave, a failing specialist still falls back; Admin GET/PATCH routing).

## Limits

- The classifier is keyword-based: short or mixed messages fall back to `everyday` (or the reply language), and
  only the last user message is read (plus attachment names).
- The specialist must already be in the route; an admin route that leaves it out simply keeps its own head.
- Categories are judged against one reference route each; another mode's route is reordered with the same decision.
- No migration, no new dependency. Specialist decisions are not yet written to `ai_calls` (only to stderr.log).
