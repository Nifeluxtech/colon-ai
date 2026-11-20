# songprint (vendored)

Pure-Kotlin, Shazam-compatible audio signature generator by Hiten Patel, MIT licence (see LICENSE).
Source: https://github.com/hitenpatel/songprint at v0.1.0 (commit 49f4682). Copied unchanged: SignatureGenerator.kt,
Pcm.kt, Crc32.kt. Its RecognitionClient is not copied: it uses java.util.Base64 (Android 8+) while Colon supports
Android 7, so Colon's own ShazamClient (ng.nifelux.colonai.SongId) sends the signature instead.

Recognition goes to Shazam's public but unofficial, undocumented discovery endpoint (no key, free). It may change or
disappear; Colon uses it only for "what song is this?" from the mic or for untagged files, and fails politely.
