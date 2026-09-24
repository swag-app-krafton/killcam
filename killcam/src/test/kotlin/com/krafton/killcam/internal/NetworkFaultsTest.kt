package com.krafton.killcam.internal

import com.krafton.killcam.core.model.Header
import com.krafton.killcam.core.model.MockFailure
import com.krafton.killcam.core.model.RequestEdit
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Test
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Plain JVM: NetworkFaults and the request-edit helpers touch no Android API.
// End-to-end interceptor behaviour is covered against MockWebServer outside this module.
class NetworkFaultsTest {
    private val url = "https://api.swag.gg:443/v1/upi/pay?token=secret".toHttpUrl()

    @Test
    fun exceptionsMatchWhatAndroidThrows() {
        val dns = NetworkFaults.exception(MockFailure.DnsFailure, url)
        assertTrue(dns is UnknownHostException)
        assertEquals("Unable to resolve host \"api.swag.gg\": No address associated with hostname", dns.message)
        assertTrue(NetworkFaults.exception(MockFailure.ConnectionRefused, url) is ConnectException)
        assertTrue(NetworkFaults.exception(MockFailure.ConnectTimeout, url) is SocketTimeoutException)
        assertTrue(NetworkFaults.exception(MockFailure.SslHandshake, url) is SSLHandshakeException)
        assertEquals("Connection reset", NetworkFaults.exception(MockFailure.ConnectionReset, url).message)
        val eof = NetworkFaults.exception(MockFailure.UnexpectedEof, url).message!!
        assertTrue("secret" !in eof, "query strings stay out of error text")
    }

    @Test
    fun dropAfterDeliversThePrefixThenAborts() {
        var dropped = 0
        val body = NetworkFaults.dropAfter("0123456789".toResponseBody(), 4) { dropped++ }
        val received = Buffer()
        val e = assertFailsWith<SocketException> { while (body.source().read(received, 3) != -1L) continue }
        assertEquals("Software caused connection abort", e.message)
        assertEquals("0123", received.readUtf8())
        assertFailsWith<SocketException> { body.source().read(received, 3) }
        assertEquals(1, dropped, "reported once")
    }

    @Test
    fun throttledBodiesArriveIntactAndSlowly() {
        val text = "x".repeat(10_000)
        val start = System.nanoTime()
        assertEquals(text, NetworkFaults.throttle(text.toResponseBody(), 10_000).string())
        val ms = (System.nanoTime() - start) / 1_000_000
        assertTrue(ms >= 700, "10 KB at 10 KB/s took $ms ms")

        val sink = Buffer()
        NetworkFaults.throttle(text.toRequestBody("text/plain".toMediaType()), 1_000_000).writeTo(sink)
        assertEquals(text, sink.readUtf8())
    }

    @Test
    fun editedRequestsKeepRedactedHeadersAndFixUpBodies() {
        val original = Request.Builder().url(url)
            .header("Authorization", "Bearer real")
            .post("""{"a":1}""".toRequestBody("application/json".toMediaType()))
            .build()
        val edited = original.edited(
            RequestEdit(
                body = """{"a":2}""",
                headers = listOf(Header("Authorization", OkHttpReplayer.REDACTED), Header("X-Test", "1")),
            ),
        )
        assertEquals("Bearer real", edited.header("Authorization"))
        assertEquals("1", edited.header("X-Test"))
        assertEquals("""{"a":2}""", Buffer().also { edited.body!!.writeTo(it) }.readUtf8())

        val asGet = original.edited(RequestEdit(method = "get"))
        assertEquals("GET", asGet.method)
        assertNull(asGet.body)
        assertEquals(original.url, original.edited(RequestEdit(url = "not a url")).url, "a bad URL keeps the original")
    }
}
