# ADR 0005: Saga drives the phone's WebView through the bridge, with approvals tapped on the phone

**Status:** accepted (2026-11-13, v0.9.0)

## Context

Phase 9 lets Saga browse for the user: open pages, read them, click, type and scroll in the Colon AI browser panel
(a real Android WebView with the user's own cookies), explain each step and cite the pages it used. The pages are
untrusted, the free models disagree on tool-calling formats, the host is a 1 GB cPanel server without a headless
browser, Passenger recycles workers, and the phone's socket and the HTTP request that starts a task can sit on
different workers. The ROADMAP release standard: multi-step tasks pass, injection attacks fail, approvals can't be
bypassed.

## Decision

1. **The loop runs on the server, the browser on the phone.** `services/api/src/modules/saga` asks the model for
   one action at a time (decision -> action -> observation) and sends it as one bridge `command`; the phone runs it
   on the panel's WebView and answers with `ack`. Cookies and logins never leave the phone.
2. **A fixed tool set, structured JSON.** The model answers with one JSON object `{ say, action, args }` (works
   with every free model, no provider tool-calling needed; the parser accepts the usual deviations). `tools.js`
   rebuilds each action's arguments from a per-tool allow-list and maps it to exactly one phone command; no tool
   runs arbitrary JavaScript. The page script (`assets/saga/tools.js`) ships inside the app, never from the server.
3. **Limits:** step limit, whole-task timeout, per-decision model timeout and per-command phone timeout (longer
   when the user must tap); two timeouts in a row end the task. Take control, Pause, Stop and a dropped socket end
   it at once (the bridge already cancels pending commands).
4. **Pages can't instruct Saga.** Every observation (text, title, element labels, links, tab titles) goes through
   the safety layer's injection guard and is fenced with a random-id marker, like Research mode; Saga's rules,
   tools and limits are fixed before any page is read, and flags are logged as safety events.
5. **Approvals are tapped on the phone, from two independent checks.** The server classifies each command
   (`policy.js`: payment, purchase, send_message, form_submission, personal_data) and the phone classifies the real
   element at action time (`tools.js inspect`); the stronger one wins and the step waits for **Approve**. There is
   no way to pre-approve: model arguments are rebuilt, the server can add an approval but never remove one, and an
   `ok` answer without `approval: "approved"` to a flagged step stops the task. In Shared mode every changing step
   asks.
6. **Everything in MySQL.** `saga_tasks` and `saga_actions` (migration 0009) hold the task, each step (explanation,
   command, arguments with typed personal data hidden, approval asked/given, result, page) and the answer with its
   cited pages: the audit log and the replay for the user (`GET /browser/agent/:id`) and admins (Admin › Browser).
   A task is queued in MySQL and claimed by the worker that holds the phone's socket; Stop is a flag any worker can
   set.

## Consequences

- Works with today's free models and host; a step costs one model call (one wave of the hedged router) and one
  round trip to the phone, so a task of 5–10 steps takes tens of seconds.
- The phone must have Colon AI open (or Colon Browser) and be connected; there is no push to wake it yet. Older apps
  (no `get_page_content` capability) get `app_update_needed` and the chat falls back to the web reader.
- Page JavaScript shares the main world with the injected script, so a hostile page can patch DOM prototypes and
  mislead the phone's own check. The server's check is independent of it, and the dialog shows what Saga is about
  to do; the residual risk is listed in the threat model.
- Screenshots are taken and logged by size only; they are not given to the model yet (most free models in the
  chain read no images).
