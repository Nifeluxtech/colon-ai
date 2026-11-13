package ng.nifelux.colonai

/**
 * Rules for private (incognito) tabs. Pure, unit-tested in PrivateBrowsingTest.
 *
 * A private tab: records no history, is never saved for the next launch, keeps no cache, and on WebViews that
 * support profiles (androidx.webkit MULTI_PROFILE on a recent Android System WebView) gets its own cookie jar and site storage in a
 * throwaway profile that is deleted when the last private tab closes (or on the next launch, if the app was
 * killed first). On older WebViews cookies can't be separated, and the app says so before opening one.
 */
object PrivateBrowsing {
    const val PROFILE_PREFIX = "colon-private-"

    fun recordsHistory(incognito: Boolean, url: String): Boolean = !incognito && UrlRules.isWebUrl(url)

    /** A fresh profile name for a new private session, so a profile still being torn down is never reused. */
    fun profileName(session: Long): String = PROFILE_PREFIX + session.toString(36)

    /** Profiles left behind by earlier private sessions (to delete), never the one in use or the default. */
    fun staleProfiles(all: Collection<String>, inUse: String?): List<String> =
        all.filter { it.startsWith(PROFILE_PREFIX) && it != inUse }

    /** The private session ends when no private tab is left. */
    fun sessionEnded(incognitoFlags: List<Boolean>): Boolean = incognitoFlags.none { it }
}
