package com.krafton.killcam.core.server

import com.krafton.killcam.core.ApiException
import com.krafton.killcam.core.KillcamCore
import com.krafton.killcam.core.KillcamJson
import com.krafton.killcam.core.model.ApiError
import com.krafton.killcam.core.model.CaptureRequest
import com.krafton.killcam.core.model.DeepLinkRequest
import com.krafton.killcam.core.model.FlagUpdate
import com.krafton.killcam.core.model.LabelRequest
import com.krafton.killcam.core.model.MmkvUpdate
import com.krafton.killcam.core.model.MockRuleInput
import com.krafton.killcam.core.model.PinRequest
import com.krafton.killcam.core.model.PrefEntry
import com.krafton.killcam.core.model.SqlRequest
import com.krafton.killcam.core.model.TimelineType
import com.krafton.killcam.core.net.Curl
import com.krafton.killcam.core.store.LiveEvent
import com.krafton.killcam.core.store.LiveListener
import io.ktor.http.ContentDisposition
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.cio.CIO
import io.ktor.server.cio.CIOApplicationEngine
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.request.receiveText
import io.ktor.server.response.header
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondBytesWriter
import io.ktor.server.response.respondFile
import io.ktor.server.response.respondOutputStream
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.utils.io.writeStringUtf8
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.serializer
import java.net.BindException

/**
 * The on-device HTTP server: JSON API, live event stream and the dashboard.
 *
 * Binds to loopback only unless Wi-Fi sharing is on, so by default nothing on
 * the LAN can even open a socket to it. See [AccessControl] and docs/API.md.
 */
internal class KillcamServer(private val core: KillcamCore) {
    private var server: EmbeddedServer<CIOApplicationEngine, CIOApplicationEngine.Configuration>? = null

    @Volatile var port: Int = core.config.port
        private set

    /**
     * Binds to [preferredPort] if given, else the configured port, falling back
     * to the next free ones: another debuggable app with Killcam may already
     * own the port.
     */
    @Synchronized
    fun start(bindAll: Boolean, preferredPort: Int? = null): Int {
        check(server == null) { "Already started" }
        val host = if (bindAll) "0.0.0.0" else "127.0.0.1"
        var lastError: Throwable? = null
        val range = core.config.port until core.config.port + PORT_ATTEMPTS
        val candidates = (listOfNotNull(preferredPort) + range).distinct()
        for (candidate in candidates) {
            val engine = embeddedServer(CIO, port = candidate, host = host) { module() }
            try {
                engine.start(wait = false)
                server = engine
                port = candidate
                return candidate
            } catch (e: Exception) {
                if (!e.isBindFailure()) throw e
                lastError = e
                runCatching { engine.stop(0, 0) }
            }
        }
        throw IllegalStateException("No free port in ${core.config.port}..${core.config.port + PORT_ATTEMPTS - 1}", lastError)
    }

    @Synchronized
    fun stop() {
        server?.stop(gracePeriodMillis = 0, timeoutMillis = 500)
        server = null
    }

    /** Rebinds on the same port, so `adb forward` and the in-app window keep working across Wi-Fi toggles. */
    @Synchronized
    fun restart(bindAll: Boolean) {
        val current = port
        stop()
        start(bindAll, preferredPort = current)
    }

    private fun Throwable.isBindFailure(): Boolean {
        var current: Throwable? = this
        while (current != null) {
            if (current is BindException) return true
            if (current.message?.contains("Address already in use", ignoreCase = true) == true) return true
            current = current.cause
        }
        return false
    }

    // ------------------------------------------------------------------------

    private fun Application.module() {
        intercept(ApplicationCallPipeline.Plugins) {
            val rejection = guard(call)
            if (rejection != null) {
                call.respondJson(rejection.first, ApiError(rejection.second), ApiError.serializer())
                finish()
            }
        }
        routing {
            api()
            staticDashboard()
        }
    }

    /** Returns (status, error) to reject the call, or null to let it through. */
    private fun guard(call: ApplicationCall): Pair<HttpStatusCode, String>? {
        if (!AccessControl.isAllowedHost(call.request.headers[HttpHeaders.Host])) {
            return HttpStatusCode.Forbidden to "host_not_allowed"
        }
        val path = call.request.path()
        val isApi = path.startsWith("/api/")
        if (isApi && call.request.httpMethod != HttpMethod.Get && call.request.headers["X-Killcam"] != "1") {
            return HttpStatusCode.Forbidden to "missing_x_killcam_header"
        }
        if (AccessControl.isLoopback(call.request.local.remoteAddress)) return null
        if (!core.access.wifiEnabled) return HttpStatusCode.Forbidden to "wifi_sharing_off"
        // The dashboard shell must load so it can show the PIN screen.
        if (!isApi || path == "/api/auth") return null
        val token = call.request.cookies[AccessControl.COOKIE]
        return if (core.access.isAuthorized(token)) null else HttpStatusCode.Unauthorized to "pin_required"
    }

