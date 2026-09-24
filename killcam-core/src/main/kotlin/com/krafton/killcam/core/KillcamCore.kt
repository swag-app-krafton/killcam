package com.krafton.killcam.core

import com.krafton.killcam.core.endpoints.EndpointRegistry
import com.krafton.killcam.core.flags.FlagRegistry
import com.krafton.killcam.core.mock.BreakpointManager
import com.krafton.killcam.core.mock.MockEngine
import com.krafton.killcam.core.mock.NetworkConditionsEngine
import com.krafton.killcam.core.net.CallReplayer
import com.krafton.killcam.core.model.AppInfo
import com.krafton.killcam.core.model.Crash
import com.krafton.killcam.core.model.CrashSummary
import com.krafton.killcam.core.model.InfoSection
import com.krafton.killcam.core.model.KeyValue
import com.krafton.killcam.core.model.KillcamStatus
import com.krafton.killcam.core.model.LogKind
import com.krafton.killcam.core.model.LogLevel
import com.krafton.killcam.core.model.NetworkConditions
import com.krafton.killcam.core.model.FlagType
import com.krafton.killcam.core.model.RemoteConfigInfo
import com.krafton.killcam.core.model.RemoteConfigSource
import com.krafton.killcam.core.model.SessionBundle
import com.krafton.killcam.core.model.SessionReason
import com.krafton.killcam.core.model.SessionSummary
import com.krafton.killcam.core.model.TimelineEvent
import com.krafton.killcam.core.model.TimelineType
import com.krafton.killcam.core.net.Har
import com.krafton.killcam.core.platform.ActionRegistry
import com.krafton.killcam.core.platform.KillcamPlatform
import com.krafton.killcam.core.server.AccessControl
import com.krafton.killcam.core.server.KillcamServer
import com.krafton.killcam.core.session.SessionStore
import com.krafton.killcam.core.store.JsonFile
import com.krafton.killcam.core.store.KillcamStore
import com.krafton.killcam.core.store.StoreLimits
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

public const val KILLCAM_VERSION: String = "0.1.0"

/** Flags group under which Firebase Remote Config keys are mirrored. */
public const val REMOTE_CONFIG_GROUP: String = "Firebase Remote Config"

public data class CoreConfig(
    /** Killcam's private directory: sessions, screenshots, mocks and flag overrides live here. */
    val dataDir: File,
    val port: Int = 8090,
    val limits: StoreLimits = StoreLimits(),
    val maxSavedSessions: Int = 10,
    val maxScreenshots: Int = 300,
)

/**
 * Composition root for everything platform-independent. The Android module
 * builds one of these at install time; the desktop demo and tests build one
 * with a fake [KillcamPlatform].
 */
