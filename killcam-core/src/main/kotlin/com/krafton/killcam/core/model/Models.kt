package com.krafton.killcam.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Mirrors dashboard/src/api/types.ts field for field. Change both together.
// Nullable fields are always encoded (as null), never omitted; see KillcamJson.

@Serializable
public data class Header(val name: String, val value: String)

@Serializable
public data class KeyValue(val label: String, val value: String)

// ---------------------------------------------------------------- info -----

@Serializable
public data class InfoSection(val title: String, val items: List<KeyValue>)

@Serializable
public data class AppInfo(
    val appName: String,
    val packageName: String,
    val versionName: String,
    val versionCode: Long,
    val buildType: String,
    val deviceName: String,
    val sessionId: String,
    val sessionStartMs: Long,
    val killcamVersion: String,
    val sections: List<InfoSection>,
)

@Serializable
public data class KillcamStatus(
    val capturePaused: Boolean,
    val wifiEnabled: Boolean,
    val wifiUrl: String?,
    val remote: Boolean,
    val port: Int,
)

// ------------------------------------------------------------- network -----

@Serializable
public enum class CallState {
    @SerialName("pending") Pending,
    @SerialName("complete") Complete,
    @SerialName("failed") Failed,
}

@Serializable
public data class HttpBody(
    val text: String?,
    val base64: String?,
    val size: Long,
    val truncated: Boolean,
    val contentType: String?,
)

@Serializable
public data class NetworkSummary(
    val id: String,
    val seq: Long,
    val startMs: Long,
    val durationMs: Long?,
    val method: String,
    val url: String,
    val scheme: String,
    val host: String,
    val path: String,
    val status: Int?,
    val state: CallState,
    val error: String?,
    val requestSize: Long,
    val responseSize: Long,
    val contentType: String?,
    val mockRuleId: String?,
    val source: String,
    val screen: String?,
)

@Serializable
public data class NetworkCall(
    val id: String,
    val seq: Long,
    val startMs: Long,
    val durationMs: Long?,
    val method: String,
    val url: String,
    val scheme: String,
    val host: String,
    val path: String,
    val status: Int?,
    val state: CallState,
    val error: String?,
    val requestSize: Long,
    val responseSize: Long,
    val contentType: String?,
    val mockRuleId: String?,
    val source: String,
    val screen: String?,
    val protocol: String?,
    val responseMessage: String?,
    val requestHeaders: List<Header>,
    val requestBody: HttpBody?,
    val responseHeaders: List<Header>,
    val responseBody: HttpBody?,
) {
    public fun summary(): NetworkSummary = NetworkSummary(
        id = id, seq = seq, startMs = startMs, durationMs = durationMs, method = method,
        url = url, scheme = scheme, host = host, path = path, status = status, state = state,
        error = error, requestSize = requestSize, responseSize = responseSize,
        contentType = contentType, mockRuleId = mockRuleId, source = source, screen = screen,
    )
}

// ---------------------------------------------------------------- logs -----

@Serializable
public enum class LogLevel {
    @SerialName("V") Verbose,
    @SerialName("D") Debug,
    @SerialName("I") Info,
    @SerialName("W") Warn,
    @SerialName("E") Error,
    @SerialName("A") Assert,
}

@Serializable
public enum class LogKind {
    @SerialName("log") Log,
    @SerialName("event") Event,
    @SerialName("logcat") Logcat,
}

@Serializable
public data class LogEntry(
    val id: String,
    val seq: Long,
    val ts: Long,
    val level: LogLevel,
    val tag: String,
    val message: String,
    val throwable: String?,
    val kind: LogKind,
    val attributes: Map<String, String>,
    val thread: String?,
    val screen: String?,
)

// ------------------------------------------------------------- crashes -----

@Serializable
public data class CrashSummary(
    val id: String,
    val seq: Long,
    val ts: Long,
    val fatal: Boolean,
    val exception: String,
    val message: String?,
    val thread: String,
    val screen: String?,
    val sessionId: String,
)

