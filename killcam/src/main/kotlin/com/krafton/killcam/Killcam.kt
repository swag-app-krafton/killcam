package com.krafton.killcam

import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Build
import android.util.Log
import com.krafton.killcam.core.flags.FlagChangeListener
import com.krafton.killcam.core.flags.FlagRegistry
import com.krafton.killcam.core.model.FlagType
import com.krafton.killcam.core.model.LogKind
import com.krafton.killcam.core.model.LogLevel
import com.krafton.killcam.core.model.TimelineType
import com.krafton.killcam.core.platform.ActionRegistry
import com.krafton.killcam.internal.KillcamRuntime
import com.krafton.killcam.internal.MmkvRegistration
import com.krafton.killcam.internal.toJsonObject
import com.krafton.killcam.internal.ui.KillcamActivity
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Killcam: x-ray vision into a running debug build.
 *
 * Call [install] from `Application.onCreate`. Everything else is safe to call
 * at any time, from any thread, installed or not: before [install] (or in a
 * release build using `killcam-no-op`) calls are dropped and flag reads return
 * the remote or default value.
 */
public object Killcam {
    private const val TAG = "Killcam"

    @Volatile
    internal var runtime: KillcamRuntime? = null
        private set

    // Created eagerly so flags and actions registered before install() are kept.
    internal val flags = FlagRegistry()
    internal val actions = ActionRegistry()
    private val pendingInfo = ConcurrentHashMap<String, String>()
    private val listenerAdapters = ConcurrentHashMap<KillcamFlagListener, FlagChangeListener>()
    private val mmkvRegistry = ConcurrentHashMap<String, MmkvRegistration>()

    /**
     * Starts capture and the on-device server. Returns false (and does nothing)
     * in a non-debuggable build, or in a secondary process of the app.
     */
    @JvmStatic
    @JvmOverloads
    public fun install(application: Application, config: KillcamConfig = KillcamConfig()): Boolean {
        runtime?.let { return true }
        synchronized(this) {
            runtime?.let { return true }
            val debuggable = application.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
            if (!debuggable && !config.allowNonDebuggable) {
                Log.w(TAG, "Not starting: this build is not debuggable. Use killcam-no-op for release builds.")
                return false
            }
            if (!isMainProcess(application)) return false
            val created = KillcamRuntime(application, config, flags, actions, mmkvRegistry)
            created.core.extras.putAll(pendingInfo)
            runtime = created
            created.start()
            return true
        }
    }

    @JvmStatic
    public val isInstalled: Boolean get() = runtime != null

