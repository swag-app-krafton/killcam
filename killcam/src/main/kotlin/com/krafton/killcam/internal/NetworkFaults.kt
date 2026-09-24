package com.krafton.killcam.internal

import com.krafton.killcam.core.model.MockFailure
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.RequestBody
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSink
import okio.BufferedSource
import okio.ForwardingSource
import okio.Throttler
import okio.buffer
import java.io.IOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

/**
 * The OkHttp half of network conditions and failure mocks: the exceptions,
 * sleeps and throttled bodies KillcamInterceptor applies. Android-free, so it
 * runs in plain JVM tests.
 */
internal object NetworkFaults {

    /**
     * The exception a real failure of this kind throws on Android, worded the
     * same, so app code that inspects messages (or maps them to UI copy)
     * behaves as it would in the field. [NetworkSwitch][MockFailure.NetworkSwitch]
     * is thrown mid-body by [dropAfter], not here.
     */
    fun exception(kind: MockFailure, url: HttpUrl): IOException {
        val host = url.host
        return when (kind) {
            MockFailure.Timeout -> SocketTimeoutException("timeout")
            MockFailure.NoNetwork, MockFailure.DnsFailure ->
                UnknownHostException("Unable to resolve host \"$host\": No address associated with hostname")
            MockFailure.ConnectionReset -> SocketException("Connection reset")
            MockFailure.ConnectionRefused ->
                ConnectException("Failed to connect to $host/${url.port}")
            MockFailure.ConnectTimeout ->
                SocketTimeoutException("failed to connect to $host/${url.port} after 10000ms")
            MockFailure.SslHandshake ->
                SSLHandshakeException("java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.")
            MockFailure.NetworkSwitch -> networkSwitch()
            // OkHttp's own wording, with its own redaction: no credentials, path or query.
            MockFailure.UnexpectedEof -> IOException("unexpected end of stream on ${url.redact()}")
        }
    }

    /** What reading a response throws when the phone changes networks under it (ECONNABORTED). */
    fun networkSwitch(): SocketException = SocketException("Software caused connection abort")

    /** Sleeps [delayMs], giving up promptly if the call is cancelled. */
    fun pause(call: Call, delayMs: Long) {
        var remaining = delayMs
        while (remaining > 0) {
            if (call.isCanceled()) throw IOException("Canceled")
            val step = minOf(remaining, 100)
            try {
                Thread.sleep(step)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                throw java.io.InterruptedIOException("interrupted")
            }
            remaining -= step
        }
    }

    /** [body] written no faster than [bytesPerSecond]. */
    fun throttle(body: RequestBody, bytesPerSecond: Long): RequestBody = object : RequestBody() {
        override fun contentType(): MediaType? = body.contentType()
        override fun contentLength(): Long = body.contentLength()
        override fun isOneShot(): Boolean = body.isOneShot()
        override fun isDuplex(): Boolean = body.isDuplex()

        override fun writeTo(sink: BufferedSink) {
            val throttled = throttler(bytesPerSecond).sink(sink).buffer()
            body.writeTo(throttled)
            // emit, not close: the caller owns the underlying sink.
            throttled.emit()
        }
    }

    /** [body] read no faster than [bytesPerSecond]. */
    fun throttle(body: ResponseBody, bytesPerSecond: Long): ResponseBody =
        Wrapped(body) { throttler(bytesPerSecond).source(it) }

    /**
     * [body] that delivers [afterBytes] bytes, then fails every read with the
     * network-switch exception. [onDrop] runs once, when it first fires.
     */
    fun dropAfter(body: ResponseBody, afterBytes: Long, onDrop: (IOException) -> Unit): ResponseBody =
        Wrapped(body) { upstream ->
            object : ForwardingSource(upstream) {
                private var delivered = 0L
                private var dropped = false

                override fun read(sink: Buffer, byteCount: Long): Long {
                    val allowed = afterBytes - delivered
                    if (allowed <= 0) {
                        val e = networkSwitch()
                        if (!dropped) {
                            dropped = true
                            runCatching { onDrop(e) }
                        }
                        throw e
                    }
                    val read = super.read(sink, minOf(byteCount, allowed))
                    if (read > 0) delivered += read
                    return read
                }
            }
        }

    private fun throttler(bytesPerSecond: Long) = Throttler().apply {
        // Chunks of ~100 ms of data: a fixed 8 KB burst would let a small body at GPRS
        // rates arrive in one go, while tiny chunks at 4G rates would mean a sleep per KB.
        val chunk = (bytesPerSecond / 10).coerceIn(256, 64 * 1024)
        bytesPerSecond(bytesPerSecond, waitByteCount = chunk / 2, maxByteCount = chunk)
    }

    private class Wrapped(
        private val delegate: ResponseBody,
        private val wrap: (okio.Source) -> okio.Source,
    ) : ResponseBody() {
        private val source: BufferedSource by lazy { wrap(delegate.source()).buffer() }

        override fun contentType(): MediaType? = delegate.contentType()
        override fun contentLength(): Long = delegate.contentLength()
        override fun source(): BufferedSource = source
        override fun close() {
            delegate.close()
        }
    }
}
