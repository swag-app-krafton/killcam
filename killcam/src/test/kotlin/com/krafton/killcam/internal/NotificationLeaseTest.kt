package com.krafton.killcam.internal

import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The "Killcam · recording" notification is re-posted while the app lives and
 * expires on its own when it stops being re-posted, so it goes away when the
 * process dies however it dies: a crash, a native signal, a kill from the
 * system or from recents (B-021).
 */
class NotificationLeaseTest {
    @Test
    fun aLiveAppsNotificationSurvivesAMissedRefresh() {
        assertTrue(NotificationLease.TIMEOUT_MS > 2 * NotificationLease.REFRESH_MS)
    }

    @Test
    fun aDeadAppsNotificationGoesWithinFifteenSeconds() {
        assertTrue(NotificationLease.TIMEOUT_MS <= 15_000)
    }
}
