package ng.nifelux.colonai

import ng.nifelux.colonai.UpdateRules.AfterAllow
import ng.nifelux.colonai.UpdateRules.OnDownload
import ng.nifelux.colonai.UpdateRules.OnStart
import ng.nifelux.colonai.UpdateRules.Phase
import ng.nifelux.colonai.UpdateRules.STATUS_FAILED
import ng.nifelux.colonai.UpdateRules.STATUS_PAUSED
import ng.nifelux.colonai.UpdateRules.STATUS_PENDING
import ng.nifelux.colonai.UpdateRules.STATUS_RUNNING
import ng.nifelux.colonai.UpdateRules.STATUS_SUCCESSFUL
import ng.nifelux.colonai.UpdateRules.Saved
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.24.0: the update download's decisions (UpdateRules): no duplicate downloads, what start/resume shows, cleanup. */
class UpdateRulesTest {
    private val saved = Saved(42L, "0.24.0", 2400, "colon-ai-0.24.0.apk")
    private val verified = saved.copy(verified = true)

    @Test fun statusesMapToPhases() {
        assertEquals(Phase.WAITING, UpdateRules.phase(STATUS_PENDING))
        assertEquals(Phase.RUNNING, UpdateRules.phase(STATUS_RUNNING))
        assertEquals(Phase.PAUSED, UpdateRules.phase(STATUS_PAUSED))
        assertEquals(Phase.DONE, UpdateRules.phase(STATUS_SUCCESSFUL))
        assertEquals(Phase.FAILED, UpdateRules.phase(STATUS_FAILED))
        assertEquals(Phase.MISSING, UpdateRules.phase(null))
        assertEquals(Phase.WAITING, UpdateRules.phase(99)) // an unknown status is treated as not started yet
    }

    @Test fun downloadStartsWhenNothingIsSaved() {
        assertEquals(OnDownload.START, UpdateRules.onDownload(null, 2400, null, false))
    }

    @Test fun neverASecondDownloadOfTheSameVersion() {
        for (st in listOf(STATUS_PENDING, STATUS_RUNNING, STATUS_PAUSED)) {
            assertEquals(OnDownload.SHOW_PROGRESS, UpdateRules.onDownload(saved, 2400, st, false))
        }
        assertEquals(OnDownload.SHOW_READY, UpdateRules.onDownload(verified, 2400, STATUS_SUCCESSFUL, true))
        // Done but not verified yet: the sheet verifies it rather than downloading again.
        assertEquals(OnDownload.SHOW_PROGRESS, UpdateRules.onDownload(saved, 2400, STATUS_SUCCESSFUL, true))
    }

    @Test fun downloadStartsAgainAfterAFailureOrForANewerVersion() {
        assertEquals(OnDownload.START, UpdateRules.onDownload(saved, 2400, STATUS_FAILED, false))
        assertEquals(OnDownload.START, UpdateRules.onDownload(saved, 2400, null, false))
        assertEquals(OnDownload.START, UpdateRules.onDownload(verified, 2400, STATUS_SUCCESSFUL, false)) // file gone
        assertEquals(OnDownload.START, UpdateRules.onDownload(saved, 2401, STATUS_RUNNING, false))
    }

    @Test fun startCleansUpOnceTheUpdateIsInstalled() {
        assertEquals(OnStart.CLEAN_UP, UpdateRules.onStart(verified, 2400, STATUS_SUCCESSFUL, true, false))
        assertEquals(OnStart.CLEAN_UP, UpdateRules.onStart(saved, 2500, STATUS_RUNNING, true, false))
        assertEquals(OnStart.NOTHING, UpdateRules.onStart(null, 2300, null, false, false))
    }

    @Test fun startReopensProgressOrOffersInstall() {
        assertEquals(OnStart.SHOW_PROGRESS, UpdateRules.onStart(saved, 2300, STATUS_RUNNING, false, false))
        assertEquals(OnStart.SHOW_PROGRESS, UpdateRules.onStart(saved, 2300, STATUS_PAUSED, false, false))
        assertEquals(OnStart.SHOW_READY, UpdateRules.onStart(verified, 2300, STATUS_SUCCESSFUL, true, false))
        assertEquals(OnStart.SHOW_PROGRESS, UpdateRules.onStart(saved, 2300, STATUS_SUCCESSFUL, true, false))
    }

