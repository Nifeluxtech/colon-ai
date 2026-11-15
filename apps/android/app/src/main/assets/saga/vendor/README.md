# Vendored third-party code (Colon AI 0.11.5)

Kept as published, each with its own licence file (scripts/check.js rule 6 fails without one).

| Directory | Project | Version | Licence | Used by |
| --- | --- | --- | --- | --- |
| `readability/` | Mozilla Readability (`Readability.js`) | 0.6.0 (npm `@mozilla/readability`) | Apache-2.0 | `saga/summary.js`: the page summary the chat model sees |
| `turndown/` | Turndown (`dist/turndown.js`) | 7.2.5 (npm `turndown`) | MIT | `saga/summary.js`: Readability's HTML to short Markdown |
| `consent-o-matic/` | Consent-O-Matic rules (`rules.json`) | github.com/cavi-au/Consent-O-Matic master @ 8ca8500 | MIT | `saga/consent.js`: known cookie banners rejected with no model call |

`consent-o-matic/rules.json` is a curated subset (51 of the ~200 rules: the common consent platforms and big sites;
only detectors and the reject methods), built with `node scripts/vendor-consent-rules.js <checkout>`.