    /** Opens the in-app inspector. */
    @JvmStatic
    public fun open(context: Context) {
        if (runtime == null) return
        context.startActivity(
            Intent(context, KillcamActivity::class.java).apply {
                if (context !is android.app.Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
    }

    // ------------------------------------------------------------------ logs --

    @JvmStatic
    @JvmOverloads
    public fun log(
        level: KillcamLevel,
        tag: String,
        message: String,
        throwable: Throwable? = null,
        attributes: Map<String, Any?> = emptyMap(),
    ) {
        val store = runtime?.core?.store ?: return
        store.log(
            level = level.toCore(),
            tag = tag,
            message = message,
            throwable = throwable?.let(Log::getStackTraceString),
            kind = LogKind.Log,
            attributes = attributes.stringify(),
        )
    }

    @JvmStatic public fun v(tag: String, message: String): Unit = log(KillcamLevel.Verbose, tag, message)

    @JvmStatic public fun d(tag: String, message: String): Unit = log(KillcamLevel.Debug, tag, message)

    @JvmStatic public fun i(tag: String, message: String): Unit = log(KillcamLevel.Info, tag, message)

    @JvmStatic @JvmOverloads
    public fun w(tag: String, message: String, throwable: Throwable? = null): Unit =
        log(KillcamLevel.Warn, tag, message, throwable)

    @JvmStatic @JvmOverloads
    public fun e(tag: String, message: String, throwable: Throwable? = null): Unit =
        log(KillcamLevel.Error, tag, message, throwable)

    /** An analytics event, shown in Logs (kind "event") and on the replay timeline. */
    @JvmStatic
    @JvmOverloads
    public fun event(name: String, properties: Map<String, Any?> = emptyMap()) {
        runtime?.core?.store?.log(LogLevel.Info, "event", name, kind = LogKind.Event, attributes = properties.stringify())
    }

    /** A caught exception worth seeing: listed under Crashes as non-fatal. */
    @JvmStatic
    @JvmOverloads
    public fun recordException(throwable: Throwable, message: String? = null) {
        runtime?.core?.recordException(throwable, message)
    }

    /**
     * An error that is not a JVM exception, e.g. a React Native JavaScript
     * error, listed under Crashes with the given stack text. Set [fatal] when
     * the reporter says it was fatal (React Native's fatal handler).
     */
    @JvmStatic
    @JvmOverloads
    public fun recordError(type: String, message: String?, stackTrace: String? = null, fatal: Boolean = false) {
        runtime?.core?.recordError(type, message, stackTrace, fatal)
    }

    // -------------------------------------------------------------- timeline --

    /**
     * The screen the user is now on. Compose and React Native apps should call
     * this from their navigation layer; without it Killcam falls back to
     * activity names, which say little in a single-activity app.
     */
    @JvmStatic
    @JvmOverloads
    public fun screen(name: String, properties: Map<String, Any?> = emptyMap()) {
        runtime?.onScreen(name, properties)
    }

    /** A custom replay marker, e.g. "deeplink: swag://pay" or "biometric prompt shown". */
    @JvmStatic
    @JvmOverloads
    public fun timeline(label: String, properties: Map<String, Any?> = emptyMap()) {
        runtime?.core?.store?.timeline(TimelineType.Custom, label, properties.toJsonObject())
    }

    /** Bookmarks this moment in the replay and grabs a frame, as the bubble's long-press does. */
    @JvmStatic
    public fun mark(label: String) {
        runtime?.mark(label)
    }

    /** A row in the dashboard's Device panel, e.g. `setInfo("Environment", "staging")`. Null removes it. */
    @JvmStatic
    public fun setInfo(key: String, value: String?) {
        if (value == null) pendingInfo.remove(key) else pendingInfo[key] = value
        val extras = runtime?.core?.extras ?: return
        if (value == null) extras.remove(key) else extras[key] = value
    }

    // ----------------------------------------------------------------- flags --

    /** Declares a boolean flag and returns its effective value (override ?: remote ?: default). */
    @JvmStatic
    @JvmOverloads
    public fun booleanFlag(key: String, default: Boolean, description: String? = null, group: String? = null): Boolean =
        flags.register(key, FlagType.Boolean, default.toString(), description, group).toBooleanStrictOrNull() ?: default

    @JvmStatic
    @JvmOverloads
    public fun stringFlag(
        key: String,
        default: String,
        description: String? = null,
        group: String? = null,
        options: List<String>? = null,
    ): String = flags.register(key, FlagType.String, default, description, group, options)

    @JvmStatic
    @JvmOverloads
    public fun intFlag(key: String, default: Int, description: String? = null, group: String? = null): Int =
        flags.register(key, FlagType.Int, default.toString(), description, group).toIntOrNull() ?: default

    @JvmStatic
    @JvmOverloads
    public fun doubleFlag(key: String, default: Double, description: String? = null, group: String? = null): Double =
        flags.register(key, FlagType.Double, default.toString(), description, group).toDoubleOrNull() ?: default

    /** A JSON-valued flag, returned as its JSON text. */
    @JvmStatic
    @JvmOverloads
    public fun jsonFlag(key: String, default: String, description: String? = null, group: String? = null): String =
        flags.register(key, FlagType.Json, default, description, group)

    /** Pushes the value from the app's real flag source (Remote Config, backend). Null clears it. */
    @JvmStatic
    public fun setRemoteFlag(key: String, value: Any?) {
        flags.setRemote(key, value?.toString())
    }

    @JvmStatic
    public fun addFlagListener(listener: KillcamFlagListener) {
        val adapter = FlagChangeListener { listener.onFlagChanged(it) }
        listenerAdapters[listener] = adapter
        flags.addListener(adapter)
    }

    @JvmStatic
    public fun removeFlagListener(listener: KillcamFlagListener) {
        listenerAdapters.remove(listener)?.let(flags::removeListener)
    }

    // ------------------------------------------------------------------ mmkv --

    /**
     * Makes a non-default MMKV instance inspectable. Killcam never opens
     * instances it was not told about: opening an encrypted store without its
     * key makes MMKV discard the file. The default instance needs no call.
     */
    @JvmStatic
    @JvmOverloads
    public fun registerMmkv(id: String, cryptKey: String? = null, multiProcess: Boolean = false) {
        mmkvRegistry[id] = MmkvRegistration(cryptKey, multiProcess)
    }

    // --------------------------------------------------------------- actions --

    /**
     * A button in the dashboard's Actions panel. [action] runs on the main
     * thread and may return a message for the tester.
     */
    @JvmStatic
    @JvmOverloads
    public fun registerAction(label: String, description: String? = null, group: String? = null, action: () -> String?) {
        actions.register(label, description, group, action)
    }

    // ---------------------------------------------------------------- helpers --

    private fun KillcamLevel.toCore(): LogLevel = when (this) {
        KillcamLevel.Verbose -> LogLevel.Verbose
        KillcamLevel.Debug -> LogLevel.Debug
        KillcamLevel.Info -> LogLevel.Info
        KillcamLevel.Warn -> LogLevel.Warn
        KillcamLevel.Error -> LogLevel.Error
        KillcamLevel.Assert -> LogLevel.Assert
    }

    private fun Map<String, Any?>.stringify(): Map<String, String> =
        if (isEmpty()) emptyMap() else entries.associate { (k, v) -> k to v.toString() }

    private fun isMainProcess(application: Application): Boolean {
        val name = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Application.getProcessName()
        } else {
            runCatching { File("/proc/self/cmdline").readText().trim('\u0000', ' ', '\n') }.getOrNull()
        }
        return name == null || name == application.packageName
    }
}