    private fun isRemote(call: ApplicationCall): Boolean = !AccessControl.isLoopback(call.request.local.remoteAddress)

    // ------------------------------------------------------------------ api --

    private fun Route.api() {
        // ---- session & status
        apiGet("/api/info") { call.respondJson(core.appInfo()) }
        apiGet("/api/status") { call.respondJson(core.status(isRemote(call))) }
        apiPost("/api/auth") {
            val request = call.receiveJson<PinRequest>()
            when (val result = core.access.authenticate(request.pin)) {
                is AccessControl.AuthResult.Granted -> {
                    call.response.header(
                        HttpHeaders.SetCookie,
                        "${AccessControl.COOKIE}=${result.token}; Path=/; HttpOnly; SameSite=Strict",
                    )
                    call.respondText("", status = HttpStatusCode.NoContent)
                }
                is AccessControl.AuthResult.Locked ->
                    throw ApiException(429, "Too many attempts; retry in ${result.retryInMs / 1000 + 1}s")
                AccessControl.AuthResult.Denied -> throw ApiException(401, "wrong_pin")
            }
        }
        apiPost("/api/capture") {
            val request = call.receiveJson<CaptureRequest>()
            call.respondJson(core.setPaused(request.paused))
        }
        apiDelete("/api/data") {
            core.store.clear(call.request.queryParameters["stream"] ?: "all")
            call.noContent()
        }
        get("/api/live") { live() }

        // ---- network
        apiGet("/api/network") { call.respondJson(core.store.networkSummaries()) }
        apiGet("/api/network.har") {
            call.attachment("killcam-${core.sessionId}.har")
            call.respondJson(core.har(core.liveBundle()), JsonObject.serializer())
        }
        apiGet("/api/network/{id}") {
            call.respondJson(core.store.networkCall(call.param("id")) ?: notFound("call"))
        }
        apiGet("/api/network/{id}/curl") {
            val networkCall = core.store.networkCall(call.param("id")) ?: notFound("call")
            call.respondText(Curl.of(networkCall), ContentType.Text.Plain)
        }

        // ---- logs & crashes
        apiGet("/api/logs") { call.respondJson(core.store.logs()) }
        apiGet("/api/crashes") { call.respondJson(withContext(Dispatchers.IO) { core.crashList() }) }
        apiGet("/api/crashes/{id}") {
            call.respondJson(withContext(Dispatchers.IO) { core.crash(call.param("id")) } ?: notFound("crash"))
        }

        // ---- timeline & screenshots
        apiGet("/api/timeline") { call.respondJson(core.store.timeline()) }
        apiPost("/api/timeline/mark") {
            val label = call.receiveJsonOrNull<LabelRequest>()?.label?.takeIf { it.isNotBlank() } ?: "Marked moment"
            val event = core.store.timeline(TimelineType.Mark, label) ?: throw ApiException(409, "capture_paused")
            // A mark is where a tester saw the bug; a frame of that exact moment is the most useful thing to keep.
            runCatching { core.platform.captureScreenshot("mark") }
            call.respondJson(event)
        }
        apiPost("/api/screenshot") {
            val event = core.platform.captureScreenshot("manual")
            if (event == null) call.noContent() else call.respondJson(event)
        }

        // ---- sessions
        apiGet("/api/sessions") { call.respondJson(withContext(Dispatchers.IO) { core.sessionList() }) }
        apiPost("/api/sessions") {
            val label = call.receiveJsonOrNull<LabelRequest>()?.label
            call.respondJson(withContext(Dispatchers.IO) { core.saveSession(label) })
        }
        apiGet("/api/sessions/{id}") {
            val bundle = withContext(Dispatchers.IO) { core.bundle(call.param("id")) } ?: notFound("session")
            call.respondJson(bundle)
        }
        apiDelete("/api/sessions/{id}") {
            if (!withContext(Dispatchers.IO) { core.deleteSession(call.param("id")) }) notFound("session")
            call.noContent()
        }
        apiGet("/api/sessions/{id}/screenshots/{shot}") {
            val id = call.param("id").let { if (it == "live") core.sessionId else it }
            val file = core.sessions.screenshot(id, call.param("shot")) ?: notFound("screenshot")
            call.response.header(HttpHeaders.CacheControl, "private, max-age=31536000, immutable")
            call.respondFile(file)
        }
        apiGet("/api/sessions/{id}/export") {
            val bundle = withContext(Dispatchers.IO) { core.bundle(call.param("id")) } ?: notFound("session")
            call.attachment("killcam-${bundle.session.id}.zip")
            call.respondOutputStream(ContentType.Application.Zip) {
                core.sessions.export(bundle, core.har(bundle), this)
            }
        }

        // ---- mocks
        apiGet("/api/mocks") { call.respondJson(core.mocks.list()) }
        apiPost("/api/mocks") { call.respondJson(core.mocks.create(call.receiveJson<MockRuleInput>())) }
        apiPut("/api/mocks/{id}") {
            call.respondJson(core.mocks.update(call.param("id"), call.receiveJson<MockRuleInput>()))
        }
        apiDelete("/api/mocks/{id}") {
            if (!core.mocks.delete(call.param("id"))) notFound("mock rule")
            call.noContent()
        }
        apiPut("/api/mocks") {
            // Reorder: body is the full list of rule ids in the new order.
            core.mocks.reorder(call.receiveJson<List<String>>())
            call.respondJson(core.mocks.list())
        }

        // ---- flags
        apiGet("/api/flags") { call.respondJson(core.flags.list()) }
        apiPut("/api/flags") {
            val update = call.receiveJson<FlagUpdate>()
            call.respondJson(core.flags.setOverride(update.key, update.value))
        }
        apiDelete("/api/flags") {
            core.flags.clearOverride(call.request.queryParameters["key"])
            call.noContent()
        }

        // ---- prefs
        apiGet("/api/prefs") { call.respondJson(io { prefs().files() }) }
        apiGet("/api/prefs/{file}") {
            call.respondJson(io { prefs().entries(call.param("file")) } ?: notFound("prefs file"))
        }
        apiPut("/api/prefs/{file}") {
            val entry = call.receiveJson<PrefEntry>()
            if (entry.key.isEmpty()) throw ApiException(400, "key is required")
            call.respondJson(io { prefs().put(call.param("file"), entry) })
        }
        apiDelete("/api/prefs/{file}") {
            val key = call.request.queryParameters["key"] ?: throw ApiException(400, "key is required")
            if (!io { prefs().remove(call.param("file"), key) }) notFound("key")
            call.noContent()
        }

        // ---- mmkv
        apiGet("/api/mmkv") { call.respondJson(io { mmkv().instances() }) }
        apiGet("/api/mmkv/{id}") {
            call.respondJson(io { mmkv().entries(call.param("id")) } ?: notFound("MMKV instance"))
        }
        apiPut("/api/mmkv/{id}") {
            val update = call.receiveJson<MmkvUpdate>()
            if (update.key.isEmpty()) throw ApiException(400, "key is required")
            call.respondJson(io { mmkv().put(call.param("id"), update) })
        }
        apiDelete("/api/mmkv/{id}") {
            val key = call.request.queryParameters["key"] ?: throw ApiException(400, "key is required")
            if (!io { mmkv().remove(call.param("id"), key) }) notFound("key")
            call.noContent()
        }

        // ---- firebase remote config
        apiGet("/api/remote-config") {
            call.respondJson(io { core.remoteConfig(fetch = false) } ?: throw ApiException(501, "remote_config_unavailable"))
        }
        apiPost("/api/remote-config/fetch") {
            call.respondJson(io { core.remoteConfig(fetch = true) } ?: throw ApiException(501, "remote_config_unavailable"))
        }

        // ---- databases
        apiGet("/api/db") { call.respondJson(io { databases().databases() }) }
        apiGet("/api/db/{name}/tables/{table}") {
            val q = call.request.queryParameters
            val result = io {
                databases().browse(
                    database = call.param("name"),
                    table = call.param("table"),
                    offset = q["offset"]?.toIntOrNull()?.coerceAtLeast(0) ?: 0,
                    limit = q["limit"]?.toIntOrNull()?.coerceIn(1, 500) ?: 50,
                    orderBy = q["orderBy"]?.takeIf { it.isNotBlank() },
                    descending = q["desc"] == "true",
                )
            }
            call.respondJson(result)
        }
        apiPost("/api/db/{name}/query") {
            val sql = call.receiveJson<SqlRequest>().sql
            call.respondJson(io { databases().query(call.param("name"), sql) })
        }

        // ---- files
        apiGet("/api/files/roots") { call.respondJson(files().roots()) }
        apiGet("/api/files") {
            val q = call.request.queryParameters
            val entries = io { files().list(q["root"] ?: "files", q["path"].orEmpty()) } ?: notFound("directory")
            call.respondJson(entries)
        }
        apiGet("/api/files/content") {
            val q = call.request.queryParameters
            val file = files().resolve(q["root"] ?: "files", q["path"].orEmpty())?.takeIf { it.isFile }
                ?: notFound("file")
            if (q["download"] == "1") call.attachment(file.name)
            call.respondFile(file)
        }
        apiDelete("/api/files") {
            val q = call.request.queryParameters
            if (!io { files().delete(q["root"] ?: "files", q["path"].orEmpty()) }) notFound("file")
            call.noContent()
        }

        // ---- actions
        apiGet("/api/actions") { call.respondJson(core.actions.list()) }
        apiPost("/api/actions/{id}") {
            val action = core.actions.get(call.param("id")) ?: notFound("action")
            call.respondJson(core.platform.runAction(action))
        }
        apiPost("/api/deeplink") {
            val uri = call.receiveJson<DeepLinkRequest>().uri.trim()
            if (uri.isEmpty()) throw ApiException(400, "uri is required")
            call.respondJson(core.platform.openDeepLink(uri))
        }

        route404()
    }

