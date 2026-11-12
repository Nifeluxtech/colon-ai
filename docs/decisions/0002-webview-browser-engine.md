# ADR 0002: Android WebView as the browser engine

**Status:** accepted (2026-11-11)

Phase 1 tests showed that headless Chromium can't run on the cPanel plan: 1 GB RAM, recycled workers, and background processes killed. Colon Browser therefore runs on the Android System WebView, which is Chromium on the user's own phone, at no cost. The web version gets a light reader/proxy mode. Server-side Chromium is a later upgrade (ROADMAP Phase 12).
