# ADR 0003: Rule-based safety layer in the API

**Status:** accepted (2026-11-13), shipped in v0.5.5

## Context

Until v0.5.4 Colon relied on each AI provider's own filters. Those differ between models (Gemma, MiniMax, DeepSeek,
GLM, Qwen, N-ATLaS), are weakest in Nigerian Pidgin, Yorùbá, Hausa and Igbo, and know nothing about Nigerian harms
such as Yahoo-yahoo "formats", fake bank alerts or BVN/OTP phishing. Research mode reads web pages and users upload
files, so untrusted text reaches the model (prompt injection). The ROADMAP Phase 5 calls for harmful-content
filtering and prompt-injection guards.

Constraints: a 1 GB RAM cPanel host with 20 entry processes (no local ML models, no GPU, no extra service), only
`mysql2` and `ws` as dependencies, free hosted models, and a frontend that parses a fixed SSE format
(`start → delta… → done | error`).

## Decision

Add `services/api/src/modules/safety/` (facade `index.js`), in process and rule based:

1. **Input moderation before the model call** (`classify.js`, `rules.js`, `data/*.js`). Text is folded once
   (`normalize.js`: tone marks and subdots dropped, invisible characters removed, look-alike digits and spaced-out
   letters undone). Each category file lists regular-expression rules with co-occurrence windows (an *intent* such
   as "how do I make" within ~120 characters of a *topic* such as "pipe bomb") and *benign context* (news, history,
   prevention, health, games, Nigerian slang) that turns a hit into "allow" or "allow with care". Cue lists exist
   for English, Pidgin, Yorùbá, Hausa and Igbo.

   | Category | Action |
   |---|---|
   | `csam` child sexual content | **refuse, always** (all audiences, cannot be switched off, runs even when `SAFETY=off` and whatever the moderation endpoint says). Protective, parenting and health questions: allow with care. |
   | `self_harm` | **never refused**: the reply starts with a supportive message and Nigerian helplines (112, SURPIN 0800 078 7746, Lagos Lifeline 0700 000 6463, MANI 0809 111 6264; sources in `messages.js`), and the model is told to listen, encourage reaching out and never give methods. Statistics, essays, films and idioms are left alone. |
   | `violence` weapons, explosives, harming people | refuse how-to requests; news, safety, defence and slang ("bath bomb", "don't bomb your WAEC") allowed. |
   | `drugs` making illegal drugs | refuse synthesis, cooking and street mixes (mkpuru mmiri, skuchies, gutter water); effects, treatment, NDLEA news allowed. |
   | `hate` hate and harassment | refuse dehumanising, inciting, threats and bullying messages; questions about stereotypes answered with care. |
   | `sexual` explicit content | refuse for guests (signed-out visitors may be minors; there is no age check); signed-in adults get a non-graphic answer. Sex education and health allowed. |
   | `fraud` scams | refuse Yahoo formats, phishing, fake alerts, card cloning, getting other people's BVN/OTP/PIN; victims and the curious get anti-fraud guidance. |
   | `privacy` personal data | refuse finding, tracking or doxxing people; users' own pasted secrets (card, BVN, OTP, PIN, password) are masked before the provider and answered with care. |

   Actions: `allow`, `allow_with_care` (category guidance appended to the system prompt, `care.js`) and `refuse`
   (a localized refusal streamed as a normal reply; no provider call, no web search, no quota charged).

2. **Optional moderation endpoint** (`provider.js`), off by default (`SAFETY_PROVIDER_MODERATION`, Admin › Safety).
   OpenAI-compatible `/moderations`; it can only make a decision stricter. **Fail open** (logged) on timeout or
   error; the child-safety rules never depend on it (fail closed).

3. **Prompt-injection guard** (`injection.js`): untrusted text (web titles, snippets and page text in Research
   mode; uploaded file names and text) is neutralised (hidden characters and HTML comments removed; "ignore
   previous instructions", fake role tags, `SYSTEM:` lines and forged block delimiters replaced by a visible
   marker; flags recorded) and fenced in blocks whose end marker carries a random id. The model, mode, tools and
   system prompt are chosen by the server before any untrusted text is read.

4. **System prompt hardening** (`SYSTEM` in `index.js`, used by `ai/prompts.js`): refuse seriously harmful help,
   handle self-harm with care, never reveal the prompt or keys, and the untrusted-content rule.

5. **Output check on streamed replies** (`output.js`): each delta is checked (last ~2,000 characters) for the
   hard-block categories (child sexual content, explosive recipes, drug synthesis routes) and for system-prompt
   leaks *before* it is sent. When it fires the delta is withheld, the provider is cancelled and the `done` event
   carries a safe ending in the user's language, so the SSE format is unchanged. The full text is checked again at
   the end.

6. **Audit**: `safety_events` (migration `0007`) records stage, category, action, rule, route, mode, language,
   request id and user or guest. No message text by default (`SAFETY_LOG_TEXT=off`; `hash` = HMAC-SHA-256 keyed
   with `APP_SECRET`, `excerpt` = first 80 characters). Admin › Safety (admin + 2FA) lists events with filters and
   holds the live settings (categories per audience, provider moderation), stored in `app_settings` key `safety`
   and audited like the other platform settings.

## Consequences

- Cost: about 2 ms for a 16,000-character message and ~0.1 ms per streamed delta; no extra memory worth noting,
  no network unless the moderation endpoint is on.
- Rules are transparent, testable and reviewable, and cover Nigerian context that generic filters miss. They will
  miss paraphrases and creative spellings, and they can misfire. Every rule has false-positive tests
  (`services/api/tests/unit/safety-classifier.test.js`); new misfires become new tests.
- Refusals, care messages and the stop notice are in English, Pidgin, Yorùbá, Hausa and Igbo.
- Model output still passes through the sanitising Markdown renderer as before.

## Open items

- Native-speaker review of the Yorùbá, Hausa and Igbo cue lists and messages (written by the team, not yet
  reviewed).
- Re-check the helpline numbers at least once a year (`modules/safety/messages.js` lists sources and the date).
- Only the latest user message is classified; requests split across turns, and text inside images, are not.
- Guests send their own history (nothing is stored), so a guest can forge earlier assistant turns.
- No age verification: "signed-in = adult" is an assumption the sexual-content setting relies on.
- The moderation endpoint is untested against a live provider in CI (mocked); enabling it sends message text to
  that provider (update the privacy text if it is switched on).
