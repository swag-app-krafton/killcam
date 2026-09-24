package com.krafton.killcam.core.net

import com.krafton.killcam.core.model.HttpBody
import com.krafton.killcam.core.model.NetworkCall
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

public object Curl {
    /** A copy-pasteable cURL command that replays [call] against the real backend. */
    public fun of(call: NetworkCall): String = buildString {
        append("curl")
        if (call.method != "GET" || call.requestBody != null) append(" -X ").append(call.method)
        append(" ").append(quote(call.url))
        for (header in call.requestHeaders) {
            // curl computes these itself; a stale copy breaks the replay.
            if (header.name.equals("Content-Length", true) || header.name.equals("Host", true)) continue
            append(" \\\n  -H ").append(quote("${header.name}: ${header.value}"))
        }
        val body = call.requestBody
        when {
            body == null -> Unit
            body.text != null && !body.truncated -> append(" \\\n  --data-raw ").append(quote(body.text))
            body.text != null -> append(" \\\n  --data-raw ").append(quote(body.text)).append("  # truncated by Killcam")
            else -> append(" \\\n  --data-binary @body.bin  # binary body (${body.size} bytes) not inlined")
        }
        if (call.requestHeaders.any { it.name.equals("Accept-Encoding", true) }) append(" \\\n  --compressed")
    }

    private fun quote(value: String): String = "'" + value.replace("'", "'\\''") + "'"
}

/** HAR 1.2, which Charles, Proxyman, Chrome DevTools and most backend tools can import. */
public object Har {
    private fun iso(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(ms))

    public fun of(calls: List<NetworkCall>, creator: String, version: String): JsonObject = buildJsonObject {
        putJsonObject("log") {
            put("version", "1.2")
            putJsonObject("creator") {
                put("name", creator)
                put("version", version)
            }
            put("entries", JsonArray(calls.map(::entry)))
        }
    }

    private fun entry(call: NetworkCall): JsonObject = buildJsonObject {
        put("startedDateTime", iso(call.startMs))
        put("time", call.durationMs ?: 0)
        putJsonObject("request") {
            put("method", call.method)
            put("url", call.url)
            put("httpVersion", call.protocol ?: "HTTP/1.1")
            put("headers", headers(call.requestHeaders.map { it.name to it.value }))
            put("queryString", query(call.url))
            put("cookies", JsonArray(emptyList()))
            put("headersSize", -1)
            put("bodySize", call.requestSize)
            call.requestBody?.let { body ->
                putJsonObject("postData") {
                    put("mimeType", body.contentType ?: "")
                    put("text", body.text ?: body.base64 ?: "")
                    if (body.text == null) put("encoding", "base64")
                }
            }
        }
        putJsonObject("response") {
            put("status", call.status ?: 0)
            put("statusText", call.responseMessage ?: call.error ?: "")
            put("httpVersion", call.protocol ?: "HTTP/1.1")
            put("headers", headers(call.responseHeaders.map { it.name to it.value }))
            put("cookies", JsonArray(emptyList()))
            put("content", content(call.responseBody, call.responseSize))
            put("redirectURL", call.responseHeaders.firstOrNull { it.name.equals("Location", true) }?.value ?: "")
            put("headersSize", -1)
            put("bodySize", call.responseSize)
        }
        put("cache", JsonObject(emptyMap()))
        putJsonObject("timings") {
            put("send", 0)
            put("wait", call.durationMs ?: -1)
            put("receive", 0)
        }
        call.error?.let { put("_error", it) }
        call.mockRuleId?.let { put("_killcamMockRuleId", it) }
        call.screen?.let { put("_killcamScreen", it) }
    }

    private fun content(body: HttpBody?, size: Long): JsonObject = buildJsonObject {
        put("size", body?.size ?: size)
        put("mimeType", body?.contentType ?: "")
        if (body?.text != null) put("text", body.text)
        if (body?.base64 != null) {
            put("text", body.base64)
            put("encoding", "base64")
        }
    }

    private fun headers(pairs: List<Pair<String, String>>): JsonArray = buildJsonArray {
        for ((name, value) in pairs) add(buildJsonObject { put("name", name); put("value", value) })
    }

    private fun query(url: String): JsonArray {
        val raw = runCatching { URI(url).rawQuery }.getOrNull() ?: return JsonArray(emptyList())
        return JsonArray(
            raw.split('&').filter { it.isNotEmpty() }.map {
                buildJsonObject {
                    put("name", JsonPrimitive(it.substringBefore('=')))
                    put("value", JsonPrimitive(it.substringAfter('=', "")))
                }
            },
        )
    }
}
