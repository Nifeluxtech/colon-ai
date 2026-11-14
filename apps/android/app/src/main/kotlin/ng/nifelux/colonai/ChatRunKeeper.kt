package ng.nifelux.colonai

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Base64
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * 0.10.3: keeps each chat's Saga task state ([ChatRun]) and its finished task cards on the phone, so the chat shows
 * them after an app restart. Finished cards keep a small JPEG of the page as it was when the task ended (taken from
 * the live WebView, which is then let go): at most [CardRules.MAX_SNAPSHOTS] per chat and [CardRules.MAX_BYTES] in
 * all, the oldest dropped first; a chat's cards go with its browser (forget). Never page text, never field values.
 */
class ChatRunKeeper(context: Context) {
    private val prefs = context.getSharedPreferences("colon.chat.runs", Context.MODE_PRIVATE)
    private val dir = File(context.filesDir, "saga-cards")

    /** The chat's run. The first read in this process maps a task that was live when the app died (ChatRun.restore). */
    fun run(chat: String): ChatRun.Run {
        val r = ChatRun.fromJson(read("run:$chat"))
        if (!restoredThisProcess.add(chat)) return r
        val back = ChatRun.restore(r)
        if (back != r) setRun(chat, back)
        return back
    }

    fun setRun(chat: String, r: ChatRun.Run) { prefs.edit().putString("run:$chat", ChatRun.toJson(r).toString()).apply() }

    fun cards(chat: String): List<CardRules.Card> = try {
        val a = JSONArray(prefs.getString("cards:$chat", "[]") ?: "[]")
        (0 until a.length()).mapNotNull { CardRules.Card.fromJson(a.optJSONObject(it)) }
    } catch (_: Exception) { emptyList() }

    /** Adds (or updates, same task) a finished card with its picture, then applies the caps. */
    fun saveCard(chat: String, card: CardRules.Card, jpeg: ByteArray?) {
        val withShot = if (jpeg != null && jpeg.isNotEmpty()) {
            val f = File(chatDir(chat), "${card.id}.jpg")
            try { f.parentFile?.mkdirs(); f.writeBytes(jpeg); card.copy(shot = f.name, bytes = jpeg.size) }
            catch (_: Exception) { card }
        } else card
        val list = CardRules.upsert(cards(chat), withShot)
        val (kept, dropShots) = CardRules.cap(list)
        dropShots.forEach { File(chatDir(chat), it).delete() }
        prefs.edit().putString("cards:$chat", JSONArray(kept.map { it.toJson() }).toString()).apply()
    }

    /** The task's card gets its final line (the server's notice or the chat page's poll came after the picture). */
    fun finishCard(chat: String, id: String, state: String, result: String) {
        val c = cards(chat).firstOrNull { it.id == id } ?: return
        saveCard(chat, c.copy(state = state, result = ChatRun.clean(result).ifEmpty { c.result }), null)
    }

    /** The cards for the chat page: newest last, each with its picture as a data: URL when there is one. */
    fun cardsJson(chat: String): JSONArray = JSONArray(cards(chat).map { c ->
        c.toJson().apply {
            remove("shot"); remove("bytes")
            val f = c.shot?.let { File(chatDir(chat), it) }
            if (f != null && f.isFile) try {
                put("snapshot", "data:image/jpeg;base64," + Base64.encodeToString(f.readBytes(), Base64.NO_WRAP))
            } catch (_: Exception) { }
        }
    })

    /** A new chat got its conversation id: its draft's run and cards become the conversation's. */
    fun adopt(draft: String, chat: String) {
        val run = prefs.getString("run:$draft", null)
        val cards = prefs.getString("cards:$draft", null)
        val e = prefs.edit().remove("run:$draft").remove("cards:$draft")
        run?.let { e.putString("run:$chat", it) }
        cards?.let { e.putString("cards:$chat", it) }
        e.apply()
        restoredThisProcess.add(chat)
        val from = chatDir(draft)
        if (from.isDirectory) from.renameTo(chatDir(chat))
    }

    /** The chat (and its browser) was deleted: its run, cards and pictures go too. */
    fun forget(chat: String) {
        prefs.edit().remove("run:$chat").remove("cards:$chat").apply()
        chatDir(chat).deleteRecursively()
    }

    private fun read(key: String): JSONObject? = try { prefs.getString(key, null)?.let { JSONObject(it) } }
    catch (_: Exception) { null }

