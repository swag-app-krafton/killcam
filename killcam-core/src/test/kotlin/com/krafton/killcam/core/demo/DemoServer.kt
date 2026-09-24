package com.krafton.killcam.core.demo

import com.krafton.killcam.core.CoreConfig
import com.krafton.killcam.core.KillcamCore
import com.krafton.killcam.core.model.FlagType
import com.krafton.killcam.core.model.Header
import com.krafton.killcam.core.model.LogKind
import com.krafton.killcam.core.model.LogLevel
import com.krafton.killcam.core.model.MatchType
import com.krafton.killcam.core.model.MockAction
import com.krafton.killcam.core.model.MockRuleInput
import com.krafton.killcam.core.model.TimelineType
import com.krafton.killcam.core.net.Bodies
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import kotlin.random.Random

/**
 * Runs the real Killcam server on the desktop, fed by a simulated Swag Pay
 * session, so the dashboard can be built and demoed without a phone:
 *
 *     ./gradlew :killcam-core:demo        # then open http://localhost:8090
 *     KILLCAM_PORT=18090 ./gradlew :killcam-core:demo
 */
fun main() {
    val dataDir = File("build/demo-data").apply { mkdirs() }
    File(dataDir, "app-files/receipts").mkdirs()
    File(dataDir, "app-files/receipts/txn_8Q2K.json").writeText("""{"txnId":"8Q2K","amountPaise":24900,"status":"SUCCESS"}""")
    File(dataDir, "app-files/config.txt").writeText("env=staging\nfeature_set=v2\n")

    seedPreviousCrash(dataDir)

    val core = demoCore(dataDir, port = System.getenv("KILLCAM_PORT")?.toIntOrNull() ?: 8090)
    val port = core.start()
    println("Killcam demo on http://localhost:$port  (session ${core.sessionId})")
    println("Wi-Fi sharing PIN: set via the in-app window on a phone; here, POST /api/... from loopback needs no PIN.")

    val simulator = SwagPaySimulator(core)
    Runtime.getRuntime().addShutdownHook(Thread { core.stop() })
    simulator.run(forever = true)
}

fun demoCore(dataDir: File, port: Int = 8090, clock: () -> Long = System::currentTimeMillis): KillcamCore {
    val platform = FakePlatform(File(dataDir, "app-files"))
    val core = KillcamCore(platform, CoreConfig(dataDir = File(dataDir, "killcam"), port = port), clock = clock)
    platform.core = core
    core.extras["Environment"] = "staging"
    core.extras["User"] = "rahul@swag (KYC: full)"

    core.flags.register("pay.new_pin_pad", FlagType.Boolean, "false", "Redesigned UPI PIN pad", "Payments")
    core.flags.register("pay.max_amount_paise", FlagType.Int, "10000000", "Per-transaction cap", "Payments")
    core.flags.register("home.banner_variant", FlagType.String, "control", "Home hero banner experiment", "Home",
        options = listOf("control", "cashback", "rewards"))
    core.flags.register("scan.decode_timeout_s", FlagType.Double, "2.5", "QR decode timeout", "Scan")
    core.flags.register("offers.config", FlagType.Json, """{"maxCards":6,"showExpired":false}""", "Offers carousel config", "Offers")
    core.flags.setRemote("home.banner_variant", "cashback")

    core.actions.register("Expire session", "Marks the local session expired; next launch shows login", "Session") {
        "Session expired"
    }
    core.actions.register("Reset onboarding", "Clears onboarding-complete", "Session") { "Onboarding reset" }
    core.actions.register("Trigger test crash", "Throws on the main thread", "Debug") {
        throw IllegalStateException("Test crash requested from Killcam")
    }

    if (core.mocks.list().isEmpty()) {
        core.mocks.create(
            MockRuleInput(
                name = "Pay → insufficient funds",
                enabled = false,
                method = "POST",
                urlPattern = "/v1/upi/pay",
                matchType = MatchType.Contains,
                action = MockAction.Respond,
                status = 402,
                headers = listOf(Header("Content-Type", "application/json")),
                body = """{"error":"INSUFFICIENT_FUNDS","message":"Your bank declined this payment"}""",
            ),
        )
    }
    return core
}

/** Creates a saved crash session, as if the previous launch had died on the PIN screen. */
private fun seedPreviousCrash(dataDir: File) {
    val sessions = File(dataDir, "killcam/sessions")
    if (sessions.listFiles().orEmpty().any { File(it, "summary.json").isFile }) return
    // A simulated clock spreads the session over a few minutes, as a real one would be.
    val now = java.util.concurrent.atomic.AtomicLong(System.currentTimeMillis() - 5 * 60_000)
    val core = demoCore(dataDir, clock = now::get)
    // 11 steps end on PayFlow.Pin, where the stack trace below says it died.
    SwagPaySimulator(core) { now.addAndGet(it) }.run(forever = false, steps = 11)
    core.onFatalCrash(
        Thread.currentThread(),
        IllegalStateException("VPA handle missing for payee").apply {
            stackTrace = arrayOf(
                StackTraceElement("com.swag.pay.pay.PayFlow", "confirm", "PayFlow.kt", 142),
                StackTraceElement("com.swag.pay.pay.PayFlowScreen\$PinStep", "onSubmit", "PayFlowScreen.kt", 311),
                StackTraceElement("androidx.compose.foundation.ClickableNode", "onClick", "Clickable.kt", 987),
                StackTraceElement("android.os.Handler", "dispatchMessage", "Handler.java", 102),
            )
        },
    )
}

