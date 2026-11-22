package ng.nifelux.colonai

import android.content.Context
import android.util.Log
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig

/**
 * 0.23.0: sherpa-onnx keyword spotting (v2.0.2, Apache-2.0) with the gigaspeech 3.3M model (not -mobile), from assets
 * kws/ (encoder and joiner int8, decoder fp32, tokens.txt; CI downloads them, sha256-checked) and the committed
 * kws/keywords.txt holding [WakeWordEngine.KEYWORDS]. Built only when the AAR is in app/libs (app/build.gradle.kts).
 */
object WakeEngines {
    const val BUNDLED = true

    fun create(context: Context): WakeWordEngine? = try { SherpaKwsEngine(context) } catch (e: Throwable) {
        Log.w("ColonWake", "sherpa-onnx KWS failed to load", e); null
    }
}

class SherpaKwsEngine(context: Context) : WakeWordEngine {
    override val name = "sherpa-onnx KWS 2.0.2 (gigaspeech 3.3M)"

    private val kws = KeywordSpotter(context.assets, KeywordSpotterConfig(
        featConfig = FeatureConfig(sampleRate = WakeWordEngine.SAMPLE_RATE, featureDim = 80),
        modelConfig = OnlineModelConfig(
            transducer = OnlineTransducerModelConfig(
                encoder = "$DIR/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
                decoder = "$DIR/decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
                joiner = "$DIR/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
            ),
            tokens = "$DIR/tokens.txt",
            numThreads = 1,
            provider = "cpu",
            modelType = "zipformer2",
        ),
        keywordsFile = "$DIR/keywords.txt",
    ))
    private val stream: OnlineStream = kws.createStream()

    override fun accept(samples: FloatArray): String? {
        stream.acceptWaveform(samples, WakeWordEngine.SAMPLE_RATE)
        while (kws.isReady(stream)) {
            kws.decode(stream)
            val k = kws.getResult(stream).keyword
            if (k.isNotBlank()) { kws.reset(stream); return k }
        }
        return null
    }

    override fun reset() = kws.reset(stream)

    override fun release() { stream.release(); kws.release() }

    private companion object { const val DIR = "kws" }
}
