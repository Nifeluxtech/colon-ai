package ng.nifelux.colonai

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.os.Build
import android.provider.MediaStore

/**
 * Colon Music, Step 3: the songs on the phone (MediaStore). Needs READ_MEDIA_AUDIO on Android 13+ (the user is asked
 * the first time they say "play ..."), READ_EXTERNAL_STORAGE before. Runs off the main thread.
 */
object MusicLibrary {
    private const val MAX_CANDIDATES = 400

    fun permission(): String = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO
        else Manifest.permission.READ_EXTERNAL_STORAGE

    /** Best matches first (or, for "*", the whole library shuffled); at most [limit] songs. */
    fun search(context: Context, query: String, limit: Int = 50): List<Track> {
        val all = MusicRules.wantsAll(query)
        val word = MusicRules.words(query).maxByOrNull { it.length }?.replace(Regex("[%_]"), "")
        val m = MediaStore.Audio.Media.IS_MUSIC + " != 0"
        val like = "(" + listOf(MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DISPLAY_NAME).joinToString(" OR ") { "$it LIKE ?" } + ")"
        val selection = if (all || word.isNullOrEmpty()) m else "$m AND $like"
        val args = if (all || word.isNullOrEmpty()) null else Array(4) { "%$word%" }
        val cols = arrayOf(MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DISPLAY_NAME)
        val found = mutableListOf<Pair<Int, Track>>()
        try {
            context.contentResolver.query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cols, selection, args, null)
                ?.use { c ->
                    while (c.moveToNext() && found.size < MAX_CANDIDATES) {
                        val id = c.getLong(0)
                        val title = c.getString(1).orEmpty()
                        val artist = c.getString(2).orEmpty()
                        val album = c.getString(3).orEmpty()
                        val file = c.getString(4).orEmpty()
                        val score = if (all) 1 else MusicRules.score(query, title, artist, album)
                            .coerceAtLeast(MusicRules.score(query, file.substringBeforeLast('.'), "", ""))
                        if (score <= 0) continue
                        val uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id)
                        found += score to Track(title.ifBlank { file }, artist, album, uri.toString(), "phone",
                            MusicRules.tagged(title, artist, file))
                    }
                }
        } catch (_: SecurityException) {
            return emptyList()
        }
        val tracks = if (all) found.map { it.second }.shuffled() else found.sortedByDescending { it.first }
            .map { it.second }
        return tracks.take(limit)
    }
}