@Serializable
public data class Crash(
    val id: String,
    val seq: Long,
    val ts: Long,
    val fatal: Boolean,
    val exception: String,
    val message: String?,
    val thread: String,
    val screen: String?,
    val sessionId: String,
    val stackTrace: String,
) {
    public fun summary(): CrashSummary = CrashSummary(
        id = id, seq = seq, ts = ts, fatal = fatal, exception = exception, message = message,
        thread = thread, screen = screen, sessionId = sessionId,
    )
}

// ------------------------------------------------------------ timeline -----

@Serializable
public enum class TimelineType {
    @SerialName("screen") Screen,
    @SerialName("tap") Tap,
    @SerialName("lifecycle") Lifecycle,
    @SerialName("screenshot") Screenshot,
    @SerialName("mark") Mark,
    @SerialName("custom") Custom,
}

@Serializable
public data class TimelineEvent(
    val id: String,
    val seq: Long,
    val ts: Long,
    val type: TimelineType,
    val label: String,
    val screen: String?,
    val screenshotId: String?,
    val data: JsonObject,
)

// ------------------------------------------------------------ sessions -----

@Serializable
public enum class SessionReason {
    @SerialName("live") Live,
    @SerialName("crash") Crash,
    @SerialName("manual") Manual,
}

@Serializable
public data class SessionSummary(
    val id: String,
    val label: String?,
    val startMs: Long,
    val endMs: Long?,
    val live: Boolean,
    val reason: SessionReason,
    val crash: CrashSummary?,
    val appVersion: String,
    val screenshotCount: Int,
    val eventCount: Int,
)

@Serializable
public data class SessionBundle(
    val session: SessionSummary,
    val app: AppInfo,
    val network: List<NetworkCall>,
    val logs: List<LogEntry>,
    val crashes: List<Crash>,
    val timeline: List<TimelineEvent>,
)

// --------------------------------------------------------------- mocks -----

@Serializable
public enum class MatchType {
    @SerialName("contains") Contains,
    @SerialName("exact") Exact,
    @SerialName("glob") Glob,
    @SerialName("regex") Regex,
}

@Serializable
public enum class MockAction {
    @SerialName("respond") Respond,
    @SerialName("delay") Delay,
    @SerialName("fail") Fail,
    /** Pause the call for a tester to inspect, edit, continue or fail it; see [BreakOn]. */
    @SerialName("breakpoint") Breakpoint,
}

@Serializable
public enum class BreakOn {
    @SerialName("request") Request,
    @SerialName("response") Response,
    @SerialName("both") Both,
}

@Serializable
public enum class MockFailure {
    /** Read timeout: `SocketTimeoutException: timeout`. */
    @SerialName("timeout") Timeout,
    @SerialName("no_network") NoNetwork,
    @SerialName("connection_reset") ConnectionReset,
    /** `UnknownHostException` worded as Android words a failed lookup. */
    @SerialName("dns_failure") DnsFailure,
    /** `ConnectException`: nothing listening, server down. */
    @SerialName("connection_refused") ConnectionRefused,
    /** `SocketTimeoutException` while connecting: unreachable host, captive portal. */
    @SerialName("connect_timeout") ConnectTimeout,
    /** `SSLHandshakeException`: pinning or TLS failure. */
    @SerialName("ssl_handshake") SslHandshake,
    /**
     * The real call goes out and its headers arrive, then the body aborts after
     * [MockRule.dropAfterBytes] with `SocketException: Software caused connection
     * abort`, as when the phone switches between Wi-Fi and mobile data.
     */
    @SerialName("network_switch") NetworkSwitch,
    /** `IOException: unexpected end of stream`: the server closed a reused connection. */
    @SerialName("unexpected_eof") UnexpectedEof,
}

