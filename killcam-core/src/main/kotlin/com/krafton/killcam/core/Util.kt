package com.krafton.killcam.core

import kotlinx.serialization.json.Json
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The one JSON configuration used on the wire and on disk.
 *
 * `explicitNulls` keeps null fields present, which the dashboard contract
 * relies on; `ignoreUnknownKeys` lets an older app read a session written by a
 * newer Killcam without failing.
 */
public val KillcamJson: Json = Json {
    encodeDefaults = true
    explicitNulls = true
    ignoreUnknownKeys = true
}

public object Ids {
    private val random = SecureRandom()
    private const val ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"

    /** 12 base-36 characters: unique enough for one device's debug data, short in URLs. */
    public fun next(): String {
        val chars = CharArray(12)
        for (i in chars.indices) chars[i] = ALPHABET[random.nextInt(ALPHABET.length)]
        return String(chars)
    }

    /** Sortable, readable session ids such as `20260924-120301-k3f9`; they double as directory names. */
    public fun session(startMs: Long): String {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(startMs))
        return "$stamp-${next().take(4)}"
    }

    /** Ids reach file paths, so anything outside this set is rejected before touching disk. */
    public fun isSafe(id: String): Boolean =
        id.isNotEmpty() && id.length <= 64 && id.all { it.isLetterOrDigit() || it == '-' || it == '_' }

    public fun token(bytes: Int = 24): String {
        val buffer = ByteArray(bytes)
        random.nextBytes(buffer)
        return buffer.joinToString("") { "%02x".format(it) }
    }

    public fun pin(): String = (0 until 6).joinToString("") { random.nextInt(10).toString() }
}

/** Thrown by handlers to answer with a specific status and `{ error }` body. */
public class ApiException(public val status: Int, message: String) : Exception(message)

internal fun Throwable.stackTraceText(): String {
    val writer = java.io.StringWriter()
    printStackTrace(java.io.PrintWriter(writer))
    return writer.toString()
}
