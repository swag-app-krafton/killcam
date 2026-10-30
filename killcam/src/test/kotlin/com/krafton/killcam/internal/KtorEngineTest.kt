package com.krafton.killcam.internal

import io.ktor.client.HttpClientEngineContainer
import org.junit.Test
import java.util.ServiceLoader
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// Plain JVM. Which engine Ktor takes depends on the classpath's order, so these pin what Killcam controls: the
// registration, and the check that tells an app when it lost.
class KtorEngineTest {
    private val found get() = ServiceLoader.load(HttpClientEngineContainer::class.java).map { it.javaClass.name }

    @Test
    fun killcamsEngineIsListedInMetaInfServices() {
        assertTrue(KillcamEngineContainer::class.java.name in found, "listed: $found")
    }

    @Test
    fun theCheckReportsWhetherKillcamsEngineIsFirst() {
        val first = found.first() == KillcamEngineContainer::class.java.name

        assertEquals(first, KtorEngineCheck.listedFirst())
    }

    @Test
    fun theFactoryIsOkHttpWithKillcamsSourceLabel() {
        assertNotNull(KillcamEngineContainer().factory)
        assertEquals("ktor", KillcamOkHttp.SOURCE)
    }
}