@Serializable
public data class MockRule(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val method: String?,
    val urlPattern: String,
    val matchType: MatchType,
    val action: MockAction,
    val status: Int,
    val headers: List<Header>,
    val body: String,
    val delayMs: Long,
    val failure: MockFailure,
    val hits: Long,
    val createdMs: Long,
    /** network_switch: body bytes delivered before the connection drops. */
    val dropAfterBytes: Long = 0,
    /** Applies to the first [times] matches only, then lets calls through; 0 means always. */
    val times: Int = 0,
    /** Percent (1..100) of matching calls the rule applies to; the rest fall through to later rules. */
    val probability: Int = 100,
    /** Key of the catalog endpoint the rule was made for; the match was copied from it. */
    val endpoint: String? = null,
    /** breakpoint: where the call pauses. */
    val breakOn: BreakOn = BreakOn.Request,
) {
    /** True once a rule limited by [times] has been used up. */
    public val exhausted: Boolean get() = times > 0 && hits >= times
}

@Serializable
public data class MockRuleInput(
    val name: String,
    val enabled: Boolean = true,
    val method: String? = null,
    val urlPattern: String,
    val matchType: MatchType = MatchType.Contains,
    val action: MockAction = MockAction.Respond,
    val status: Int = 200,
    val headers: List<Header> = emptyList(),
    val body: String = "",
    val delayMs: Long = 0,
    val failure: MockFailure = MockFailure.Timeout,
    val dropAfterBytes: Long = 0,
    val times: Int = 0,
    val probability: Int = 100,
    /** A catalog endpoint key. When set, its method (unless [method] is given), pattern and match type are used. */
    val endpoint: String? = null,
    val breakOn: BreakOn = BreakOn.Request,
)

// -------------------------------------------------- network conditions -----

@Serializable
public enum class NetworkProfile {
    @SerialName("off") Off,
    @SerialName("gprs") Gprs,
    @SerialName("2g") Edge,
    @SerialName("slow_3g") Slow3g,
    @SerialName("fast_3g") Fast3g,
    @SerialName("4g") Lte,
    @SerialName("flaky_wifi") FlakyWifi,
    @SerialName("offline") Offline,
    @SerialName("custom") Custom,
}

/**
 * Throttling and loss applied to every call through KillcamInterceptor,
 * mocked or not. Rates are kilobits per second; 0 means unlimited.
 */
@Serializable
public data class NetworkConditions(
    val profile: NetworkProfile = NetworkProfile.Off,
    val latencyMs: Long = 0,
    val jitterMs: Long = 0,
    val downloadKbps: Long = 0,
    val uploadKbps: Long = 0,
    /** Percent (0..100) of calls that fail as a lost connection. */
    val lossPercent: Int = 0,
    /** Every call fails DNS resolution, as with no connectivity at all. */
    val offline: Boolean = false,
) {
    public val active: Boolean
        get() = offline || latencyMs > 0 || jitterMs > 0 || downloadKbps > 0 || uploadKbps > 0 || lossPercent > 0
}

/**
 * What PUT /api/network-conditions accepts. A preset [profile] (anything but
 * custom) selects that preset and ignores the other fields; otherwise the
 * fields describe custom conditions and missing ones are 0.
 */
@Serializable
public data class NetworkConditionsInput(
    val profile: NetworkProfile? = null,
    val latencyMs: Long = 0,
    val jitterMs: Long = 0,
    val downloadKbps: Long = 0,
    val uploadKbps: Long = 0,
    val lossPercent: Int = 0,
    val offline: Boolean = false,
)

@Serializable
public data class NetworkPreset(
    val profile: NetworkProfile,
    val label: String,
    val description: String,
    val conditions: NetworkConditions,
)

// ------------------------------------------------------------ endpoints -----

@Serializable
public enum class EndpointSource {
    /** The catalog file checked into the app's repo (a debug asset). */
    @SerialName("repo") Repo,
    /** `Killcam.registerEndpoint` in app code. */
    @SerialName("code") Code,
    /** Added or edited from the dashboard, stored on the device. */
    @SerialName("dashboard") Dashboard,
}

