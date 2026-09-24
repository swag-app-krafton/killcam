package com.krafton.killcam

import com.krafton.killcam.core.model.Header
import com.krafton.killcam.core.model.HttpBody
import com.krafton.killcam.core.model.MockAction
import com.krafton.killcam.core.model.MockFailure
import com.krafton.killcam.core.model.MockRule
import com.krafton.killcam.core.net.Bodies
import com.krafton.killcam.internal.KillcamRuntime
import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.Sink
import okio.Timeout
import okio.buffer
import java.io.IOException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Captures OkHttp traffic for the Network panel and applies mock rules.
 *
 * Add it as an **application** interceptor (`addInterceptor`, not
 * `addNetworkInterceptor`) so mocks short-circuit before any I/O and bodies
 * are seen decompressed. Ktor clients get it through the OkHttp engine:
 * `HttpClient(OkHttp) { engine { addInterceptor(KillcamInterceptor()) } }`.
 *
 * Response bodies are copied as the app reads them rather than read ahead,
 * so streaming responses and large downloads behave exactly as without
 * Killcam; a body the app never reads is simply not captured.
 */
public class KillcamInterceptor @JvmOverloads constructor(
    /** Shown as the call's source, e.g. "okhttp", "react-native", "ktor". */
    private val source: String = "okhttp",
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val runtime = Killcam.runtime ?: return chain.proceed(chain.request())
        val request = chain.request()
        val url = request.url.toString()
        val store = runtime.core.store
        val mock = runtime.core.mocks.match(request.method, url)
        val limit = runtime.config.maxBodyBytes

        val (requestBody, requestSize) = captureRequest(request, limit)
        val id = store.beginCall(
            method = request.method,
            url = url,
            requestHeaders = headers(request.headers, runtime),
            requestBody = requestBody,
            requestSize = requestSize,
            source = source,
            mockRuleId = mock?.id,
        )

        try {
            if (mock != null) {
                pause(chain, mock.delayMs)
                when (mock.action) {
                    MockAction.Respond -> return respond(request, mock, id, runtime)
                    MockAction.Fail -> throw failure(mock.failure)
                    MockAction.Delay -> Unit
                }
            }
            val response = chain.proceed(request)
            if (id == null) return response
            val body = response.body
            val contentType = body?.contentType()?.toString() ?: response.header("Content-Type")
            store.completeCall(
                id = id,
                status = response.code,
                message = response.message.ifEmpty { null },
                protocol = response.protocol.toString(),
                headers = headers(response.headers, runtime),
                contentType = contentType,
                responseSize = body?.contentLength()?.coerceAtLeast(0) ?: 0,
            )
            if (body == null) return response
            if (body.contentLength() == 0L) {
                store.completeBody(id, Bodies.decode(ByteArray(0), 0, false, contentType))
                return response
            }
            val encoding = response.header("Content-Encoding")
            val capturing = CapturingBody(body, limit) { bytes, total, truncated ->
                store.completeBody(id, Bodies.decode(bytes, total, truncated, contentType, encoding))
            }
            return response.newBuilder().body(capturing).build()
        } catch (e: IOException) {
            id?.let { store.failCall(it, e) }
            throw e
        } catch (e: RuntimeException) {
            id?.let { store.failCall(it, e) }
            throw e
        }
    }

    private fun respond(request: Request, mock: MockRule, id: String?, runtime: KillcamRuntime): Response {
        val contentType = mock.headers.firstOrNull { it.name.equals("Content-Type", true) }?.value ?: "application/json"
        val bytes = mock.body.toByteArray()
        val headers = Headers.Builder().apply {
            mock.headers.forEach { add(it.name, it.value) }
            if (mock.headers.none { it.name.equals("Content-Type", true) }) add("Content-Type", contentType)
            add("X-Killcam-Mock", mock.name)
        }.build()
        val message = REASONS[mock.status] ?: "Mocked"
        if (id != null) {
            val store = runtime.core.store
            store.completeCall(id, mock.status, message, "http/1.1", headers(headers, runtime), contentType, bytes.size.toLong(), mock.id)
            store.completeBody(id, Bodies.decode(bytes, bytes.size.toLong(), false, contentType))
        }
        val now = System.currentTimeMillis()
        return Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(mock.status)
            .message(message)
            .headers(headers)
            .body(bytes.toResponseBody(contentType.toMediaTypeOrNull()))
            .sentRequestAtMillis(now)
            .receivedResponseAtMillis(now)
            .build()
    }

    /** Sleeps for a mock's delay, but gives up promptly if the call is cancelled. */
    private fun pause(chain: Interceptor.Chain, delayMs: Long) {
        var remaining = delayMs
        while (remaining > 0) {
            if (chain.call().isCanceled()) throw IOException("Canceled")
            val step = minOf(remaining, 100)
            Thread.sleep(step)
            remaining -= step
        }
    }

    private fun failure(kind: MockFailure): IOException = when (kind) {
        MockFailure.Timeout -> SocketTimeoutException("timeout (Killcam mock)")
        MockFailure.NoNetwork -> UnknownHostException("Unable to resolve host (Killcam mock: no network)")
        MockFailure.ConnectionReset -> SocketException("Connection reset (Killcam mock)")
    }

    private fun headers(headers: Headers, runtime: KillcamRuntime): List<Header> =
        (0 until headers.size).map { i ->
            val name = headers.name(i)
            Header(name, if (name.lowercase() in runtime.redactedHeaders) "██ redacted" else headers.value(i))
        }

    private fun captureRequest(request: Request, limit: Long): Pair<HttpBody?, Long> {
        val body = request.body ?: return null to 0L
        val contentType = body.contentType()?.toString()
        val length = runCatching { body.contentLength() }.getOrDefault(-1L)
        if (body.isDuplex() || body.isOneShot()) {
            return Bodies.omitted("one-shot body not captured", length, contentType) to length.coerceAtLeast(0)
        }
        val sink = CappedSink(limit)
        return try {
            sink.buffer().use { body.writeTo(it) }
            val bytes = sink.captured.readByteArray()
            Bodies.decode(bytes, sink.total, sink.total > bytes.size, contentType, request.header("Content-Encoding")) to sink.total
        } catch (e: IOException) {
            Bodies.omitted("body could not be read: ${e.message}", length, contentType) to length.coerceAtLeast(0)
        }
    }

    /** Keeps the first [limit] bytes written to it and counts the rest. */
    private class CappedSink(private val limit: Long) : Sink {
        val captured = Buffer()
        var total = 0L

        override fun write(source: Buffer, byteCount: Long) {
            val keep = minOf(byteCount, limit - captured.size).coerceAtLeast(0)
            if (keep > 0) source.read(captured, keep)
            source.skip(byteCount - keep)
            total += byteCount
        }

        override fun flush() = Unit
        override fun timeout(): Timeout = Timeout.NONE
        override fun close() = Unit
    }

    /** Tees what the app reads into a capped buffer; reports once, at end of stream or close. */
    private class CapturingBody(
        private val delegate: ResponseBody,
        private val limit: Long,
        private val onDone: (bytes: ByteArray, total: Long, truncated: Boolean) -> Unit,
    ) : ResponseBody() {
        private val captured = Buffer()
        private var total = 0L
        private var reachedEnd = false
        private var reported = false

        private val source: BufferedSource by lazy {
            object : ForwardingSource(delegate.source()) {
                override fun read(sink: Buffer, byteCount: Long): Long {
                    val read = try {
                        super.read(sink, byteCount)
                    } catch (e: IOException) {
                        report()
                        throw e
                    }
                    if (read == -1L) {
                        reachedEnd = true
                        report()
                        return -1L
                    }
                    total += read
                    val keep = minOf(read, limit - captured.size)
                    if (keep > 0) sink.copyTo(captured, sink.size - read, keep)
                    return read
                }

                override fun close() {
                    report()
                    super.close()
                }
            }.buffer()
        }

        override fun contentType() = delegate.contentType()

        override fun contentLength() = delegate.contentLength()

        override fun source(): BufferedSource = source

        @Synchronized
        private fun report() {
            if (reported) return
            reported = true
            val bytes = captured.readByteArray()
            val size = maxOf(total, delegate.contentLength())
            runCatching { onDone(bytes, size, !reachedEnd || total > bytes.size) }
        }
    }

    private companion object {
        val REASONS = mapOf(
            200 to "OK", 201 to "Created", 202 to "Accepted", 204 to "No Content",
            301 to "Moved Permanently", 302 to "Found", 304 to "Not Modified",
            400 to "Bad Request", 401 to "Unauthorized", 402 to "Payment Required", 403 to "Forbidden",
            404 to "Not Found", 409 to "Conflict", 422 to "Unprocessable Entity", 429 to "Too Many Requests",
            500 to "Internal Server Error", 502 to "Bad Gateway", 503 to "Service Unavailable", 504 to "Gateway Timeout",
        )
    }
}
