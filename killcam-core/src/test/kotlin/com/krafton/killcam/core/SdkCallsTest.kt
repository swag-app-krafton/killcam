package com.krafton.killcam.core

import com.krafton.killcam.core.model.CallState
import com.krafton.killcam.core.net.Curl
import com.krafton.killcam.core.net.Har
import com.krafton.killcam.core.net.SdkCalls
import com.krafton.killcam.core.store.KillcamStore
import com.krafton.killcam.core.store.StoreLimits
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SdkCallsTest {
    private var clock = 10_000L
    private val store = KillcamStore("s", clock = { clock })

    @Test
    fun paramsBecomeAPrettyJsonRequestBodyAndTheAnswerIsKept() {
        val answer = """{"status":"S","code":"00"}"""
        val id = SdkCalls.record(
            store, "upi-sdk", "doRegistration", mapOf("mobile" to "9999999999", "simSlot" to null),
            answer, "Responded(status=S)", durationMs = 420, failed = false,
        )!!
        val call = store.networkCall(id)!!
        assertEquals("SDK", call.method)
        assertEquals("sdk://upi-sdk/doRegistration", call.url)
        assertEquals("upi-sdk", call.host)
        assertEquals("/doRegistration", call.path)
        assertEquals("upi-sdk", call.source)
        assertEquals(200, call.status)
        assertEquals(CallState.Complete, call.state)
        assertEquals("Responded(status=S)", call.responseMessage)
        assertEquals("Responded(status=S)", call.responseHeaders.single { it.name == SdkCalls.OUTCOME_HEADER }.value)
        val params = Json.parseToJsonElement(call.requestBody!!.text!!).jsonObject
        assertEquals("9999999999", params["mobile"]!!.jsonPrimitive.content)
        assertEquals("null", params["simSlot"].toString())
        assertTrue(call.requestBody!!.text!!.contains("\n"), "pretty-printed")
        assertEquals(answer, call.responseBody!!.text)
        assertEquals("application/json", call.contentType)
        assertEquals(420, call.durationMs)
        assertEquals(10_000L - 420, call.startMs)
    }

    @Test
    fun failedCallKeepsItsOutcomeAsTheError() {
        val id = SdkCalls.record(store, "upi-sdk", "getToken", emptyMap(), "plain answer", "SdkFailure(1000)", 30, failed = true)!!
        val call = store.networkCall(id)!!
        assertEquals(CallState.Failed, call.state)
        assertNull(call.status)
        assertEquals("SdkFailure(1000)", call.error)
        assertEquals("plain answer", call.responseBody!!.text)
        assertEquals("text/plain", call.contentType)
    }

    @Test
    fun noAnswerMeansNoResponseBody() {
        val id = SdkCalls.record(store, "upi-sdk", "init", mapOf("a" to "b"), null, "Timeout", 5, failed = true)!!
        assertNull(store.networkCall(id)!!.responseBody)
    }

    @Test
    fun listedInTheNetworkStreamAndExportsLikeAnyCall() {
        val events = mutableListOf<String>()
        store.addListener { if (it.type == "network") events += it.json }
        store.beginCall("GET", "https://x.test/a", emptyList(), null, 0, "okhttp")
        SdkCalls.record(store, "upi-sdk", "doRegistration", mapOf("k" to "v"), "{}", "Responded(status=S)", 1, false)
        assertEquals(listOf("https://x.test/a", "sdk://upi-sdk/doRegistration"), store.networkSummaries().map { it.url })
        assertTrue(events.last().contains("sdk://upi-sdk/doRegistration"))
        val har = Har.of(store.networkCalls(), "killcam", "test").toString()
        assertTrue(har.contains("Responded(status=S)"))
        assertTrue(Curl.of(store.networkCall(store.networkSummaries().last().id)!!).contains("sdk://upi-sdk/doRegistration"))
    }

    @Test
    fun respectsTheBodyCapCountCapAndPause() {
        val small = KillcamStore("s", StoreLimits(maxNetworkCalls = 2))
        val id = SdkCalls.record(small, "sdk", "big", emptyMap(), "x".repeat(100), "ok", 1, false, maxBodyBytes = 10)!!
        val body = small.networkCall(id)!!.responseBody!!
        assertEquals(10, body.text!!.length)
        assertEquals(100, body.size)
        assertTrue(body.truncated)
        repeat(2) { SdkCalls.record(small, "sdk", "n$it", emptyMap(), null, "ok", 1, false) }
        assertEquals(listOf("/n0", "/n1"), small.networkSummaries().map { it.path })
        small.paused = true
        assertNull(SdkCalls.record(small, "sdk", "dropped", emptyMap(), null, "ok", 1, false))
    }
}