/** A named API of the app ("/page/fetch") that rules and tools can target. */
@Serializable
public data class Endpoint(
    val key: String,
    val name: String?,
    val method: String?,
    val urlPattern: String,
    val matchType: MatchType,
    /** Top-level group: given, or the key's first path segment. */
    val group: String,
    val description: String?,
    val source: EndpointSource,
    /** Differs from the repo catalog: include it in the next export. */
    val unexported: Boolean,
)

/** One entry of the catalog file, and what POST/PUT /api/endpoints accept. */
@Serializable
public data class EndpointInput(
    val key: String,
    val name: String? = null,
    val method: String? = null,
    /** Defaults to [key]. */
    val urlPattern: String? = null,
    val matchType: MatchType = MatchType.Contains,
    val group: String? = null,
    val description: String? = null,
)

/** The `killcam-endpoints.json` file format. */
@Serializable
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
public data class EndpointCatalog(
    @kotlinx.serialization.EncodeDefault val version: Int = 1,
    val endpoints: List<EndpointInput>,
)

// --------------------------------------------------------------- repeat -----

/** Changes applied to a request before it is sent (repeat) or continued (breakpoint). Null keeps the original. */
@Serializable
public data class RequestEdit(
    val method: String? = null,
    val url: String? = null,
    val headers: List<Header>? = null,
    val body: String? = null,
)

@Serializable
public data class RepeatRequest(
    /** 1..50. */
    val count: Int = 1,
    /** All at once (races, double-submit) rather than one after another. */
    val concurrent: Boolean = false,
    val edit: RequestEdit? = null,
)

@Serializable
public data class RepeatResult(val started: Int)

// ---------------------------------------------------------- breakpoints -----

@Serializable
public enum class BreakStage {
    @SerialName("request") Request,
    @SerialName("response") Response,
}

/** A call held at a breakpoint, waiting for a tester. */
@Serializable
public data class PausedCall(
    val id: String,
    /** The Network call id, when capture is on. */
    val callId: String?,
    val ruleId: String,
    val ruleName: String,
    val stage: BreakStage,
    val pausedMs: Long,
    /** When it continues unchanged by itself. */
    val deadlineMs: Long,
    val method: String,
    val url: String,
    val requestHeaders: List<Header>,
    val requestBody: String?,
    /** False for one-shot, binary or oversized bodies. */
    val requestBodyEditable: Boolean,
    val status: Int?,
    val responseHeaders: List<Header>,
    val responseBody: String?,
    val responseBodyEditable: Boolean,
)

@Serializable
public enum class ResumeAction {
    @SerialName("continue") Continue,
    @SerialName("fail") Fail,
}

/**
 * POST /api/breakpoints/{id}. For continue, null fields keep the original;
 * [headers] and [body] are the request's at the request stage and the
 * response's at the response stage; [method] and [url] apply to requests,
 * [status] to responses.
 */
@Serializable
public data class ResumeRequest(
    val action: ResumeAction = ResumeAction.Continue,
    val failure: MockFailure = MockFailure.ConnectionReset,
    val method: String? = null,
    val url: String? = null,
    val status: Int? = null,
    val headers: List<Header>? = null,
    val body: String? = null,
)

// --------------------------------------------------------------- flags -----

@Serializable
public enum class FlagType {
    @SerialName("boolean") Boolean,
    @SerialName("string") String,
    @SerialName("int") Int,
    @SerialName("double") Double,
    @SerialName("json") Json,
}

@Serializable
public enum class FlagSource {
    @SerialName("default") Default,
    @SerialName("remote") Remote,
    @SerialName("override") Override,
}

@Serializable
public data class Flag(
    val key: String,
    val type: FlagType,
    val description: String?,
    val group: String?,
    val defaultValue: String,
    val remoteValue: String?,
    val override: String?,
    val value: String,
    val source: FlagSource,
    val options: List<String>?,
)

