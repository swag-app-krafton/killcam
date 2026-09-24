package com.krafton.killcam.core.net

import com.krafton.killcam.core.model.HttpBody
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.InputStream
import java.nio.charset.Charset
import java.util.Base64
import java.util.zip.GZIPInputStream
import java.util.zip.InflaterInputStream

/** Turns captured body bytes into the wire [HttpBody]: decoded text when it is text, base64 otherwise. */
public object Bodies {

    public fun decode(
        bytes: ByteArray,
        totalSize: Long,
        truncated: Boolean,
        contentType: String?,
        contentEncoding: String? = null,
    ): HttpBody {
        val plain = decompress(bytes, contentEncoding)
        val charset = charsetOf(contentType)
        return if (plain != null && (isTextual(contentType) || (contentType == null && looksLikeText(plain)))) {
            HttpBody(
                text = String(plain, charset ?: Charsets.UTF_8),
                base64 = null,
                size = totalSize,
                truncated = truncated,
                contentType = contentType,
            )
        } else {
            HttpBody(
                text = null,
                base64 = Base64.getEncoder().encodeToString(plain ?: bytes),
                size = totalSize,
                truncated = truncated,
                contentType = contentType,
            )
        }
    }

    /** A body the app declined to expose (one-shot, duplex, streaming upload). */
    public fun omitted(reason: String, size: Long, contentType: String?): HttpBody =
        HttpBody(text = "[$reason]", base64 = null, size = size, truncated = true, contentType = contentType)

    /** `application/json; charset=utf-8` -> `application/json`. */
    public fun mimeOf(contentType: String?): String? =
        contentType?.substringBefore(';')?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }

    public fun isTextual(contentType: String?): Boolean {
        val mime = mimeOf(contentType) ?: return false
        return mime.startsWith("text/") ||
            mime.endsWith("/json") || mime.endsWith("+json") ||
            mime.endsWith("/xml") || mime.endsWith("+xml") ||
            mime.endsWith("/javascript") || mime.endsWith("/ecmascript") ||
            mime == "application/x-www-form-urlencoded" ||
            mime == "application/graphql" ||
            mime == "application/x-ndjson" ||
            mime == "application/problem+json"
    }

    private fun charsetOf(contentType: String?): Charset? {
        val param = contentType?.split(';')?.drop(1)
            ?.map { it.trim() }
            ?.firstOrNull { it.startsWith("charset=", ignoreCase = true) }
            ?: return null
        return runCatching { Charset.forName(param.substringAfter('=').trim('"', ' ')) }.getOrNull()
    }

    /** Heuristic for bodies without a content type: mostly printable UTF-8 in the first 512 chars. */
    internal fun looksLikeText(bytes: ByteArray): Boolean {
        if (bytes.isEmpty()) return true
        val sample = String(bytes, 0, minOf(bytes.size, 512), Charsets.UTF_8)
        val bad = sample.count { it == '�' || (it.isISOControl() && it != '\n' && it != '\r' && it != '\t') }
        return bad <= sample.length / 50
    }

    /**
     * Undoes `gzip`/`deflate` so a body the app requested compressed is still
     * readable. Truncated input yields whatever decompressed before the cut.
     * Returns null for encodings we cannot read (e.g. `br`), which then ship as base64.
     */
    internal fun decompress(bytes: ByteArray, contentEncoding: String?): ByteArray? {
        val encoding = contentEncoding?.trim()?.lowercase()
        if (encoding.isNullOrEmpty() || encoding == "identity") return bytes
        val stream: (InputStream) -> InputStream = when (encoding) {
            "gzip", "x-gzip" -> { input -> GZIPInputStream(input) }
            "deflate" -> { input -> InflaterInputStream(input) }
            else -> return null
        }
        val out = ByteArrayOutputStream()
        try {
            stream(ByteArrayInputStream(bytes)).use { it.copyTo(out) }
        } catch (_: EOFException) {
            // Truncated capture: keep the prefix we managed to inflate.
        } catch (_: java.io.IOException) {
            return if (out.size() > 0) out.toByteArray() else null
        }
        return out.toByteArray()
    }
}
