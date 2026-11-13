package ng.nifelux.colonai

/**
 * The new-tab page: Colon mark, a search box and bookmark shortcuts. Static HTML with no script, loaded with
 * loadDataWithBaseURL, so it works offline and costs nothing. Pure, unit-tested (escaping) in HomePageTest.
 */
object HomePage {
    fun html(bookmarks: List<BrowserStore.Entry>, dark: Boolean): String {
        val bg = if (dark) "#080F24" else "#FFFFFF"
        val text = if (dark) "#F1F5FF" else "#0F172A"
        val muted = if (dark) "#8190B8" else "#64748B"
        val field = if (dark) "#101B3D" else "#F5F8FF"
        val line = if (dark) "rgba(110,140,235,.28)" else "#CBD5E1"
        val tiles = bookmarks.take(8).joinToString("") { b ->
            val label = b.title.ifBlank { UrlRules.originOf(b.url)?.substringAfter("://") ?: b.url }
            val letter = label.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar() ?: '•'
            "<a class=\"tile\" href=\"${UrlRules.html(b.url)}\"><span>${UrlRules.html(letter.toString())}</span>" +
                "<b>${UrlRules.html(label.take(40))}</b></a>"
        }
        return """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>New tab</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;
padding:12vh 20px 24px;background:$bg;color:$text;font:16px/1.5 system-ui,-apple-system,Roboto,sans-serif}
svg{width:64px;height:64px}h1{font-size:20px;letter-spacing:.12em;margin:12px 0 22px;font-weight:800}
form{width:100%;max-width:520px}input{width:100%;height:50px;border-radius:999px;border:1px solid $line;
background:$field;color:$text;padding:0 20px;font-size:16px;outline:none}
input:focus{border-color:#4169E1;box-shadow:0 0 0 3px rgba(65,105,225,.25)}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;width:100%;max-width:520px;margin-top:28px}
.tile{display:flex;flex-direction:column;align-items:center;gap:6px;color:$text;text-decoration:none;min-width:0}
.tile span{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:$field;
border:1px solid $line;font-weight:700;color:#4169E1}.tile b{font-size:12px;font-weight:500;color:$muted;
max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
p{color:$muted;font-size:13px;margin-top:auto;text-align:center}
</style></head><body>
<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#101B3D"/>
<path fill="#4169E1" d="M24 5c5 6 11 11 11 20a11 11 0 0 1-22 0c0-4 1.6-7.4 4.2-10.2.4 3.2 2 5.3 4.4 6.3C20.7 15 21.6 9.6 24 5z"/>
<path fill="#FF9A3D" d="M24 20c2.3 3 5 5.3 5 9.2a5 5 0 0 1-10 0c0-1.9.7-3.4 2-4.6.2 1.4.9 2.4 2 2.8-.3-2.9.1-5.2 1-7.4z"/>
</svg><h1>COLON</h1>
<form action="https://www.google.com/search" method="get" role="search">
<input name="q" type="search" placeholder="Search the web" aria-label="Search the web" autocomplete="off"></form>
<div class="tiles">$tiles</div>
<p>Colon Browser · your history and bookmarks stay on this phone</p>
</body></html>"""
    }
}
