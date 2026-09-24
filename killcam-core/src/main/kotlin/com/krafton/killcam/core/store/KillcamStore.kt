package com.krafton.killcam.core.store

import com.krafton.killcam.core.Ids
import com.krafton.killcam.core.KillcamJson
import com.krafton.killcam.core.model.CallState
import com.krafton.killcam.core.model.Crash
import com.krafton.killcam.core.model.Flag
import com.krafton.killcam.core.model.Header
import com.krafton.killcam.core.model.HttpBody
import com.krafton.killcam.core.model.KillcamStatus
import com.krafton.killcam.core.model.LogEntry
import com.krafton.killcam.core.model.LogKind
import com.krafton.killcam.core.model.LogLevel
import com.krafton.killcam.core.model.Endpoint
import com.krafton.killcam.core.model.MockRule
import com.krafton.killcam.core.model.NetworkConditions
import com.krafton.killcam.core.model.PausedCall
import com.krafton.killcam.core.model.NetworkCall
import com.krafton.killcam.core.model.NetworkSummary
import com.krafton.killcam.core.model.TimelineEvent
import com.krafton.killcam.core.model.TimelineType
import com.krafton.killcam.core.stackTraceText
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong

/** One server-sent event, already encoded, fanned out to every open dashboard. */
public class LiveEvent(public val type: String, public val json: String)

public fun interface LiveListener {
    public fun onEvent(event: LiveEvent)
}

public data class StoreLimits(
    val maxNetworkCalls: Int = 500,
    val maxLogs: Int = 5_000,
    val maxTimeline: Int = 5_000,
    val maxCrashes: Int = 50,
    /** Bytes of request + response body kept per call; the rest is cut and marked truncated. */
    val maxBodyBytes: Long = 128 * 1024,
    /** Total body bytes kept across all calls; older calls lose their bodies first. */
    val bodyBudgetBytes: Long = 24L * 1024 * 1024,
)

/**
 * The live session's in-memory record: network, logs, crashes and timeline.
 *
 * Every stream is capped so a long QA session cannot grow the debug build's
 * heap without bound; bodies have their own byte budget because they dominate
 * memory. Mutations happen under one lock and are broadcast as [LiveEvent]s
 * after the lock is released, so a slow dashboard can never stall the app's
 * network or logging threads.
 */
