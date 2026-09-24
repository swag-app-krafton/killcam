package com.krafton.killcam

import com.krafton.killcam.core.model.BreakOn
import com.krafton.killcam.core.model.BreakStage
import com.krafton.killcam.core.model.Header
import com.krafton.killcam.core.model.HttpBody
import com.krafton.killcam.core.model.MockAction
import com.krafton.killcam.core.model.MockFailure
import com.krafton.killcam.core.model.MockRule
import com.krafton.killcam.core.model.PausedCall
import com.krafton.killcam.core.model.RequestEdit
import com.krafton.killcam.core.model.ResumeAction
import com.krafton.killcam.core.mock.NetworkConditionsEngine
import com.krafton.killcam.core.net.Bodies
import com.krafton.killcam.internal.KillcamRuntime
import com.krafton.killcam.internal.NetworkFaults
import com.krafton.killcam.internal.OkHttpReplayer
import com.krafton.killcam.internal.edited
import com.krafton.killcam.internal.unredact
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

/** Bodies up to this size can be edited at a response or request breakpoint. Top-level, so it stays off the public API. */
private const val MAX_EDITABLE_BYTES = 1024L * 1024

/**
 * Captures OkHttp traffic for the Network panel and applies mock rules and
 * the simulated network conditions (latency, bandwidth, loss, offline).
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
        if (runtime.core.replayer == null) runtime.core.replayer = OkHttpReplayer
        // A repeat started from the dashboard: apply its edit to the request as this point sees it.
        val ticket = OkHttpReplayer.ticket(chain.call())
        var request = ticket?.edit?.let { chain.request().edited(it) } ?: chain.request()
        val url = request.url.toString()
        val store = runtime.core.store
        val network = runtime.core.conditions.plan()
        val mock = runtime.core.mocks.match(request.method, url)
        val limit = runtime.config.maxBodyBytes

        val (requestBody, requestSize) = captureRequest(request, limit)
        val id = store.beginCall(
            method = request.method,
            url = url,
            requestHeaders = headers(request.headers, runtime),
            requestBody = requestBody,
            requestSize = requestSize,
            source = if (ticket != null) "repeat" else source,
            mockRuleId = mock?.id,
        )
        if (id != null) OkHttpReplayer.remember(id, chain.call())

        try {
            // The simulated network comes first: offline or a lost packet fails
            // even a mocked call, and latency delays it, as on a real phone.
            if (network != null) {
                NetworkFaults.pause(chain.call(), network.delayMs)
                network.failure?.let { throw NetworkFaults.exception(it, request.url) }
            }
            var dropAfterBytes: Long? = null
            var breakOnResponse = false
            if (mock != null) {
                NetworkFaults.pause(chain.call(), mock.delayMs)
                when (mock.action) {
                    MockAction.Respond -> return shape(respond(request, mock, id, runtime), network, null, id, runtime)
                    MockAction.Fail ->
                        if (mock.failure == MockFailure.NetworkSwitch) dropAfterBytes = mock.dropAfterBytes
                        else throw NetworkFaults.exception(mock.failure, request.url)
                    MockAction.Delay -> Unit
                    MockAction.Breakpoint -> {
                        if (mock.breakOn != BreakOn.Response) request = breakAtRequest(chain, request, mock, id, runtime)
                        breakOnResponse = mock.breakOn != BreakOn.Request
                    }
                }
            }
            val outgoing = request.body
                ?.takeIf { network != null && network.uploadBytesPerSecond > 0 }
                ?.let { request.newBuilder().method(request.method, NetworkFaults.throttle(it, network!!.uploadBytesPerSecond)).build() }
                ?: request
            var response = chain.proceed(outgoing)
            if (breakOnResponse) response = breakAtResponse(chain, response, mock!!, id, runtime)
            if (id == null) return shape(response, network, dropAfterBytes, null, runtime)
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
            if (body.contentLength() == 0L && dropAfterBytes == null) {
                store.completeBody(id, Bodies.decode(ByteArray(0), 0, false, contentType))
                return response
            }
            val encoding = response.header("Content-Encoding")
            // Innermost first: the drop cuts the real stream, capture records what the app got,
            // the throttle paces what the app reads.
            val source = dropAfterBytes?.let { n -> NetworkFaults.dropAfter(body, n) { store.failCall(id, it) } } ?: body
            val capturing = CapturingBody(source, limit) { bytes, total, truncated ->
                store.completeBody(id, Bodies.decode(bytes, total, truncated, contentType, encoding))
            }
            return response.newBuilder().body(throttled(capturing, network)).build()
        } catch (e: IOException) {
            id?.let { store.failCall(it, e) }
            throw e
        } catch (e: RuntimeException) {
            id?.let { store.failCall(it, e) }
            throw e
        }
    }

    /** Holds the request for a tester; returns it as they left it, or throws the failure they chose. */
    private fun breakAtRequest(chain: Interceptor.Chain, request: Request, mock: MockRule, id: String?, runtime: KillcamRuntime): Request {
        val (text, editable) = editableRequestBody(request)
        val resume = runtime.core.breakpoints.pause({ pausedId, at, deadline ->
            PausedCall(
                id = pausedId, callId = id, ruleId = mock.id, ruleName = mock.name, stage = BreakStage.Request,
                pausedMs = at, deadlineMs = deadline, method = request.method, url = request.url.toString(),
                requestHeaders = headers(request.headers, runtime), requestBody = text, requestBodyEditable = editable,
                status = null, responseHeaders = emptyList(), responseBody = null, responseBodyEditable = false,
            )
        }) { chain.call().isCanceled() } ?: throw IOException("Canceled")
        if (resume.action == ResumeAction.Fail) throw NetworkFaults.exception(resume.failure, request.url)
        val edit = RequestEdit(resume.method, resume.url, resume.headers, resume.body?.takeIf { editable })
        if (edit == RequestEdit()) return request
        val edited = request.edited(edit)
        if (id != null) {
            val (body, size) = captureRequest(edited, runtime.config.maxBodyBytes)
            runtime.core.store.editRequest(id, edited.method, edited.url.toString(), headers(edited.headers, runtime), body, size)
        }
        return edited
    }

    /** Holds the response before the app sees it; returns it as the tester left it, or throws the failure they chose. */
    private fun breakAtResponse(chain: Interceptor.Chain, response: Response, mock: MockRule, id: String?, runtime: KillcamRuntime): Response {
        val body = response.body
        val encoded = response.header("Content-Encoding")?.let { !it.equals("identity", ignoreCase = true) } == true
        val peeked = if (body == null) ByteArray(0) else runCatching { response.peekBody(MAX_EDITABLE_BYTES + 1).bytes() }.getOrDefault(ByteArray(0))
        val tooBig = peeked.size > MAX_EDITABLE_BYTES
        val shown = Bodies.decode(
            if (tooBig) peeked.copyOf(MAX_EDITABLE_BYTES.toInt()) else peeked, peeked.size.toLong(), tooBig,
            body?.contentType()?.toString(), response.header("Content-Encoding"),
        ).text
        val editable = !tooBig && !encoded && shown != null
        val resume = runtime.core.breakpoints.pause({ pausedId, at, deadline ->
            PausedCall(
                id = pausedId, callId = id, ruleId = mock.id, ruleName = mock.name, stage = BreakStage.Response,
                pausedMs = at, deadlineMs = deadline, method = response.request.method, url = response.request.url.toString(),
                requestHeaders = headers(response.request.headers, runtime), requestBody = null, requestBodyEditable = false,
                status = response.code, responseHeaders = headers(response.headers, runtime), responseBody = shown,
                responseBodyEditable = editable,
            )
        }) { chain.call().isCanceled() }
        if (resume == null || resume.action == ResumeAction.Fail) {
            response.close()
            throw if (resume == null) IOException("Canceled") else NetworkFaults.exception(resume.failure, response.request.url)
        }
        if (resume.status == null && resume.headers == null && (resume.body == null || !editable)) return response
        val builder = response.newBuilder()
        resume.status?.let { builder.code(it).message(REASONS[it] ?: "Edited") }
        var headers = resume.headers?.let { unredact(it, response.headers) } ?: response.headers
        val newBody = resume.body
        if (newBody != null && editable) {
            headers = headers.newBuilder().removeAll("Content-Length").removeAll("Content-Encoding").build()
            val type = headers["Content-Type"]?.toMediaTypeOrNull() ?: body?.contentType()
            body?.close()
            builder.body(newBody.toResponseBody(type))
        }
        return builder.headers(headers).build()
    }

    /** A request body as text a tester can edit: (text, editable). One-shot, binary and large bodies are view-only or hidden. */
    private fun editableRequestBody(request: Request): Pair<String?, Boolean> {
        val body = request.body ?: return null to (request.method !in setOf("GET", "HEAD"))
        if (body.isOneShot() || body.isDuplex()) return null to false
        if (body.contentLength() > MAX_EDITABLE_BYTES) return null to false
        val buffer = Buffer()
        runCatching { body.writeTo(buffer) }.onFailure { return null to false }
        val size = buffer.size
        if (size > MAX_EDITABLE_BYTES) return null to false
        val encoding = request.header("Content-Encoding")
        val text = Bodies.decode(buffer.readByteArray(), size, false, body.contentType()?.toString(), encoding).text
        return text to (text != null && encoding == null)
    }

    /** Applies a mid-body drop and the download throttle to a response Killcam is not capturing. */
    private fun shape(
        response: Response,
        network: NetworkConditionsEngine.Plan?,
        dropAfterBytes: Long?,
        id: String?,
        runtime: KillcamRuntime,
    ): Response {
        var body = response.body ?: return response
        if (dropAfterBytes != null) {
            body = NetworkFaults.dropAfter(body, dropAfterBytes) { e -> id?.let { runtime.core.store.failCall(it, e) } }
        }
        val shaped = throttled(body, network)
        return if (shaped === response.body) response else response.newBuilder().body(shaped).build()
    }

    private fun throttled(body: ResponseBody, network: NetworkConditionsEngine.Plan?): ResponseBody =
        if (network != null && network.downloadBytesPerSecond > 0) NetworkFaults.throttle(body, network.downloadBytesPerSecond)
        else body

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

    private fun headers(headers: Headers, runtime: KillcamRuntime): List<Header> =
        (0 until headers.size).map { i ->
            val name = headers.name(i)
            Header(name, if (name.lowercase() in runtime.redactedHeaders) OkHttpReplayer.REDACTED else headers.value(i))
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
