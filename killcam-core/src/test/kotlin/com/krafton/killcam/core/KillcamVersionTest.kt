package com.krafton.killcam.core

import kotlin.test.Test
import kotlin.test.assertEquals

/** KILLCAM_VERSION is the version Gradle builds and publishes, never a hand-typed copy of it. */
class KillcamVersionTest {
    @Test
    fun killcamVersionIsTheBuildsVersion() {
        assertEquals(System.getProperty("killcam.buildVersion"), KILLCAM_VERSION)
    }
}