    @Test fun hiddenStaysHiddenInThisRun() {
        assertEquals(OnStart.NOTHING, UpdateRules.onStart(saved, 2300, STATUS_RUNNING, false, true))
        assertEquals(OnStart.NOTHING, UpdateRules.onStart(verified, 2300, STATUS_SUCCESSFUL, true, true))
    }

    @Test fun startForgetsFailedOrVanishedDownloads() {
        assertEquals(OnStart.FORGET, UpdateRules.onStart(saved, 2300, STATUS_FAILED, false, false))
        assertEquals(OnStart.FORGET, UpdateRules.onStart(saved, 2300, null, false, false))
        assertEquals(OnStart.FORGET, UpdateRules.onStart(verified, 2300, STATUS_SUCCESSFUL, false, false))
        assertEquals(OnStart.FORGET, UpdateRules.onStart(saved, 2300, STATUS_FAILED, false, true))
    }

    @Test fun startupPromptIsSkippedWhileThatVersionIsDownloading() {
        assertTrue(UpdateRules.skipPrompt(saved, 2400, STATUS_RUNNING))
        assertTrue(UpdateRules.skipPrompt(verified, 2400, STATUS_SUCCESSFUL))
        assertFalse(UpdateRules.skipPrompt(saved, 2400, STATUS_FAILED))
        assertFalse(UpdateRules.skipPrompt(saved, 2401, STATUS_RUNNING))
        assertFalse(UpdateRules.skipPrompt(null, 2400, null))
    }

    @Test fun broadcastsForOtherDownloadsAreIgnored() {
        assertTrue(UpdateRules.isOurs(42L, 42L))
        assertFalse(UpdateRules.isOurs(42L, 43L))
        assertFalse(UpdateRules.isOurs(-1L, -1L))
        assertFalse(UpdateRules.isOurs(0L, 0L))
    }

    @Test fun percentAndMegabytes() {
        assertNull(UpdateRules.percent(10, -1))
        assertNull(UpdateRules.percent(10, 0))
        assertEquals(0, UpdateRules.percent(0, 200))
        assertEquals(50, UpdateRules.percent(100, 200))
        assertEquals(100, UpdateRules.percent(250, 200)) // never above 100
        assertEquals(0, UpdateRules.percent(-5, 200))
        assertEquals("0.0", UpdateRules.mb(0))
        assertEquals("1.0", UpdateRules.mb(1024 * 1024))
        assertEquals("12.5", UpdateRules.mb(13_107_200))
        assertEquals("0.0", UpdateRules.mb(-1))
    }

    @Test fun fileNameAndOldApks() {
        assertEquals("colon-ai-0.24.0.apk", UpdateRules.fileName("colon-ai", "0.24.0"))
        val names = listOf("colon-ai-0.22.0.apk", "colon-ai-0.24.0.apk", "colon-browser-0.23.0.apk", "notes.txt",
            "colon-ai.apk", "colon-ai-0.23.0.apk.part")
        assertEquals(listOf("colon-ai-0.22.0.apk"), UpdateRules.staleApks(names, "colon-ai", "colon-ai-0.24.0.apk"))
        assertEquals(listOf("colon-ai-0.22.0.apk", "colon-ai-0.24.0.apk"),
            UpdateRules.staleApks(names, "colon-ai", null))
        assertEquals(listOf("colon-browser-0.23.0.apk"), UpdateRules.staleApks(names, "colon-browser", null))
    }

    @Test fun afterInstallUnknownApps() {
        assertEquals(AfterAllow.NOTHING, UpdateRules.afterAllow(pending = false, canInstall = true))
        assertEquals(AfterAllow.INSTALL, UpdateRules.afterAllow(pending = true, canInstall = true))
        assertEquals(AfterAllow.GIVE_UP, UpdateRules.afterAllow(pending = true, canInstall = false))
    }
}