public class KillcamCore(
    public val platform: KillcamPlatform,
    public val config: CoreConfig,
    public val flags: FlagRegistry = FlagRegistry(),
    public val actions: ActionRegistry = ActionRegistry(),
    public val endpoints: EndpointRegistry = EndpointRegistry(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    public val startMs: Long = clock()
    public val sessionId: String = Ids.session(startMs)
    public val store: KillcamStore = KillcamStore(sessionId, config.limits, clock)
    public val sessions: SessionStore =
        SessionStore(File(config.dataDir, "sessions"), sessionId, config.maxSavedSessions, config.maxScreenshots)
    public val mocks: MockEngine =
        MockEngine(
            JsonFile(File(config.dataDir, "mocks.json"), MockEngine.storageSerializer()),
            clock,
            endpoints = endpoints,
        ) {
            store.emitMocks(it)
        }
    public val conditions: NetworkConditionsEngine =
        NetworkConditionsEngine(
            JsonFile(File(config.dataDir, "network-conditions.json"), NetworkConditionsEngine.storageSerializer()),
        ) {
            store.emitConditions(it)
            // On the replay, so a bug bundle says which network it was recorded on.
            store.timeline(
                TimelineType.Custom,
                "Network: ${NetworkConditionsEngine.label(it)}",
                KillcamJson.encodeToJsonElement(NetworkConditions.serializer(), it) as JsonObject,
            )
        }
    public val breakpoints: BreakpointManager = BreakpointManager(clock) { store.emitBreakpoints(it) }

    /** Re-sends captured calls; set by the HTTP integration once it has seen a call (OkHttp: KillcamInterceptor). */
    @Volatile public var replayer: CallReplayer? = null

    public val access: AccessControl = AccessControl(clock)

    /** Free-form rows the app adds to the Device panel (`Killcam.setInfo`). */
    public val extras: MutableMap<String, String> = ConcurrentHashMap()

    private val server = KillcamServer(this)
    private val manualSaves = AtomicInteger()

    init {
        if (conditions.get().active) {
            val label = NetworkConditionsEngine.label(conditions.get())
            store.log(LogLevel.Warn, "Killcam", "Network conditions from the last run are active: $label")
            store.timeline(TimelineType.Custom, "Network: $label")
        }
        endpoints.attachStorage(JsonFile(File(config.dataDir, "endpoints.json"), EndpointRegistry.storageSerializer))
        endpoints.onListChanged = { store.emitEndpoints(it) }
        flags.attachStorage(JsonFile(File(config.dataDir, "flags.json"), FlagRegistry.storageSerializer))
        flags.onListChanged = { store.emitFlags(it) }
    }

    // ----------------------------------------------------------- server ----

    /** Starts serving; returns the bound port (the configured one, or the next free one). Blocking. */
    public fun start(): Int = server.start(bindAll = access.wifiEnabled)

    public fun stop() {
        server.stop()
    }

    public val port: Int get() = server.port

    public fun setWifiEnabled(enabled: Boolean): KillcamStatus {
        if (enabled == access.wifiEnabled) return status(remote = false)
        if (enabled) access.enableWifi() else access.disableWifi()
        server.restart(bindAll = enabled)
        return status(remote = false).also { store.emitStatus(it) }
    }

    public fun status(remote: Boolean): KillcamStatus = KillcamStatus(
        capturePaused = store.paused,
        wifiEnabled = access.wifiEnabled,
        wifiUrl = if (access.wifiEnabled) platform.lanAddress()?.let { "http://$it:$port" } else null,
        remote = remote,
        port = port,
    )

    public fun setPaused(paused: Boolean): KillcamStatus {
        store.paused = paused
        return status(remote = false).also { store.emitStatus(it) }
    }

    // ------------------------------------------------------------- info ----

    public fun appInfo(): AppInfo = AppInfo(
        appName = platform.appName,
        packageName = platform.packageName,
        versionName = platform.versionName,
        versionCode = platform.versionCode,
        buildType = platform.buildType,
        deviceName = platform.deviceName,
        sessionId = sessionId,
        sessionStartMs = startMs,
        killcamVersion = KILLCAM_VERSION,
        sections = buildList {
            addAll(runCatching { platform.infoSections() }.getOrDefault(emptyList()))
            if (extras.isNotEmpty()) {
                add(InfoSection("App-provided", extras.entries.sortedBy { it.key }.map { KeyValue(it.key, it.value) }))
            }
            add(
                InfoSection(
                    "Killcam",
                    listOf(
                        KeyValue("Version", KILLCAM_VERSION),
                        KeyValue("Session", sessionId),
                        KeyValue("Port", port.toString()),
                        KeyValue("USB access", "adb forward tcp:$port tcp:$port"),
                        KeyValue("Wi-Fi sharing", if (access.wifiEnabled) "on" else "off"),
                        KeyValue("Capture", if (store.paused) "paused" else "recording"),
                    ),
                ),
            )
        },
    )

    // --------------------------------------------------------- sessions ----

    public fun liveSummary(): SessionSummary = SessionSummary(
        id = sessionId,
        label = null,
        startMs = startMs,
        endMs = null,
        live = true,
        reason = SessionReason.Live,
        crash = null,
        appVersion = platform.versionName,
        screenshotCount = sessions.screenshotCount(sessionId),
        eventCount = store.timeline().size,
    )

    public fun liveBundle(summary: SessionSummary = liveSummary()): SessionBundle = SessionBundle(
        session = summary,
        app = appInfo(),
        network = store.networkCalls(),
        logs = store.logs(),
        crashes = store.crashes(),
        timeline = store.timeline(),
    )

    public fun bundle(id: String): SessionBundle? =
        if (id == "live" || id == sessionId) liveBundle() else sessions.load(id)

    public fun sessionList(): List<SessionSummary> = listOf(liveSummary()) + sessions.saved()

    /** Snapshots the live session under a new id, so it can be exported or revisited later. */
    public fun saveSession(label: String?): SessionSummary {
        val live = liveSummary()
        val summary = live.copy(
            id = "$sessionId-s${manualSaves.incrementAndGet()}",
            label = label?.takeIf { it.isNotBlank() },
            endMs = clock(),
            live = false,
            reason = SessionReason.Manual,
        )
        sessions.save(liveBundle(summary))
        return summary
    }

    public fun deleteSession(id: String): Boolean = sessions.delete(id)

    public fun har(bundle: SessionBundle): JsonObject = Har.of(bundle.network, "Killcam", KILLCAM_VERSION)

    // ---------------------------------------------------------- crashes ----

    /**
     * Records a fatal crash and synchronously writes the whole session to disk.
     * Runs on the dying thread inside the uncaught-exception handler, so it
     * must not hop threads or wait on anything the crash might have broken.
     */
    public fun onFatalCrash(thread: Thread, throwable: Throwable): Crash {
        val crash = store.crash(throwable, thread, fatal = true)
        runCatching {
            val summary = liveSummary().copy(
                endMs = crash.ts,
                live = false,
                reason = SessionReason.Crash,
                crash = crash.summary(),
            )
            sessions.save(liveBundle(summary))
        }
        return crash
    }

    public fun recordException(throwable: Throwable, message: String?): Crash {
        val crash = store.crash(throwable, Thread.currentThread(), fatal = false, message = message)
        store.log(LogLevel.Error, "Killcam", message ?: (throwable.message ?: throwable.javaClass.name),
            throwable = throwable.stackTraceText(), kind = LogKind.Log)
        return crash
    }

    /**
     * An error that has no JVM throwable (a JavaScript error, a native crash
     * report): listed under Crashes and logged like [recordException]. [fatal]
     * means fatal to the app or the surface it ran in, as the reporter says.
     */
    public fun recordError(type: String, message: String?, stackTrace: String?, fatal: Boolean = false): Crash {
        val trace = stackTrace?.takeIf { it.isNotBlank() } ?: "$type: ${message.orEmpty()}"
        val crash = store.crash(type, message, trace, Thread.currentThread().name, fatal)
        store.log(LogLevel.Error, "Killcam", "$type: ${message.orEmpty()}", throwable = trace, kind = LogKind.Log)
        return crash
    }

    /** This session's crashes, then fatal crashes saved from earlier sessions, newest first. */
    public fun crashList(): List<CrashSummary> {
        val current = store.crashes().map { it.summary() }
        val previous = sessions.saved().mapNotNull { it.crash }.filter { it.sessionId != sessionId }
        return (current + previous).sortedByDescending { it.ts }
    }

    public fun crash(id: String): Crash? {
        store.crashes().firstOrNull { it.id == id }?.let { return it }
        val owner = sessions.saved().firstOrNull { it.crash?.id == id } ?: return null
        return sessions.load(owner.id)?.crashes?.firstOrNull { it.id == id }
    }

    // ---------------------------------------------------- remote config ----

    /**
     * Remote Config as the app sees it, after mirroring every key into Flags
     * so testers can override them. Keys the app already declared through
     * Killcam.*Flag() keep their declared type and group; only their remote
     * value is updated.
     */
    public fun remoteConfig(fetch: Boolean): RemoteConfigInfo? {
        val provider = platform.remoteConfig ?: return null
        val raw = if (fetch) provider.fetchAndActivate() else provider.snapshot()
        for (value in raw.values) {
            if (flags.typeOf(value.key) == null) {
                flags.register(
                    key = value.key,
                    type = inferFlagType(value.value),
                    default = value.value,
                    description = "Firebase Remote Config",
                    group = REMOTE_CONFIG_GROUP,
                )
            }
            flags.setRemote(value.key, value.value.takeIf { value.source == RemoteConfigSource.Remote })
        }
        return raw.copy(values = raw.values.map { it.copy(flagOverride = flags.overrideOf(it.key)) })
    }

    private fun inferFlagType(value: String): FlagType {
        val trimmed = value.trim()
        return when {
            trimmed == "true" || trimmed == "false" -> FlagType.Boolean
            trimmed.toLongOrNull() != null -> FlagType.Int
            trimmed.toDoubleOrNull() != null -> FlagType.Double
            (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
                runCatching { KillcamJson.parseToJsonElement(trimmed) }.isSuccess -> FlagType.Json
            else -> FlagType.String
        }
    }

    // ------------------------------------------------------ screenshots ----

    /** Stores an encoded frame and adds it to the timeline. Returns null while capture is paused. */
    public fun recordScreenshot(
        jpeg: ByteArray,
        width: Int,
        height: Int,
        trigger: String,
        capturedAt: Long = clock(),
        screen: String? = store.currentScreen,
    ): TimelineEvent? {
        if (store.paused) return null
        val id = sessions.saveScreenshot(jpeg)
        return store.timeline(
            type = TimelineType.Screenshot,
            label = screen ?: "Screenshot",
            ts = capturedAt,
            screen = screen,
            screenshotId = id,
            data = JsonObject(
                mapOf(
                    "width" to JsonPrimitive(width),
                    "height" to JsonPrimitive(height),
                    "trigger" to JsonPrimitive(trigger),
                ),
            ),
        )
    }
}
