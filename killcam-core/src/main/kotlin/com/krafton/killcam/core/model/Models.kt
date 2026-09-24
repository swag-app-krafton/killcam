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
}

@Serializable
public enum class MockFailure {
    @SerialName("timeout") Timeout,
    @SerialName("no_network") NoNetwork,
    @SerialName("connection_reset") ConnectionReset,
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
)

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