// ------------------------------------------------------------- storage -----

@Serializable
public data class PrefFile(val name: String, val entryCount: Int, val sizeBytes: Long)

@Serializable
public enum class PrefType {
    @SerialName("string") String,
    @SerialName("boolean") Boolean,
    @SerialName("int") Int,
    @SerialName("long") Long,
    @SerialName("float") Float,
    @SerialName("string_set") StringSet,
}

@Serializable
public data class PrefEntry(val key: String, val type: PrefType, val value: String)

@Serializable
public data class DbTable(val name: String, val type: String, val rowCount: Long?)

@Serializable
public data class DbInfo(
    val name: String,
    val path: String,
    val sizeBytes: Long,
    val tables: List<DbTable>,
)

@Serializable
public data class QueryResult(
    val columns: List<String>,
    val rows: List<List<JsonPrimitive>>,
    val totalRows: Long?,
    val affectedRows: Long?,
    val truncated: Boolean,
    val elapsedMs: Long,
    val error: String?,
) {
    public companion object {
        public fun failure(error: String, elapsedMs: Long = 0): QueryResult = QueryResult(
            columns = emptyList(), rows = emptyList(), totalRows = null, affectedRows = null,
            truncated = false, elapsedMs = elapsedMs, error = error,
        )
    }
}

@Serializable
public data class FileRoot(val id: String, val label: String, val path: String)

@Serializable
public data class FileEntry(
    val name: String,
    val path: String,
    val dir: Boolean,
    val size: Long,
    val modifiedMs: Long,
)

// ---------------------------------------------------------------- mmkv -----

@Serializable
public enum class MmkvValueType {
    @SerialName("string") String,
    @SerialName("bool") Bool,
    @SerialName("int") Int,
    @SerialName("long") Long,
    @SerialName("float") Float,
    @SerialName("double") Double,
    @SerialName("bytes") Bytes,
}

@Serializable
public data class MmkvInstance(
    val id: String,
    val keyCount: Int,
    val sizeBytes: Long,
    val encrypted: Boolean,
    val error: String?,
)

@Serializable
public data class MmkvEntry(val key: String, val type: MmkvValueType, val value: String, val sizeBytes: Long)

@Serializable
public data class MmkvUpdate(val key: String, val type: MmkvValueType, val value: String)

// ------------------------------------------------------- remote config -----

@Serializable
public enum class RemoteConfigSource {
    @SerialName("remote") Remote,
    @SerialName("default") Default,
    @SerialName("static") Static,
}

@Serializable
public enum class RemoteConfigFetchStatus {
    @SerialName("success") Success,
    @SerialName("failure") Failure,
    @SerialName("throttled") Throttled,
    @SerialName("no_fetch_yet") NoFetchYet,
}

@Serializable
public data class RemoteConfigValue(
    val key: String,
    val value: String,
    val source: RemoteConfigSource,
    val flagOverride: String?,
)

@Serializable
public data class RemoteConfigInfo(
    val fetchStatus: RemoteConfigFetchStatus,
    val lastFetchMs: Long?,
    val minimumFetchIntervalSeconds: Long,
    val fetchTimeoutSeconds: Long,
    val values: List<RemoteConfigValue>,
)

// ------------------------------------------------------------- actions -----

@Serializable
public data class ActionInfo(
    val id: String,
    val label: String,
    val description: String?,
    val group: String?,
)

@Serializable
public data class ActionResult(val ok: Boolean, val message: String?)

// ------------------------------------------------------------ requests -----

@Serializable
public data class PinRequest(val pin: String)

@Serializable
public data class CaptureRequest(val paused: Boolean)

@Serializable
public data class LabelRequest(val label: String? = null)

@Serializable
public data class FlagUpdate(val key: String, val value: String)

@Serializable
public data class SqlRequest(val sql: String)

@Serializable
public data class DeepLinkRequest(val uri: String)

@Serializable
public data class ApiError(val error: String)
