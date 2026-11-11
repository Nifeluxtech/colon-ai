# Contributing to Colon AI

## Branches
- `main`: production. Every commit must be deployable.
- `feature/<short-name>`, `fix/<short-name>`: work branches, merged by pull request.

## Commits
Conventional style: `feat(api): add chat endpoint`, `fix(chat): stop button`, `docs: deployment guide`.
Scopes: `api`, `chat`, `browser`, `admin`, `brand`, `db`, `docs`, `ci`.

## Rules
- No secrets in code. Use `.env.example` for new variable names.
- Keep services stateless: workers can be recycled, so persist state in MySQL.
- Each roadmap phase ships only when it meets its release standard (see ROADMAP.md).
