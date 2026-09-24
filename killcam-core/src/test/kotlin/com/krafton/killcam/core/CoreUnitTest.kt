package com.krafton.killcam.core

import com.krafton.killcam.core.mock.MockEngine
import com.krafton.killcam.core.model.Header
import com.krafton.killcam.core.net.Bodies
import com.krafton.killcam.core.server.AccessControl
import com.krafton.killcam.core.store.KillcamStore
import com.krafton.killcam.core.store.StoreLimits
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CoreUnitTest {
    @Test
    fun globMatchesWholeUrl() {
        val regex = Regex(MockEngine.globToRegex("https://api.swag.gg/v1/*/pay?"))
        assertTrue(regex.matches("https://api.swag.gg/v1/upi/pay2"))
        assertFalse(regex.matches("https://api.swag.gg/v1/upi/pay"))
        assertFalse(Regex(MockEngine.globToRegex("*.swag.gg/x")).matches("https://api.swag.ggg/x"))
    }

    @Test
    fun decodesGzipEvenWhenTruncated() {
        val text = "{\"ok\":true}".repeat(200)
        val gz = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(text.toByteArray()) } }.toByteArray()
        assertEquals(text, Bodies.decode(gz, gz.size.toLong(), false, "application/json", "gzip").text)
        val partial = Bodies.decode(gz.copyOf(gz.size / 2), gz.size.toLong(), true, "application/json", "gzip")
        assertTrue(partial.text!!.isNotEmpty() && text.startsWith(partial.text!!))
    }

    @Test
    fun binaryBodiesAreBase64() {
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0, 1, 2, 3)
        val body = Bodies.decode(png, 8, false, "image/png")
        assertNull(body.text)
        assertEquals("iVBORwABAgM=", body.base64)
    }

    @Test
    fun bodyBudgetEvictsOldestBodiesFirst() {
        val store = KillcamStore("s", StoreLimits(maxNetworkCalls = 10, bodyBudgetBytes = 3_000))
        val ids = (0 until 3).map {
            val id = store.beginCall("GET", "https://x.test/$it", emptyList(), null, 0, "test")!!
            store.completeBody(id, Bodies.decode(ByteArray(600) { 'a'.code.toByte() }, 600, false, "text/plain"))
            id
        }
        assertTrue(store.networkCall(ids[0])!!.responseBody!!.text!!.startsWith("[evicted"))
        assertEquals(600, store.networkCall(ids[2])!!.responseBody!!.text!!.length)
    }

    @Test
    fun countCapDropsOldestCalls() {
        val store = KillcamStore("s", StoreLimits(maxNetworkCalls = 2))
        repeat(3) { store.beginCall("GET", "https://x.test/$it", listOf(Header("a", "b")), null, 0, "test") }
        assertEquals(listOf("/1", "/2"), store.networkSummaries().map { it.path })
    }

    @Test
    fun pausedStoreDropsDataButKeepsMarks() {
        val store = KillcamStore("s")
        store.paused = true
        assertNull(store.beginCall("GET", "https://x.test", emptyList(), null, 0, "test"))
        assertNull(store.log(com.krafton.killcam.core.model.LogLevel.Info, "t", "m"))
        assertTrue(store.timeline(com.krafton.killcam.core.model.TimelineType.Mark, "bug") != null)
    }

    @Test
    fun hostAndLoopbackRules() {
        assertTrue(AccessControl.isAllowedHost("localhost:8090"))
        assertTrue(AccessControl.isAllowedHost("192.168.1.20:8090"))
        assertTrue(AccessControl.isAllowedHost("[::1]:8090"))
        assertFalse(AccessControl.isAllowedHost("evil.example:8090"))
        assertFalse(AccessControl.isAllowedHost("127.0.0.1.nip.io"))
        assertTrue(AccessControl.isLoopback("/127.0.0.1"))
        assertFalse(AccessControl.isLoopback("192.168.1.5"))
    }

    @Test
    fun pinLocksOutAfterRepeatedFailures() {
        var now = 0L
        val access = AccessControl { now }
        val pin = access.enableWifi()
        repeat(5) { access.authenticate("nope") }
        assertTrue(access.authenticate(pin) is AccessControl.AuthResult.Locked)
        now += 61_000
        assertTrue(access.authenticate(pin) is AccessControl.AuthResult.Granted)
    }

    @Test
    fun recordsNonJvmErrorsAsNonFatalCrashes() {
        val dir = java.nio.file.Files.createTempDirectory("killcam-err").toFile()
        val core = KillcamCore(com.krafton.killcam.core.demo.FakePlatform(dir), CoreConfig(dataDir = dir))
        val crash = core.recordError("JS TypeError", "undefined is not a function", "at App (index.bundle:12:3)")
        assertEquals("JS TypeError", crash.exception)
        assertFalse(crash.fatal)
        assertEquals("at App (index.bundle:12:3)", core.crash(crash.id)?.stackTrace)
        assertTrue(core.store.logs().any { it.message.startsWith("JS TypeError") })
        dir.deleteRecursively()
    }
}
