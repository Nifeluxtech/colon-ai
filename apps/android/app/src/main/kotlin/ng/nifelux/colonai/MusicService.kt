package ng.nifelux.colonai

import android.app.PendingIntent
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Colon Music, Step 3: the media session around [ColonMusic]'s player. Media3 shows the playback notification and
 * keeps the service in the foreground (type mediaPlayback) while music plays, so it goes on with Colon closed.
 * Tapping the notification opens the chat. Colon AI flavor only (declared in the colonai manifest).
 */
@OptIn(UnstableApi::class)
class MusicService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val s = MediaSession.Builder(this, ColonMusic.player(this)).setSessionActivity(open).build()
        session = s
        addSession(s)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = session?.player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        session?.release()
        session = null
        ColonMusic.release()
        super.onDestroy()
    }
}