    private fun chatDir(chat: String) = File(dir, ChatSessionRules.profileName(chat))

    companion object {
        /** Chats whose stored run was already restored in this process (a recreated activity must not redo it). */
        private val restoredThisProcess = mutableSetOf<String>()

        /** The page as it is now, as a JPEG at most [maxWidth] px wide and [maxBytes] long; null when it can't be
         *  drawn (no size yet, or no memory on a small phone). */
        fun capture(wv: WebView?, maxWidth: Int = CardRules.SHOT_WIDTH, maxBytes: Int = CardRules.SHOT_BYTES):
            ByteArray? {
            if (wv == null || wv.width <= 0 || wv.height <= 0 || !wv.isAttachedToWindow) return null
            return try {
                val scale = minOf(1f, maxWidth.toFloat() / wv.width)
                val w = (wv.width * scale).toInt().coerceAtLeast(1)
                val h = (wv.height * scale).toInt().coerceAtLeast(1)
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565)
                val c = Canvas(bmp)
                c.scale(scale, scale)
                c.translate(-wv.scrollX.toFloat(), -wv.scrollY.toFloat())
                wv.draw(c)
                var bytes: ByteArray? = null
                for (q in intArrayOf(70, 55, 40)) {
                    val out = ByteArrayOutputStream()
                    bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
                    bytes = out.toByteArray()
                    if (bytes.size <= maxBytes) break
                }
                bmp.recycle()
                bytes?.takeIf { it.size <= maxBytes }
            } catch (_: Throwable) { null }
        }
    }
}

/** Which finished cards a chat keeps (pure, unit-tested in ChatRunTest). */
object CardRules {
    const val MAX_CARDS = 20
    const val MAX_SNAPSHOTS = 6
    const val MAX_BYTES = 600_000
    const val SHOT_WIDTH = 720
    const val SHOT_BYTES = 110_000

    /** [id] the task (or a local id); [anchor] the chat message it sits under; [shot] its picture's file name. */
    data class Card(val id: String, val goal: String, val anchor: String?, val state: String, val result: String,
                    val at: Long, val shot: String? = null, val bytes: Int = 0) {
        fun toJson(): JSONObject = JSONObject().put("id", id).put("goal", goal).put("anchor", anchor ?: JSONObject.NULL)
            .put("state", state).put("result", result).put("at", at).put("shot", shot ?: JSONObject.NULL)
            .put("bytes", bytes)

        companion object {
            fun fromJson(o: JSONObject?): Card? {
                val id = o?.optString("id")?.takeIf { it.isNotBlank() } ?: return null
                return Card(id.take(40), ChatRun.clean(o.optString("goal")),
                    o.optString("anchor").takeIf { !o.isNull("anchor") && it.isNotBlank() }?.take(64),
                    o.optString("state").take(16), ChatRun.clean(o.optString("result")), o.optLong("at"),
                    o.optString("shot").takeIf { !o.isNull("shot") && SHOT_NAME.matches(it) }, o.optInt("bytes"))
            }
        }
    }

    private val SHOT_NAME = Regex("^[A-Za-z0-9_.-]{1,60}\\.jpg$")

    /** Same task again: replaced in place (keeping its picture when the new one has none); else added last. */
    fun upsert(list: List<Card>, card: Card): List<Card> {
        val i = list.indexOfFirst { it.id == card.id }
        if (i < 0) return list + card
        val old = list[i]
        val merged = if (card.shot == null) card.copy(shot = old.shot, bytes = old.bytes) else card
        return list.toMutableList().also { it[i] = merged }
    }

    /** At most [MAX_CARDS] cards, [MAX_SNAPSHOTS] pictures and [MAX_BYTES] of pictures, newest kept. Returns the
     *  kept cards and the picture files to delete. */
    fun cap(list: List<Card>): Pair<List<Card>, List<String>> {
        val kept = list.sortedBy { it.at }.takeLast(MAX_CARDS)
        val drop = list.filter { it !in kept }.mapNotNull { it.shot }.toMutableList()
        var shots = 0
        var bytes = 0
        val out = kept.reversed().map { c ->
            if (c.shot == null) c
            else if (shots < MAX_SNAPSHOTS && bytes + c.bytes <= MAX_BYTES) { shots++; bytes += c.bytes; c }
            else { drop += c.shot; c.copy(shot = null, bytes = 0) }
        }.reversed()
        return out to drop
    }
}
