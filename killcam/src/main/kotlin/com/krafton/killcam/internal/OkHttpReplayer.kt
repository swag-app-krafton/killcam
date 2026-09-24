package com.krafton.killcam.internal

import com.krafton.killcam.core.ApiException
import com.krafton.killcam.core.model.Header
import com.krafton.killcam.core.model.RepeatRequest
import com.krafton.killcam.core.model.RequestEdit
import com.krafton.killcam.core.net.CallReplayer
import okhttp3.Call
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okio.blackholeSink
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

/**
 * Repeats captured OkHttp calls with `Call.clone()`, so they go through the
 * app's own client: its auth, its interceptors, and Killcam's mocks,
 * conditions and breakpoints. An edited repeat is marked with a ticket that
 * KillcamInterceptor picks up and applies to the request it sees, which keeps
 * headers added by interceptors that run before Killcam.
 *
 * Android-free, so it runs in plain JVM tests.
 */
internal object OkHttpReplayer : CallReplayer {
    const val MAX_REMEMBERED = 300

    /** Header value KillcamInterceptor stores for redacted headers; an edit that sends it back keeps the real value. */
    const val REDACTED = "██ redacted"

    class Ticket(val edit: RequestEdit?)

    private val recent = object : LinkedHashMap<String, Call>(64, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Call>?) = size > MAX_REMEMBERED
    }
    private val tickets: MutableMap<Call, Ticket> = Collections.synchronizedMap(WeakHashMap())
    private val executor = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "killcam-repeat").apply { isDaemon = true }
    }

    fun remember(callId: String, call: Call) {
        synchronized(recent) { recent[callId] = call }
    }

    /** The ticket of a call Killcam started, consumed on first read; null for the app's own calls. */
    fun ticket(call: Call): Ticket? = tickets.remove(call)

    override fun repeat(callId: String, request: RepeatRequest): Int {
        val original = synchronized(recent) { recent[callId] }
            ?: throw ApiException(409, "not_repeatable: only the last $MAX_REMEMBERED calls of this app process can be repeated")
        val edit = request.edit
        val url = edit?.url
        if (url != null && url.toHttpUrlOrNull() == null) throw ApiException(400, "Not an http(s) URL: $url")
        val body = original.request().body
        if (body != null && (body.isOneShot() || body.isDuplex()) && edit?.body == null) {
            throw ApiException(409, "not_repeatable: the request body was one-shot; repeat with an edited body")
        }
        val calls = List(request.count) { original.clone().also { tickets[it] = Ticket(edit) } }
        if (request.concurrent) {
            // Released together, to reproduce double-submits and races.
            val start = CountDownLatch(1)
            calls.forEach { call -> executor.execute { start.await(); drain(call) } }
            start.countDown()
        } else {
            executor.execute { calls.forEach(::drain) }
        }
        return calls.size
    }

    /** Runs the call and reads its body, so it is captured; failures are already recorded by the interceptor. */
    private fun drain(call: Call) {
        runCatching { call.execute().use { response -> response.body?.source()?.readAll(blackholeSink()) } }
    }
}

private val NO_BODY_METHODS = setOf("GET", "HEAD")
private val BODY_METHODS = setOf("POST", "PUT", "PATCH", "PROPPATCH", "REPORT")

/**
 * This request with [edit] applied. Invalid parts (a bad URL, an illegal
 * header) keep the original rather than throwing, since an exception here
 * would reach the app's code.
 */
internal fun Request.edited(edit: RequestEdit): Request {
    val builder = newBuilder()
    edit.url?.toHttpUrlOrNull()?.let(builder::url)
    val headers = edit.headers?.let { unredact(it, this.headers) } ?: this.headers
    builder.headers(headers)
    val method = edit.method?.trim()?.uppercase()?.ifEmpty { null } ?: method
    val contentType = headers["Content-Type"]?.toMediaTypeOrNull() ?: body?.contentType()
    var newBody = edit.body?.toRequestBody(contentType) ?: body
    if (method in NO_BODY_METHODS) newBody = null
    if (newBody == null && method in BODY_METHODS) newBody = ByteArray(0).toRequestBody(contentType)
    if (edit.body != null) builder.removeHeader("Content-Length")
    return runCatching { builder.method(method, newBody).build() }.getOrElse { this }
}

/** Headers from the dashboard, with redacted values swapped back for the real ones. */
internal fun unredact(edited: List<Header>, original: Headers): Headers {
    val builder = Headers.Builder()
    for (header in edited) {
        val values = if (header.value == OkHttpReplayer.REDACTED) original.values(header.name) else listOf(header.value)
        for (value in values) runCatching { builder.add(header.name, value) }
    }
    return builder.build()
}
