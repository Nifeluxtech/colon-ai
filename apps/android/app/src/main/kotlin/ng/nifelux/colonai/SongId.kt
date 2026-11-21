package ng.nifelux.colonai

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaRecorder
import android.net.Uri
import android.util.Base64
import androidx.core.content.ContextCompat
import io.github.hitenpatel.songprint.Pcm
import io.github.hitenpatel.songprint.SignatureGenerator
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteOrder
import java.util.UUID

/**
 * Colon Music, Steps 3-4: "what song is this?". songprint (vendored, MIT) turns about 11 seconds of 16 kHz mono
 * audio into a Shazam-compatible signature on the phone; only that signature (a few KB, never the audio) goes to
 * Shazam's public but unofficial discovery endpoint, which answers with the title and artist. Used for the mic when
 * Colon's own player is idle, and for untagged files in the player (decoded from the file, no mic). Background
 * threads only.
 */
object SongId {
    class Found(val title: String, val artist: String, val link: String?)

    private const val ENDPOINT = "https://amp.shazam.com/discovery/v5/en/US/android/-/tag"
    private const val RATE = 16000
    const val SECONDS = 11

    fun recognise(mono16k: ShortArray): Found? {
        if (mono16k.size < RATE * 3) return null
        val sig = SignatureGenerator().generateSignature(mono16k)
        val json = post(sig, mono16k.size) ?: return null
        return parse(json)
    }

    fun parse(json: String): Found? = try {
        val t = JSONObject(json).optJSONObject("track")
        val title = t?.optString("title").orEmpty()
        if (t == null || title.isBlank()) null
        else Found(title, t.optString("subtitle"), t.optJSONObject("share")?.optString("href")?.ifBlank { null })
    } catch (_: Exception) { null }

    private fun post(sig: ByteArray, samples: Int): String? {
        val id1 = UUID.randomUUID().toString().uppercase()
        val id2 = UUID.randomUUID().toString().uppercase()
        val url = URL("$ENDPOINT/$id1/$id2?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3" +
            "&sharehub=true&video=v3")
        val body = JSONObject()
            .put("signature", JSONObject()
                .put("uri", "data:audio/vnd.shazam.sig;base64," + Base64.encodeToString(sig, Base64.NO_WRAP))
                .put("samplems", samples * 1000L / RATE))
            .put("timestamp", System.currentTimeMillis())
            .put("context", JSONObject()).put("geolocation", JSONObject())
        val c = url.openConnection() as HttpURLConnection
        return try {
            c.requestMethod = "POST"
            c.doOutput = true
            c.connectTimeout = 10000
            c.readTimeout = 12000
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("Content-Language", "en_US")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            if (c.responseCode == 200) c.inputStream.bufferedReader().use { it.readText() } else null
        } catch (_: Exception) {
            null
        } finally {
            c.disconnect()
        }
    }

    /** About [seconds] of the mic as 16 kHz mono, or null without the permission or a working mic. */
    @SuppressLint("MissingPermission")
    fun recordMic(context: Context, seconds: Int = SECONDS): ShortArray? = ColonMic.using { record(context, seconds) }

    @SuppressLint("MissingPermission")
    private fun record(context: Context, seconds: Int): ShortArray? {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED) return null
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return null
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.MIC, RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, maxOf(min, RATE))
        } catch (_: Exception) { return null }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); return null }
        val out = ShortArray(RATE * seconds)
        var got = 0
        try {
            rec.startRecording()
            while (got < out.size) {
                val n = rec.read(out, got, minOf(2048, out.size - got))
                if (n <= 0) break
                got += n
            }
        } catch (_: Exception) {
        } finally {
            try { rec.stop() } catch (_: Exception) {}
            rec.release()
        }
        return if (got > 0) out.copyOf(got) else null
    }

    /** About [seconds] of a song file from a third of the way in (past the intro), as 16 kHz mono. */
    fun decodeFile(context: Context, uri: String, seconds: Int = SECONDS): ShortArray? {
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            ex.setDataSource(context, Uri.parse(uri), null)
            val track = (0 until ex.trackCount).firstOrNull {
                ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return null
            ex.selectTrack(track)
            val fmt = ex.getTrackFormat(track)
            var rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val dur = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) else 0L
            ex.seekTo(minOf(30_000_000L, dur / 3), MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            val c = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME) ?: return null)
            codec = c
            c.configure(fmt, null, null, 0)
            c.start()
            val pcm = ShortArrayBuilder()
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var loops = 0
            while (loops++ < 20000) {
                if (pcm.size >= rate * channels * seconds) break
                if (!inputDone) {
                    val i = c.dequeueInputBuffer(10000)
                    if (i >= 0) {
                        val buf = c.getInputBuffer(i) ?: break
                        val n = ex.readSampleData(buf, 0)
                        if (n < 0) {
                            c.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            c.queueInputBuffer(i, 0, n, ex.sampleTime, 0)
                            ex.advance()
                        }
                    }
                }
                val o = c.dequeueOutputBuffer(info, 10000)
                if (o >= 0) {
                    val ob = c.getOutputBuffer(o)
                    if (ob != null && info.size > 0) {
                        ob.position(info.offset)
                        ob.limit(info.offset + info.size)
                        pcm.add(ob.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer())
                    }
                    c.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                } else if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    rate = c.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = c.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                }
            }
            if (pcm.size == 0) return null
            return Pcm.resampleToMono16k(pcm.toArray(), rate, channels)
        } catch (_: Exception) {
            return null
        } finally {
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            ex.release()
        }
    }

    private class ShortArrayBuilder {
        private var data = ShortArray(65536)
        var size = 0
            private set

        fun add(b: java.nio.ShortBuffer) {
            val n = b.remaining()
            if (size + n > data.size) data = data.copyOf(maxOf(data.size * 2, size + n))
            b.get(data, size, n)
            size += n
        }

        fun toArray(): ShortArray = data.copyOf(size)
    }
}