    private fun Route.route404() {
        for (method in listOf(HttpMethod.Get, HttpMethod.Post, HttpMethod.Put, HttpMethod.Delete)) {
            route("/api/{rest...}", method) {
                handle { call.respondJson(HttpStatusCode.NotFound, ApiError("no_such_endpoint"), ApiError.serializer()) }
            }
        }
    }

    private fun prefs() = core.platform.prefs ?: throw ApiException(501, "prefs_unavailable")
    private fun mmkv() = core.platform.mmkv ?: throw ApiException(501, "mmkv_unavailable")
    private fun databases() = core.platform.databases ?: throw ApiException(501, "databases_unavailable")
    private fun files() = core.platform.files ?: throw ApiException(501, "files_unavailable")

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    // ----------------------------------------------------------------- live --

    /**
     * Server-sent events. Each connection gets a bounded channel that drops the
     * oldest events if the browser falls behind: the dashboard refetches
     * snapshots on reconnect anyway, and blocking the app's threads on a slow
     * tab would change the behaviour being debugged.
     */
    private suspend fun RoutingContext.live() {
        call.response.header(HttpHeaders.CacheControl, "no-cache")
        call.response.header("X-Accel-Buffering", "no")
        call.respondBytesWriter(contentType = ContentType.Text.EventStream) {
            val channel = Channel<LiveEvent>(capacity = 512, onBufferOverflow = BufferOverflow.DROP_OLDEST)
            val listener = LiveListener { channel.trySend(it) }
            core.store.addListener(listener)
            try {
                writeStringUtf8("retry: 2000\nevent: hello\ndata: {\"sessionId\":\"${core.sessionId}\",\"seq\":${core.store.currentSeq()}}\n\n")
                flush()
                while (true) {
                    val event = withTimeoutOrNull(HEARTBEAT_MS) { channel.receive() }
                    if (event == null) {
                        writeStringUtf8(": ping\n\n")
                    } else {
                        writeStringUtf8("event: ${event.type}\ndata: ${event.json}\n\n")
                    }
                    flush()
                }
            } finally {
                core.store.removeListener(listener)
                channel.close()
            }
        }
    }