public class KillcamStore(
    public val sessionId: String,
    public val limits: StoreLimits = StoreLimits(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val seq = AtomicLong()
    private val lock = Any()
    private val listeners = CopyOnWriteArrayList<LiveListener>()

    private val network = LinkedHashMap<String, NetworkCall>()
    private var bodyBytes = 0L
    private val logs = ArrayDeque<LogEntry>()
    private val crashes = ArrayDeque<Crash>()
    private val timeline = ArrayDeque<TimelineEvent>()

    /** While paused, new network/log/timeline data is dropped. Crashes are always kept. */
    @Volatile public var paused: Boolean = false

    /** Name of the screen on top, stamped onto every event so panels can group by it. */
    @Volatile public var currentScreen: String? = null
        private set

    public fun now(): Long = clock()

    public fun currentSeq(): Long = seq.get()

    private fun nextSeq(): Long = seq.incrementAndGet()

    // ------------------------------------------------------------- live ----

    public fun addListener(listener: LiveListener) {
        listeners += listener
    }

    public fun removeListener(listener: LiveListener) {
        listeners -= listener
    }

    public fun hasListeners(): Boolean = listeners.isNotEmpty()

    private fun emit(type: String, json: String) {
        if (listeners.isEmpty()) return
        val event = LiveEvent(type, json)
        for (listener in listeners) {
            runCatching { listener.onEvent(event) }
        }
    }

    public fun emitMocks(rules: List<MockRule>) {
        emit("mocks", KillcamJson.encodeToString(ListSerializer(MockRule.serializer()), rules))
    }

    public fun emitConditions(conditions: NetworkConditions) {
        emit("conditions", KillcamJson.encodeToString(NetworkConditions.serializer(), conditions))
    }

    public fun emitEndpoints(endpoints: List<Endpoint>) {
        emit("endpoints", KillcamJson.encodeToString(ListSerializer(Endpoint.serializer()), endpoints))
    }

    public fun emitBreakpoints(paused: List<PausedCall>) {
        emit("breakpoints", KillcamJson.encodeToString(ListSerializer(PausedCall.serializer()), paused))
    }

    public fun emitFlags(flags: List<Flag>) {
        emit("flags", KillcamJson.encodeToString(ListSerializer(Flag.serializer()), flags))
    }

    public fun emitStatus(status: KillcamStatus) {
        emit("status", KillcamJson.encodeToString(KillcamStatus.serializer(), status))
    }

    // ---------------------------------------------------------- network ----

    /**
     * Records the start of a call and returns its id, or null while paused.
     * [requestBody] should already be capped to [StoreLimits.maxBodyBytes].
     */
    public fun beginCall(
        method: String,
        url: String,
        requestHeaders: List<Header>,
        requestBody: HttpBody?,
        requestSize: Long,
        source: String,
        mockRuleId: String? = null,
        protocol: String? = null,
    ): String? {
        if (paused) return null
        val (scheme, host, path) = splitUrl(url)
        val call = NetworkCall(
            id = Ids.next(),
            seq = nextSeq(),
            startMs = now(),
            durationMs = null,
            method = method.uppercase(),
            url = url,
            scheme = scheme,
            host = host,
            path = path,
            status = null,
            state = CallState.Pending,
            error = null,
            requestSize = requestSize,
            responseSize = 0,
            contentType = null,
            mockRuleId = mockRuleId,
            source = source,
            screen = currentScreen,
            protocol = protocol,
            responseMessage = null,
            requestHeaders = requestHeaders,
            requestBody = requestBody,
            responseHeaders = emptyList(),
            responseBody = null,
        )
        val summary = synchronized(lock) {
            network[call.id] = call
            bodyBytes += weight(requestBody)
            enforceNetworkLimits()
            call.summary()
        }
        emitNetwork(summary)
        return call.id
    }

    /** Headers have arrived. The body may still be streaming; see [completeBody]. */
    public fun completeCall(
        id: String,
        status: Int,
        message: String?,
        protocol: String?,
        headers: List<Header>,
        contentType: String?,
        responseSize: Long,
        mockRuleId: String? = null,
    ) {
        update(id) { call ->
            call.copy(
                status = status,
                state = CallState.Complete,
                responseMessage = message,
                protocol = protocol ?: call.protocol,
                responseHeaders = headers,
                contentType = contentType?.substringBefore(';')?.trim(),
                responseSize = responseSize.coerceAtLeast(0),
                durationMs = now() - call.startMs,
                mockRuleId = mockRuleId ?: call.mockRuleId,
            )
        }
    }

    /** The app finished reading (or closed) the response body. */
    public fun completeBody(id: String, body: HttpBody) {
        update(id) { call ->
            call.copy(
                responseBody = body,
                responseSize = maxOf(call.responseSize, body.size),
            )
        }
    }

    /** The request as it actually went out, after a tester edited it at a breakpoint. */
    public fun editRequest(id: String, method: String, url: String, headers: List<Header>, body: HttpBody?, size: Long) {
        val (scheme, host, path) = splitUrl(url)
        update(id) { call ->
            call.copy(
                method = method.uppercase(), url = url, scheme = scheme, host = host, path = path,
                requestHeaders = headers, requestBody = body, requestSize = size,
            )
        }
    }

    public fun failCall(id: String, error: Throwable) {
        val text = error.message?.let { "${error.javaClass.simpleName}: $it" } ?: error.javaClass.simpleName
        update(id) { call ->
            call.copy(state = CallState.Failed, error = text, durationMs = now() - call.startMs)
        }
    }

    private fun update(id: String, transform: (NetworkCall) -> NetworkCall) {
        val summary = synchronized(lock) {
            val existing = network[id] ?: return
            val updated = transform(existing)
            bodyBytes += weight(updated.requestBody) + weight(updated.responseBody) -
                weight(existing.requestBody) - weight(existing.responseBody)
            network[id] = updated
            enforceNetworkLimits()
            updated.summary()
        }
        emitNetwork(summary)
    }

    private fun emitNetwork(summary: NetworkSummary) {
        emit("network", KillcamJson.encodeToString(NetworkSummary.serializer(), summary))
    }

    /** Caller holds [lock]. Drops whole calls past the count cap, then old bodies past the byte budget. */
    private fun enforceNetworkLimits() {
        while (network.size > limits.maxNetworkCalls) {
            val eldest = network.entries.iterator()
            val removed = eldest.next().value
            eldest.remove()
            bodyBytes -= weight(removed.requestBody) + weight(removed.responseBody)
        }
        if (bodyBytes <= limits.bodyBudgetBytes) return
        for (entry in network.entries) {
            if (bodyBytes <= limits.bodyBudgetBytes) break
            val call = entry.value
            val before = weight(call.requestBody) + weight(call.responseBody)
            if (before == 0L) continue
            val slim = call.copy(requestBody = call.requestBody?.evicted(), responseBody = call.responseBody?.evicted())
            entry.setValue(slim)
            bodyBytes -= before - (weight(slim.requestBody) + weight(slim.responseBody))
        }
    }

    private fun HttpBody.evicted(): HttpBody =
        HttpBody(text = "[evicted: Killcam body budget exceeded]", base64 = null, size = size, truncated = true, contentType = contentType)

    private fun weight(body: HttpBody?): Long =
        if (body == null) 0 else (body.text?.length ?: 0).toLong() * 2 + (body.base64?.length ?: 0)

    public fun networkSummaries(): List<NetworkSummary> = synchronized(lock) { network.values.map { it.summary() } }

    public fun networkCalls(): List<NetworkCall> = synchronized(lock) { network.values.toList() }

    public fun networkCall(id: String): NetworkCall? = synchronized(lock) { network[id] }

    // ------------------------------------------------------------- logs ----

    public fun log(
        level: LogLevel,
        tag: String,
        message: String,
        throwable: String? = null,
        kind: LogKind = LogKind.Log,
        attributes: Map<String, String> = emptyMap(),
        thread: String? = Thread.currentThread().name,
        ts: Long = now(),
    ): LogEntry? {
        if (paused) return null
        val entry = LogEntry(
            id = Ids.next(),
            seq = nextSeq(),
            ts = ts,
            level = level,
            tag = tag,
            message = message,
            throwable = throwable,
            kind = kind,
            attributes = attributes,
            thread = thread,
            screen = currentScreen,
        )
        synchronized(lock) {
            logs.addLast(entry)
            while (logs.size > limits.maxLogs) logs.removeFirst()
        }
        emit("log", KillcamJson.encodeToString(LogEntry.serializer(), entry))
        return entry
    }

    public fun logs(): List<LogEntry> = synchronized(lock) { logs.toList() }

    // ---------------------------------------------------------- crashes ----

    public fun crash(throwable: Throwable, thread: Thread, fatal: Boolean, message: String? = null): Crash =
        crash(
            exception = throwable.javaClass.name,
            message = message ?: throwable.message,
            stackTrace = throwable.stackTraceText(),
            thread = thread.name,
            fatal = fatal,
        )

    /** A crash that is not a JVM throwable, e.g. a JavaScript error from React Native. */
    public fun crash(exception: String, message: String?, stackTrace: String, thread: String, fatal: Boolean): Crash {
        val crash = Crash(
            id = Ids.next(),
            seq = nextSeq(),
            ts = now(),
            fatal = fatal,
            exception = exception,
            message = message,
            thread = thread,
            screen = currentScreen,
            sessionId = sessionId,
            stackTrace = stackTrace,
        )
        synchronized(lock) {
            crashes.addLast(crash)
            while (crashes.size > limits.maxCrashes) crashes.removeFirst()
        }
        emit("crash", KillcamJson.encodeToString(com.krafton.killcam.core.model.CrashSummary.serializer(), crash.summary()))
        return crash
    }

    public fun crashes(): List<Crash> = synchronized(lock) { crashes.toList() }

    // --------------------------------------------------------- timeline ----

    /**
     * Appends a timeline event. Screen events also move [currentScreen].
     * Marks are recorded even while paused: a tester pressing "mark" means it.
     */
    public fun timeline(
        type: TimelineType,
        label: String,
        data: JsonObject = buildJsonObject { },
        screenshotId: String? = null,
        ts: Long = now(),
        screen: String? = null,
    ): TimelineEvent? {
        if (paused && type != TimelineType.Mark) return null
        if (type == TimelineType.Screen) currentScreen = label
        val event = TimelineEvent(
            id = Ids.next(),
            seq = nextSeq(),
            ts = ts,
            type = type,
            label = label,
            screen = screen ?: currentScreen,
            screenshotId = screenshotId,
            data = data,
        )
        synchronized(lock) {
            // Kept in time order: a frame is stamped when it was grabbed, which can be
            // earlier than events recorded while it was being encoded.
            var index = timeline.size
            while (index > 0 && timeline[index - 1].ts > event.ts) index--
            timeline.add(index, event)
            while (timeline.size > limits.maxTimeline) timeline.removeFirst()
        }
        emit("timeline", KillcamJson.encodeToString(TimelineEvent.serializer(), event))
        return event
    }

    public fun timeline(): List<TimelineEvent> = synchronized(lock) { timeline.toList() }

    // ------------------------------------------------------------ clear ----

    public fun clear(stream: String) {
        synchronized(lock) {
            when (stream) {
                "network" -> { network.clear(); bodyBytes = 0 }
                "logs" -> logs.clear()
                "crashes" -> crashes.clear()
                "timeline" -> timeline.clear()
                "all" -> {
                    network.clear(); bodyBytes = 0
                    logs.clear(); crashes.clear(); timeline.clear()
                }
                else -> throw IllegalArgumentException("Unknown stream '$stream'")
            }
        }
        emit("cleared", """{"stream":"$stream"}""")
    }

    private fun splitUrl(url: String): Triple<String, String, String> {
        val uri = runCatching { URI(url) }.getOrNull()
        if (uri?.host != null) {
            val path = (uri.rawPath?.ifEmpty { "/" } ?: "/") + (uri.rawQuery?.let { "?$it" } ?: "")
            val host = if (uri.port == -1) uri.host else "${uri.host}:${uri.port}"
            return Triple(uri.scheme ?: "", host, path)
        }
        val scheme = url.substringBefore("://", "")
        val rest = url.substringAfter("://")
        return Triple(scheme, rest.substringBefore('/'), "/" + rest.substringAfter('/', ""))
    }
}
