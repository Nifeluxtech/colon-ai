package ng.nifelux.colonai

import android.content.Context
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer

/** One song Colon can play: from the phone's library (source "phone") or a Jamendo stream (source "jamendo"). */
data class Track(val title: String, val artist: String, val album: String, val uri: String, val source: String,
    val tagged: Boolean = true)

/**
 * Colon Music, Step 3: Colon's own player (Media3 ExoPlayer, main thread only). [MusicService] wraps it in a media
 * session, so the notification, lock screen, headset buttons and Step 2's "next song" / "pause" control it. The queue
 * is kept beside the player so "what song is this?" can answer from it without the mic.
 */
@OptIn(UnstableApi::class)
object ColonMusic {
    private var player: ExoPlayer? = null
    private val queue = mutableListOf<Track>()

    fun player(context: Context): ExoPlayer = player ?: ExoPlayer.Builder(context.applicationContext)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
        .setHandleAudioBecomingNoisy(true)
        .build().also { player = it }

    fun play(context: Context, tracks: List<Track>) {
        if (tracks.isEmpty()) return
        val p = player(context)
        queue.clear()
        queue.addAll(tracks)
        p.setMediaItems(tracks.map { item(it) })
        p.prepare()
        p.play()
        try { context.startService(Intent(context, MusicService::class.java)) } catch (_: Exception) {}
    }

    private fun item(t: Track): MediaItem = MediaItem.Builder().setUri(t.uri).setMediaId(t.uri)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(t.title).setArtist(t.artist).setAlbumTitle(t.album)
            .build()).build()

    /** The song loaded in Colon's player, or null when nothing is. */
    fun current(): Track? {
        val p = player ?: return null
        if (p.mediaItemCount == 0 || p.playbackState == Player.STATE_IDLE || p.playbackState == Player.STATE_ENDED) {
            return null
        }
        return queue.getOrNull(p.currentMediaItemIndex)
    }

    val isPlaying: Boolean get() = player?.isPlaying == true

    fun stop() {
        player?.let { it.stop(); it.clearMediaItems() }
        queue.clear()
    }

    /** Called when [MusicService] ends: the next play builds a fresh player. */
    fun release() {
        player?.release()
        player = null
        queue.clear()
    }
}
