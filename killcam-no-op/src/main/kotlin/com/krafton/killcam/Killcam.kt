package com.krafton.killcam

import android.app.Application
import android.content.Context
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Release-build stand-in for Killcam: same API, no behaviour. Flag reads
 * still honour values pushed with [setRemoteFlag], so code that routes its
 * flags through Killcam works unchanged in production.
 */
public object Killcam {
    private val remote = ConcurrentHashMap<String, String>()
    private val listeners = CopyOnWriteArrayList<KillcamFlagListener>()

    @JvmStatic
    @JvmOverloads
    @Suppress("UNUSED_PARAMETER")
    public fun install(application: Application, config: KillcamConfig = KillcamConfig()): Boolean = false

    @JvmStatic
    public val isInstalled: Boolean get() = false

    @JvmStatic
    @Suppress("UNUSED_PARAMETER")
    public fun open(context: Context): Unit = Unit

    @JvmStatic
    @JvmOverloads
    @Suppress("UNUSED_PARAMETER")
    public fun log(
        level: KillcamLevel,
        tag: String,
        message: String,
        throwable: Throwable? = null,
        attributes: Map<String, Any?> = emptyMap(),
    ): Unit = Unit

    @JvmStatic @Suppress("UNUSED_PARAMETER") public fun v(tag: String, message: String): Unit = Unit

    @JvmStatic @Suppress("UNUSED_PARAMETER") public fun d(tag: String, message: String): Unit = Unit

    @JvmStatic @Suppress("UNUSED_PARAMETER") public fun i(tag: String, message: String): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun w(tag: String, message: String, throwable: Throwable? = null): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun e(tag: String, message: String, throwable: Throwable? = null): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun event(name: String, properties: Map<String, Any?> = emptyMap()): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun recordException(throwable: Throwable, message: String? = null): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun recordError(type: String, message: String?, stackTrace: String? = null, fatal: Boolean = false): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun screen(name: String, properties: Map<String, Any?> = emptyMap()): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun timeline(label: String, properties: Map<String, Any?> = emptyMap()): Unit = Unit

    @JvmStatic @Suppress("UNUSED_PARAMETER")
    public fun mark(label: String): Unit = Unit

    @JvmStatic @Suppress("UNUSED_PARAMETER")
    public fun setInfo(key: String, value: String?): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun booleanFlag(key: String, default: Boolean, description: String? = null, group: String? = null): Boolean =
        remote[key]?.toBooleanStrictOrNull() ?: default

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun stringFlag(
        key: String,
        default: String,
        description: String? = null,
        group: String? = null,
        options: List<String>? = null,
    ): String = remote[key] ?: default

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun intFlag(key: String, default: Int, description: String? = null, group: String? = null): Int =
        remote[key]?.toIntOrNull() ?: default

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun doubleFlag(key: String, default: Double, description: String? = null, group: String? = null): Double =
        remote[key]?.toDoubleOrNull() ?: default

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun jsonFlag(key: String, default: String, description: String? = null, group: String? = null): String =
        remote[key] ?: default

    @JvmStatic
    public fun setRemoteFlag(key: String, value: Any?) {
        val before = remote[key]
        if (value == null) remote.remove(key) else remote[key] = value.toString()
        if (before != remote[key]) listeners.forEach { it.onFlagChanged(key) }
    }

    @JvmStatic
    public fun addFlagListener(listener: KillcamFlagListener) {
        listeners += listener
    }

    @JvmStatic
    public fun removeFlagListener(listener: KillcamFlagListener) {
        listeners -= listener
    }

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun registerMmkv(id: String, cryptKey: String? = null, multiProcess: Boolean = false): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun registerAction(label: String, description: String? = null, group: String? = null, action: () -> String?): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun registerEndpoint(
        key: String,
        method: String? = null,
        name: String? = null,
        group: String? = null,
        description: String? = null,
        urlPattern: String? = null,
        regex: Boolean = false,
    ): Unit = Unit

    @JvmStatic @Suppress("UNUSED_PARAMETER")
    public fun setNetworkProfile(profile: KillcamNetworkProfile): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun setNetworkConditions(
        latencyMs: Long = 0,
        jitterMs: Long = 0,
        downloadKbps: Long = 0,
        uploadKbps: Long = 0,
        lossPercent: Int = 0,
        offline: Boolean = false,
    ): Unit = Unit

    @JvmStatic
    public fun clearNetworkConditions(): Unit = Unit

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun failRequests(
        urlPattern: String,
        failure: KillcamFailure,
        method: String? = null,
        times: Int = 0,
        probability: Int = 100,
        delayMs: Long = 0,
        dropAfterBytes: Long = 0,
        regex: Boolean = false,
    ): String? = null

    @JvmStatic @JvmOverloads @Suppress("UNUSED_PARAMETER")
    public fun mockResponse(
        urlPattern: String,
        status: Int,
        body: String = "",
        headers: Map<String, String> = mapOf("Content-Type" to "application/json"),
        method: String? = null,
        times: Int = 0,
        probability: Int = 100,
        delayMs: Long = 0,
        regex: Boolean = false,
    ): String? = null

    @JvmStatic @Suppress("UNUSED_PARAMETER")
    public fun removeMock(id: String): Unit = Unit
}
