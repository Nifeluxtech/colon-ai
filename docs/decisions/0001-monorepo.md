# ADR 0001: One monorepo

**Status:** accepted (2026-11-11)

All apps share one backend, one brand and one release cycle, so they live in one repository: `apps/`, `services/`, `packages/`, `database/`, `docs/`. The repository is public so cPanel can clone it over HTTPS without shell access, and secrets stay in server environment variables.