    // --------------------------------------------------------------- static --

    private fun Route.staticDashboard() {
        get("/") { serveAsset("index.html") }
        get("/{path...}") {
            val path = call.parameters.getAll("path").orEmpty().joinToString("/")
            if (path.startsWith("api/")) {
                call.respondJson(HttpStatusCode.NotFound, ApiError("no_such_endpoint"), ApiError.serializer())
                return@get
            }
            if (!serveAsset(path)) serveAsset("index.html")
        }
    }

    private suspend fun RoutingContext.serveAsset(path: String): Boolean {
        if (path.split('/').any { it == ".." || it.isEmpty() }) return false
        val bytes = javaClass.classLoader.getResourceAsStream("$WEB_ROOT/$path")?.use { it.readBytes() }
        if (bytes == null) {
            if (path == "index.html") {
                call.respondText(MISSING_DASHBOARD, ContentType.Text.Html)
                return true
            }
            return false
        }
        val cache = if (path == "index.html") "no-store" else "public, max-age=31536000, immutable"
        call.response.header(HttpHeaders.CacheControl, cache)
        call.respondBytes(bytes, contentTypeOf(path))
        return true
    }

    private fun contentTypeOf(path: String): ContentType = when (path.substringAfterLast('.').lowercase()) {
        "html" -> ContentType.Text.Html.withParameter("charset", "utf-8")
        "js", "mjs" -> ContentType.Application.JavaScript
        "css" -> ContentType.Text.CSS
        "svg" -> ContentType.Image.SVG
        "png" -> ContentType.Image.PNG
        "ico" -> ContentType("image", "x-icon")
        "json", "map" -> ContentType.Application.Json
        "woff2" -> ContentType("font", "woff2")
        "txt" -> ContentType.Text.Plain
        else -> ContentType.Application.OctetStream
    }

