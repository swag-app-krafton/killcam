package com.krafton.killcam.core.net

import com.krafton.killcam.core.model.Header
import com.krafton.killcam.core.model.HttpBody
import com.krafton.killcam.core.store.KillcamStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Turns a call made outside OkHttp and Ktor (a vendor SDK on Volley) into a Network entry: method `SDK`, URL
 * `sdk://<source>/<name>`, the params as a pretty JSON request body, the answer as the response body, and the outcome
 * as the status text and the [OUTCOME_HEADER] header. Status 200 unless it failed; a failed call has no status and the
 * outcome as its error. Mocks, faults and repeat never apply: nothing is sent through Killcam.
 */
public object SdkCalls {
    public const val METHOD: String = "SDK"
    public const val OUTCOME_HEADER: String = "X-Killcam-Outcome"

    private val pretty = Json { prettyPrint = true }

    public fun url(source: String, name: String): String = "sdk://$source/$name"

    /** Records the call in [store]; returns its id, or null while paused. */
    public fun record(
        store: KillcamStore,
        source: String,
        name: String,
        request: Map<String, String?>,
        response: String?,
        outcome: String,
        durationMs: Long,
        failed: Boolean,
        maxBodyBytes: Long = store.limits.maxBodyBytes,
    ): String? {
        val params = pretty.encodeToString(JsonObject.serializer(), JsonObject(request.mapValues { JsonPrimitive(it.value) }))
        val responseType = if (response != null && isJson(response)) JSON else TEXT
        return store.recordCall(
            method = METHOD,
            url = url(source, name),
            source = source,
            requestBody = body(params, JSON, maxBodyBytes),
            status = if (failed) null else 200,
            message = outcome,
            responseHeaders = listOf(Header(OUTCOME_HEADER, outcome), Header("Content-Type", responseType)),
            responseBody = response?.let { body(it, responseType, maxBodyBytes) },
            error = if (failed) outcome else null,
            durationMs = durationMs,
        )
    }

    private fun body(text: String, contentType: String, limit: Long): HttpBody {
        val bytes = text.toByteArray(Charsets.UTF_8)
        val truncated = bytes.size > limit
        return Bodies.decode(if (truncated) bytes.copyOf(limit.toInt()) else bytes, bytes.size.toLong(), truncated, contentType)
    }

    private fun isJson(text: String): Boolean {
        val trimmed = text.trim()
        if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false
        return runCatching { Json.parseToJsonElement(trimmed) }.isSuccess
    }

    private const val JSON = "application/json; charset=utf-8"
    private const val TEXT = "text/plain; charset=utf-8"
}
