package com.krafton.killcam.core.server

import com.krafton.killcam.core.Ids
import java.util.Collections

/**
 * Who may talk to the server.
 *
 * Loopback callers (adb forward, the in-app window) are trusted: they already
 * have USB-level control of the device. Anyone else must be on the same Wi-Fi,
 * with sharing switched on in the app, and must present the PIN shown on the
 * device, after which they get a session cookie.
 *
 * The PIN is regenerated every time sharing is enabled, and failed attempts
 * lock everyone out for a while, so six digits are not brute-forceable in the
 * few minutes a sharing window is typically open.
 */
public class AccessControl(private val clock: () -> Long = System::currentTimeMillis) {
    @Volatile public var wifiEnabled: Boolean = false
        private set

    @Volatile public var pin: String = Ids.pin()
        private set

    private val tokens: MutableSet<String> = Collections.synchronizedSet(HashSet())
    private var failures = 0
    private var lockedUntil = 0L

    public fun enableWifi(): String {
        pin = Ids.pin()
        tokens.clear()
        synchronized(this) { failures = 0; lockedUntil = 0 }
        wifiEnabled = true
        return pin
    }

    public fun disableWifi() {
        wifiEnabled = false
        tokens.clear()
    }

    public sealed interface AuthResult {
        public class Granted(public val token: String) : AuthResult
        public data object Denied : AuthResult
        public class Locked(public val retryInMs: Long) : AuthResult
    }

    public fun authenticate(candidate: String): AuthResult = synchronized(this) {
        val now = clock()
        if (!wifiEnabled) return AuthResult.Denied
        if (now < lockedUntil) return AuthResult.Locked(lockedUntil - now)
        if (constantTimeEquals(candidate.trim(), pin)) {
            failures = 0
            val token = Ids.token()
            tokens += token
            return AuthResult.Granted(token)
        }
        failures++
        if (failures >= MAX_FAILURES) {
            failures = 0
            lockedUntil = now + LOCKOUT_MS
        }
        AuthResult.Denied
    }

    public fun isAuthorized(token: String?): Boolean = wifiEnabled && token != null && token in tokens

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    public companion object {
        public const val COOKIE: String = "killcam_token"
        private const val MAX_FAILURES = 5
        private const val LOCKOUT_MS = 60_000L

        public fun isLoopback(address: String?): Boolean {
            if (address == null) return false
            val a = address.removePrefix("/").substringBefore('%')
            return a == "127.0.0.1" || a.startsWith("127.") || a == "::1" || a == "0:0:0:0:0:0:0:1" ||
                a == "localhost" || a == "::ffff:127.0.0.1"
        }

        /**
         * DNS-rebinding guard: a page on evil.example can resolve its own name
         * to 127.0.0.1 and then script requests to this server. Such requests
         * carry `Host: evil.example`; genuine ones use localhost or an IP.
         */
        public fun isAllowedHost(hostHeader: String?): Boolean {
            if (hostHeader.isNullOrBlank()) return false
            val host = if (hostHeader.startsWith("[")) {
                hostHeader.substringAfter('[').substringBefore(']')
            } else {
                hostHeader.substringBefore(':')
            }.lowercase()
            if (host == "localhost") return true
            if (hostHeader.startsWith("[")) return host.all { it.isDigit() || it in 'a'..'f' || it == ':' || it == '.' }
            val parts = host.split('.')
            return parts.size == 4 && parts.all { part -> part.toIntOrNull()?.let { it in 0..255 } == true }
        }
    }
}