    // -------------------------------------------------------------- helpers --

    private fun Route.apiGet(path: String, body: suspend RoutingContext.() -> Unit) = get(path) { guarded(body) }
    private fun Route.apiPost(path: String, body: suspend RoutingContext.() -> Unit) = post(path) { guarded(body) }
    private fun Route.apiPut(path: String, body: suspend RoutingContext.() -> Unit) = put(path) { guarded(body) }
    private fun Route.apiDelete(path: String, body: suspend RoutingContext.() -> Unit) = delete(path) { guarded(body) }

    private suspend fun RoutingContext.guarded(body: suspend RoutingContext.() -> Unit) {
        try {
            body()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            call.respondJson(HttpStatusCode.fromValue(e.status), ApiError(e.message ?: "error"), ApiError.serializer())
        } catch (e: SerializationException) {
            call.respondJson(HttpStatusCode.BadRequest, ApiError("bad_json: ${e.message}"), ApiError.serializer())
        } catch (e: IllegalArgumentException) {
            call.respondJson(HttpStatusCode.BadRequest, ApiError(e.message ?: "bad_request"), ApiError.serializer())
        } catch (e: Exception) {
            call.respondJson(
                HttpStatusCode.InternalServerError,
                ApiError("${e.javaClass.simpleName}: ${e.message}"),
                ApiError.serializer(),
            )
        }
    }

    private fun notFound(what: String): Nothing = throw ApiException(404, "No such $what")

    private fun ApplicationCall.param(name: String): String =
        parameters[name] ?: throw ApiException(400, "Missing '$name'")

    private fun ApplicationCall.attachment(fileName: String) {
        response.header(
            HttpHeaders.ContentDisposition,
            ContentDisposition.Attachment.withParameter(ContentDisposition.Parameters.FileName, fileName).toString(),
        )
    }

    private suspend fun ApplicationCall.noContent() = respondText("", status = HttpStatusCode.NoContent)

    private suspend inline fun <reified T> ApplicationCall.receiveJson(): T =
        KillcamJson.decodeFromString(serializer<T>(), receiveText())

    private suspend inline fun <reified T> ApplicationCall.receiveJsonOrNull(): T? {
        val text = receiveText()
        return if (text.isBlank()) null else KillcamJson.decodeFromString(serializer<T>(), text)
    }

    private suspend inline fun <reified T> ApplicationCall.respondJson(value: T) =
        respondJson(HttpStatusCode.OK, value, serializer<T>())

    private suspend fun <T> ApplicationCall.respondJson(value: T, serializer: KSerializer<T>) =
        respondJson(HttpStatusCode.OK, value, serializer)

    private suspend fun <T> ApplicationCall.respondJson(status: HttpStatusCode, value: T, serializer: KSerializer<T>) {
        response.header(HttpHeaders.CacheControl, "no-store")
        respondText(KillcamJson.encodeToString(serializer, value), ContentType.Application.Json, status)
    }

    private companion object {
        const val PORT_ATTEMPTS = 10
        const val HEARTBEAT_MS = 15_000L
        const val WEB_ROOT = "killcam-web"

        const val MISSING_DASHBOARD = """<!doctype html><meta charset="utf-8"><title>Killcam</title>
<body style="font:14px system-ui;background:#0f1012;color:#e8e8e8;padding:32px">
<h1 style="color:#F2A900">Killcam is running</h1>
<p>The dashboard bundle is missing from this build. Run <code>npm run build</code> in <code>dashboard/</code>.</p>
<p>The API is live: <a style="color:#F2A900" href="/api/info">/api/info</a></p>"""
    }
}