/** Plays a plausible Swag Pay session: screens, taps, UPI calls, logs and frames. */
class SwagPaySimulator(
    private val core: KillcamCore,
    /** Advances a simulated clock instead of sleeping, for seeding past sessions. */
    private val advance: ((Long) -> Unit)? = null,
) {
    private val random = Random(42)
    private val screens = listOf("Home", "Scan", "PayFlow.EnterAmount", "PayFlow.Pin", "TransactionDetail")

    fun run(forever: Boolean, steps: Int = Int.MAX_VALUE) {
        var step = 0
        while (forever || step < steps) {
            tick(step++)
            val gap = 1_500L + random.nextLong(2_000)
            if (advance != null) advance.invoke(gap) else Thread.sleep(gap)
        }
    }

    private fun tick(step: Int) {
        val screen = screens[(step / 3) % screens.size]
        if (step % 3 == 0) {
            core.store.timeline(TimelineType.Screen, screen, buildJsonObject { put("kind", "compose") })
            shot("screen")
        }
        core.store.timeline(
            TimelineType.Tap,
            "tap",
            buildJsonObject {
                put("x", JsonPrimitive(random.nextDouble(0.1, 0.9)))
                put("y", JsonPrimitive(random.nextDouble(0.15, 0.9)))
                put("target", JsonPrimitive(null as String?))
            },
        )
        when (screen) {
            "Home" -> call("GET", "https://api.swag.gg/v1/home", 200, """{"balancePaise":1245000,"banners":[{"id":"b1","variant":"cashback"}],"recent":[{"vpa":"priya@okaxis","name":"Priya"}]}""")
            "Scan" -> call("POST", "https://api.swag.gg/v1/upi/validate-vpa", 200, """{"vpa":"chaiwala@paytm","name":"Raju Tea Stall","verified":true}""",
                request = """{"vpa":"chaiwala@paytm"}""")
            "PayFlow.EnterAmount" -> call("GET", "https://api.swag.gg/v1/offers?context=pay", 200, """{"offers":[{"id":"o7","title":"5% cashback on UPI Lite"}]}""")
            "PayFlow.Pin" -> {
                val fail = step % 4 == 0
                call("POST", "https://api.swag.gg/v1/upi/pay", if (fail) 500 else 200,
                    if (fail) """{"error":"PSP_TIMEOUT","retryable":true}""" else """{"txnId":"8Q2K${step}","status":"SUCCESS","amountPaise":24900}""",
                    request = """{"payee":"chaiwala@paytm","amountPaise":24900,"note":"chai"}""")
                core.store.log(LogLevel.Info, "Analytics", "payment_initiated", kind = LogKind.Event,
                    attributes = mapOf("amount_paise" to "24900", "payee_type" to "merchant", "flow" to "scan"))
                if (fail) core.store.log(LogLevel.Error, "PayFlow", "Pay failed: PSP_TIMEOUT (retryable)")
            }
            else -> call("GET", "https://api.swag.gg/v1/transactions/8Q2K$step", 200, """{"txnId":"8Q2K$step","status":"SUCCESS","utr":"4271${step}9981"}""")
        }
        core.store.log(LogLevel.Debug, "AppCoordinator", "route=$screen step=$step")
        if (step % 5 == 0) core.store.log(LogLevel.Info, "ReactNativeJS", "[offers] rendered 6 cards in ${20 + step % 30}ms", kind = LogKind.Logcat)
        if (step % 2 == 1) shot("tap")
        if (step > 0 && step % 17 == 0) core.recordException(IllegalArgumentException("Amount exceeds UPI Lite limit"), "Non-fatal in PayFlow")
    }

    private fun shot(trigger: String) {
        val screen = core.store.currentScreen ?: "Home"
        core.recordScreenshot(FakePlatform.renderScreen(screen), 360, 780, trigger)
    }

    private fun call(method: String, url: String, status: Int, response: String, request: String? = null) {
        val mock = core.mocks.match(method, url)
        val requestBody = request?.let { Bodies.decode(it.toByteArray(), it.length.toLong(), false, "application/json") }
        val id = core.store.beginCall(
            method, url,
            listOf(Header("Authorization", "Bearer eyJhbGciOi…"), Header("X-Device-Id", "a1b2c3"), Header("Accept-Encoding", "gzip")),
            requestBody, request?.length?.toLong() ?: 0, "okhttp", mockRuleId = mock?.id,
        ) ?: return
        val finalStatus = mock?.status ?: status
        val body = mock?.body ?: response
        core.store.completeCall(
            id, finalStatus, if (finalStatus < 400) "OK" else "Error", "h2",
            listOf(Header("Content-Type", "application/json; charset=utf-8"), Header("X-Request-Id", "req-${random.nextInt(99999)}")),
            "application/json", body.length.toLong(),
        )
        core.store.completeBody(id, Bodies.decode(body.toByteArray(), body.length.toLong(), false, "application/json"))
    }
}
