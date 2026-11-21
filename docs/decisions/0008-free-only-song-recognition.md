# ADR 0008: Song recognition uses free providers only

**Status:** accepted (2026-11-21, v0.22.0). Free-only by owner decision 2026-11-21.

## Context

Step 4 of the OS Assistant plan (`docs/os-assistant/plan.md`) originally listed AudD (a paid API after 300 test
requests, key on the server) and later ShazamKit (needs a $99/yr Apple Developer account). The owner's rule for the
whole assistant is to use the best free tools.

## Decision

1. Song recognition goes through `SongRecognizer.kt`, an adapter with free providers only, in order: songprint on
   the phone (a Shazam-compatible signature; only the signature leaves the phone), then a hand-off to the Shazam app
   by intent when it is installed.
2. ShazamKit and paid AudD are removed from the plan. No paid provider code, keys or config are added.

## Consequences

- songprint depends on Shazam's unofficial public endpoint; if it stops, the hand-off to the Shazam app still works
  for users who have it, and everyone else gets "I couldn't recognise that song".
- A hand-off shows the answer in Shazam, not in Colon, so "play it" can't follow it.
- Revisit only by a new owner decision.
