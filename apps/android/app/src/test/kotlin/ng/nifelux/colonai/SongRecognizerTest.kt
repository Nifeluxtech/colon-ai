package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Test

/** OS Assistant Step 4: songprint first, then the Shazam app hand-off, else no match (free providers only). */
class SongRecognizerTest {
    @Test fun foundWinsThenShazamThenNoMatch() {
        assertEquals("found", SongRecognizer.outcome(found = true, shazamInstalled = true))
        assertEquals("found", SongRecognizer.outcome(found = true, shazamInstalled = false))
        assertEquals("handed_off", SongRecognizer.outcome(found = false, shazamInstalled = true))
        assertEquals("no_match", SongRecognizer.outcome(found = false, shazamInstalled = false))
    }

    @Test fun shortAudioNeverReachesTheNetwork() {
        assertEquals(null, SongRecognizer.recognise(ShortArray(100)))
    }

    @Test fun handsOffOnlyToShazam() {
        assertEquals("com.shazam.android", SongRecognizer.SHAZAM_PACKAGE)
    }
}
