# Workspace — source notes (owner's ChatGPT chats, Nov 22, 2026; name later changed from "Colon Dev" to "Workspace")

Full plan: plan.md (wins where these notes differ).

## Idea (share 1)
Chat-first dev workspace: Describe → Colon builds → live preview → ask for changes → Publish → unique URL.
Five areas: Chat (default), Preview, Code (optional Monaco tab), Files, Publish. Nav: New Project, My Projects,
Templates, Published, Files, Settings. Each published project gets its own subdomain (ChatGPT suggested
projectname.colon.site — domain NOT owned; must pick a domain the user controls). Publishing: auto subdomain,
HTTPS (AutoSSL), redeploy, unpublish, custom domain later, deploy history, traffic stats. Static sites on cPanel
(wildcard DNS + docroot); dynamic apps need a separate isolated runner. Free: projects, chat coding, previews,
static publishing, subdomains, with quotas.

## Free tools (share 2)
Colon-owned logical agents on one model (Master, Planner, Architect, UI/UX, Frontend, Backend, Database, Debug,
Testing, Security, Optimization, Docs, Deployment). Colon-owned engines (Project/File, Context/Memory, Patch/Build,
Preview/Test, Security, Deployment/Domain, Version). Start list: shadcn/ui, Assistant UI (ref), Monaco, Vite,
Prettier, ESLint, Tree-sitter, Playwright, Sandpack, Piston/Judge0 CE (self-host, later). Avoid: Codespaces,
Replit, Vercel/Netlify dependency, E2B, Browserless, OpenHands Cloud, public Piston API, paid AI/DB.
Reference repos: bolt.diy, Dyad, Onlook, screenshot-to-code, open-lovable, LlamaCoder, OpenHands, Aider, Goose.

## Fit with current repo (0.24.4)
Already has: Developer mode, Monaco code-edit on code blocks (v0.17), Projects with files + Git repos (0.24.0).
Note: share 2 suggests React+Vite+shadcn; current chat app is vanilla ES modules — rewriting is not needed.
