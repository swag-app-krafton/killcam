package com.krafton.killcam.core

import com.krafton.killcam.core.demo.FakePlatform
import com.krafton.killcam.core.demo.demoCore
import com.krafton.killcam.core.model.Flag
import com.krafton.killcam.core.model.Header
import com.krafton.killcam.core.model.MockRule
import com.krafton.killcam.core.model.NetworkCall
import com.krafton.killcam.core.model.NetworkSummary
import com.krafton.killcam.core.model.SessionBundle
import com.krafton.killcam.core.model.SessionSummary
import com.krafton.killcam.core.net.Bodies
import kotlinx.serialization.builtins.ListSerializer
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.Socket
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ServerTest {
    private lateinit var dir: File
    private lateinit var core: KillcamCore
    private var port = 0
    private val http = HttpClient.newHttpClient()

    // Away from 8090 so a running demo or dashboard mock server cannot answer for us.
    private val basePort = 19_000 + kotlin.random.Random.nextInt(0, 900)

    @Before
    fun setUp() {
        dir = Files.createTempDirectory("killcam-test").toFile()
        File(dir, "app-files/nested").mkdirs()
        File(dir, "app-files/nested/hello.txt").writeText("hi")
        File(dir, "secret.txt").writeText("outside the root")
        core = demoCore(dir, basePort)
        port = core.start()
    }

    @After
    fun tearDown() {
        core.stop()
        dir.deleteRecursively()
    }

    private fun url(path: String) = URI("http://127.0.0.1:$port$path")

    private fun get(path: String): HttpResponse<String> =
        http.send(HttpRequest.newBuilder(url(path)).GET().build(), HttpResponse.BodyHandlers.ofString())

    private fun send(method: String, path: String, body: String? = null, killcamHeader: Boolean = true): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(url(path))
            .method(method, body?.let { HttpRequest.BodyPublishers.ofString(it) } ?: HttpRequest.BodyPublishers.noBody())
            .header("Content-Type", "application/json")
        if (killcamHeader) builder.header("X-Killcam", "1")
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString())
    }

    private inline fun <reified T> HttpResponse<String>.decode(): T =
        KillcamJson.decodeFromString(kotlinx.serialization.serializer<T>(), body())

    @Test
    fun servesInfoAndDashboardFallback() {
        val info = get("/api/info")
        assertEquals(200, info.statusCode())
        assertTrue(info.body().contains("\"packageName\":\"com.swag.pay\""))
        assertEquals(200, get("/").statusCode())
        assertEquals(200, get("/some/client/route").statusCode())
        assertEquals(404, get("/api/nope").statusCode())
    }

    @Test
    fun rejectsForeignHostHeader() {
        Socket("127.0.0.1", port).use { socket ->
            socket.getOutputStream().write("GET /api/info HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n".toByteArray())
            val status = BufferedReader(InputStreamReader(socket.getInputStream())).readLine()
            assertTrue(status.contains("403"), status)
        }
    }

    @Test
    fun writesNeedKillcamHeader() {
        assertEquals(403, send("POST", "/api/timeline/mark", """{"label":"x"}""", killcamHeader = false).statusCode())
        assertEquals(200, send("POST", "/api/timeline/mark", """{"label":"bug here"}""").statusCode())
    }

    @Test
    fun networkLifecycleAndCurl() {
        val body = """{"payee":"priya@okaxis","amountPaise":100}"""
        val id = core.store.beginCall(
            "post", "https://api.swag.gg/v1/upi/pay?x=1", listOf(Header("Content-Type", "application/json")),
            Bodies.decode(body.toByteArray(), body.length.toLong(), false, "application/json"), body.length.toLong(), "okhttp",
        )!!
        core.store.completeCall(id, 201, "Created", "h2", emptyList(), "application/json; charset=utf-8", 2)
        core.store.completeBody(id, Bodies.decode("{}".toByteArray(), 2, false, "application/json"))

        val list = get("/api/network").decode<List<NetworkSummary>>()
        val summary = list.single { it.id == id }
        assertEquals("POST", summary.method)
        assertEquals("api.swag.gg", summary.host)
        assertEquals("/v1/upi/pay?x=1", summary.path)
        assertEquals("application/json", summary.contentType)

        val call = get("/api/network/$id").decode<NetworkCall>()
        assertEquals("{}", call.responseBody?.text)
        val curl = get("/api/network/$id/curl").body()
        assertTrue(curl.contains("--data-raw '$body'"), curl)
        assertEquals(200, get("/api/network.har").statusCode())
    }

    @Test
    fun mockCrudAndMatching() {
        val created = send(
            "POST", "/api/mocks",
            """{"name":"slow home","method":"GET","urlPattern":"https://api.swag.gg/v1/*","matchType":"glob","action":"delay","status":200,"headers":[],"body":"","delayMs":1500,"failure":"timeout","enabled":true}""",
        ).decode<MockRule>()
        assertEquals(created.id, core.mocks.match("GET", "https://api.swag.gg/v1/home")?.id)
        assertEquals(null, core.mocks.match("POST", "https://api.swag.gg/v1/home")?.id?.takeIf { it == created.id })

        assertEquals(400, send("POST", "/api/mocks", """{"name":"bad","urlPattern":"(","matchType":"regex"}""").statusCode())

        val all = get("/api/mocks").decode<List<MockRule>>()
        val reordered = send("PUT", "/api/mocks", KillcamJson.encodeToString(ListSerializer(kotlinx.serialization.serializer<String>()), all.map { it.id }.reversed()))
            .decode<List<MockRule>>()
        assertEquals(all.map { it.id }.reversed(), reordered.map { it.id })

        assertEquals(204, send("DELETE", "/api/mocks/${created.id}").statusCode())
        assertEquals(404, send("DELETE", "/api/mocks/${created.id}").statusCode())
    }

    @Test
    fun flagOverridesPersistAcrossRestart() {
        val flag = send("PUT", "/api/flags", """{"key":"pay.new_pin_pad","value":"on"}""").decode<Flag>()
        assertEquals("true", flag.value)
        assertEquals(400, send("PUT", "/api/flags", """{"key":"pay.max_amount_paise","value":"lots"}""").statusCode())
        assertEquals(404, send("PUT", "/api/flags", """{"key":"nope","value":"1"}""").statusCode())

        core.stop()
        core = demoCore(dir, basePort)
        port = core.start()
        val reloaded = get("/api/flags").decode<List<Flag>>().single { it.key == "pay.new_pin_pad" }
        assertEquals("true", reloaded.override)
        assertEquals("override", reloaded.source.name.lowercase())

        assertEquals(204, send("DELETE", "/api/flags?key=pay.new_pin_pad").statusCode())
        assertEquals("false", core.flags.value("pay.new_pin_pad"))
    }

    @Test
    fun storageEndpoints() {
        assertTrue(get("/api/prefs/swag-pay-startup").body().contains("onboarding-complete"))
        assertEquals(200, send("PUT", "/api/prefs/swag-pay-startup", """{"key":"k","type":"int","value":"3"}""").statusCode())
        assertEquals(204, send("DELETE", "/api/prefs/swag-pay-startup?key=k").statusCode())

        assertTrue(get("/api/db/swag-pay.db/tables/transactions?limit=5&orderBy=amount_paise&desc=true").body().contains("\"totalRows\":137"))
        assertTrue(send("POST", "/api/db/swag-pay.db/query", """{"sql":"DROP x"}""").body().contains("syntax error"))

        assertTrue(get("/api/files?root=files&path=nested").body().contains("hello.txt"))
        assertEquals("hi", get("/api/files/content?root=files&path=nested/hello.txt").body())
        assertEquals(404, get("/api/files/content?root=files&path=../secret.txt").statusCode())
        assertEquals(404, get("/api/files/content?root=files&path=..%2F..%2Fsecret.txt").statusCode())
    }

    @Test
    fun mmkvAndRemoteConfig() {
        assertTrue(get("/api/mmkv").body().contains("swag.secure"))
        assertTrue(get("/api/mmkv/mmkv.default").body().contains("rahul@swag"))
        assertEquals(200, send("PUT", "/api/mmkv/mmkv.default", """{"key":"k","type":"long","value":"7"}""").statusCode())
        assertEquals(204, send("DELETE", "/api/mmkv/mmkv.default?key=k").statusCode())
        assertEquals(404, get("/api/mmkv/nope").statusCode())

        val info = send("POST", "/api/remote-config/fetch").decode<com.krafton.killcam.core.model.RemoteConfigInfo>()
        assertEquals("success", info.fetchStatus.name.lowercase())
        // Every key is mirrored into Flags with an inferred type, so it can be overridden there.
        val flags = get("/api/flags").decode<List<Flag>>().associateBy { it.key }
        assertEquals("boolean", flags.getValue("pay_new_pin_pad").type.name.lowercase())
        assertEquals("json", flags.getValue("home_banner_json").type.name.lowercase())
        assertEquals("remote", flags.getValue("upi_lite_limit_paise").source.name.lowercase())
        assertEquals("default", flags.getValue("support_email").source.name.lowercase())

        send("PUT", "/api/flags", """{"key":"pay_new_pin_pad","value":"false"}""")
        val after = get("/api/remote-config").decode<com.krafton.killcam.core.model.RemoteConfigInfo>()
        assertEquals("false", after.values.single { it.key == "pay_new_pin_pad" }.flagOverride)
        assertEquals("false", core.flags.value("pay_new_pin_pad"))
    }

    @Test
    fun saveExportAndCrashRecovery() {
        (core.platform as FakePlatform).let { kotlinx.coroutines.runBlocking { it.captureScreenshot("manual") } }
        val saved = send("POST", "/api/sessions", """{"label":"login loop"}""").decode<SessionSummary>()
        assertEquals("login loop", saved.label)

        val bundle = get("/api/sessions/${saved.id}").decode<SessionBundle>()
        val shot = bundle.timeline.first { it.screenshotId != null }.screenshotId
        assertEquals(200, get("/api/sessions/${saved.id}/screenshots/$shot").statusCode())

        val zip = http.send(HttpRequest.newBuilder(url("/api/sessions/live/export")).build(), HttpResponse.BodyHandlers.ofByteArray())
        val names = ZipInputStream(zip.body().inputStream()).use { z -> generateSequence { z.nextEntry?.name }.toList() }
        assertTrue("session.json" in names && "network.har" in names && names.any { it.startsWith("screenshots/") }, names.toString())

        // The process "dies": the crash session must be there on the next launch.
        val crashedId = core.sessionId
        core.onFatalCrash(Thread.currentThread(), IllegalStateException("boom"))
        core.stop()
        core = demoCore(dir, basePort)
        port = core.start()
        val sessions = get("/api/sessions").decode<List<SessionSummary>>()
        val crashed = sessions.single { it.id == crashedId }
        assertEquals("crash", crashed.reason.name.lowercase())
        assertEquals("boom", crashed.crash?.message)
        assertTrue(get("/api/crashes").body().contains(crashed.crash!!.id))
        assertTrue(get("/api/crashes/${crashed.crash!!.id}").body().contains("IllegalStateException"))
    }

    @Test
    fun liveStreamDeliversEvents() {
        val connection = url("/api/live").toURL().openConnection() as HttpURLConnection
        connection.readTimeout = 5_000
        val reader = BufferedReader(InputStreamReader(connection.inputStream))
        val lines = mutableListOf<String>()
        while (lines.none { it.startsWith("event: hello") }) lines += reader.readLine()
        core.store.timeline(com.krafton.killcam.core.model.TimelineType.Mark, "live-check")
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (System.nanoTime() < deadline && lines.none { it.contains("live-check") }) lines += reader.readLine()
        connection.disconnect()
        assertTrue(lines.any { it == "event: timeline" }, lines.toString())
        assertTrue(lines.any { it.contains("live-check") })
    }

    @Test
    fun wifiSharingRequiresPinFromLan() {
        val lan = FakePlatform.lanIpv4() ?: return // no LAN interface on this machine
        core.setWifiEnabled(true)
        val remote = HttpClient.newHttpClient()
        fun remoteGet(path: String, cookie: String? = null): HttpResponse<String> {
            val builder = HttpRequest.newBuilder(URI("http://$lan:${core.port}$path"))
            cookie?.let { builder.header("Cookie", it) }
            return remote.send(builder.build(), HttpResponse.BodyHandlers.ofString())
        }
        assertEquals(401, remoteGet("/api/info").statusCode())
        assertEquals(200, remoteGet("/").statusCode())

        val wrong = remote.send(
            HttpRequest.newBuilder(URI("http://$lan:${core.port}/api/auth"))
                .header("X-Killcam", "1").POST(HttpRequest.BodyPublishers.ofString("""{"pin":"000000x"}""")).build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        assertEquals(401, wrong.statusCode())
        val ok = remote.send(
            HttpRequest.newBuilder(URI("http://$lan:${core.port}/api/auth"))
                .header("X-Killcam", "1").POST(HttpRequest.BodyPublishers.ofString("""{"pin":"${core.access.pin}"}""")).build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        assertEquals(204, ok.statusCode())
        val cookie = ok.headers().firstValue("Set-Cookie").orElseThrow().substringBefore(';')
        assertEquals(200, remoteGet("/api/info", cookie).statusCode())
        assertNotNull(core.status(remote = false).wifiUrl)

        core.setWifiEnabled(false)
        // Back on loopback only: the LAN address no longer accepts connections.
        val portBefore = core.port
        assertTrue(runCatching { remoteGet("/api/info", cookie) }.isFailure)
        assertEquals(portBefore, core.port)
    }
}
