package com.krafton.killcam.core.demo

import com.krafton.killcam.core.KillcamCore
import com.krafton.killcam.core.model.ActionResult
import com.krafton.killcam.core.model.DbInfo
import com.krafton.killcam.core.model.DbTable
import com.krafton.killcam.core.model.FileRoot
import com.krafton.killcam.core.model.InfoSection
import com.krafton.killcam.core.model.KeyValue
import com.krafton.killcam.core.model.MmkvEntry
import com.krafton.killcam.core.model.MmkvInstance
import com.krafton.killcam.core.model.MmkvUpdate
import com.krafton.killcam.core.model.MmkvValueType
import com.krafton.killcam.core.model.RemoteConfigFetchStatus
import com.krafton.killcam.core.model.RemoteConfigInfo
import com.krafton.killcam.core.model.RemoteConfigSource
import com.krafton.killcam.core.model.RemoteConfigValue
import com.krafton.killcam.core.model.PrefEntry
import com.krafton.killcam.core.model.PrefFile
import com.krafton.killcam.core.model.PrefType
import com.krafton.killcam.core.model.QueryResult
import com.krafton.killcam.core.model.TimelineEvent
import com.krafton.killcam.core.platform.ActionRegistry
import com.krafton.killcam.core.platform.DatabaseProvider
import com.krafton.killcam.core.platform.DirectoryFilesProvider
import com.krafton.killcam.core.platform.FilesProvider
import com.krafton.killcam.core.platform.KillcamPlatform
import com.krafton.killcam.core.platform.MmkvProvider
import com.krafton.killcam.core.platform.RemoteConfigProvider
import com.krafton.killcam.core.platform.PrefsProvider
import kotlinx.serialization.json.JsonPrimitive
import java.awt.Color
import java.awt.Font
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import javax.imageio.ImageIO

/** A desktop stand-in for the Android platform: in-memory prefs, a canned database, real temp-dir files. */
class FakePlatform(private val filesRoot: File) : KillcamPlatform {
    lateinit var core: KillcamCore

    override val appName = "Swag Pay"
    override val packageName = "com.swag.pay"
    override val versionName = "1.0.0"
    override val versionCode = 1L
    override val buildType = "debug"
    override val deviceName = "Desktop demo · JVM ${System.getProperty("java.version")}"

    val deepLinks = mutableListOf<String>()

    override fun infoSections() = listOf(
        InfoSection(
            "Device",
            listOf(
                KeyValue("Model", "Killcam desktop demo"),
                KeyValue("OS", "${System.getProperty("os.name")} ${System.getProperty("os.version")}"),
                KeyValue("Locale", java.util.Locale.getDefault().toLanguageTag()),
            ),
        ),
        InfoSection(
            "Runtime",
            listOf(
                KeyValue("Heap used", "${(Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) / 1_048_576} MB"),
                KeyValue("Processors", Runtime.getRuntime().availableProcessors().toString()),
            ),
        ),
    )

    override val prefs: PrefsProvider = InMemoryPrefs()
    override val databases: DatabaseProvider = CannedDatabase()
    override val files: FilesProvider = DirectoryFilesProvider(
        listOf(FileRoot("files", "Files", filesRoot.absolutePath) to filesRoot),
    )

    override val mmkv: MmkvProvider = FakeMmkv()
    override val remoteConfig: RemoteConfigProvider = FakeRemoteConfig()

    override suspend fun captureScreenshot(trigger: String): TimelineEvent? {
        val screen = core.store.currentScreen ?: "Home"
        return core.recordScreenshot(renderScreen(screen), 360, 780, trigger)
    }

    override suspend fun runAction(action: ActionRegistry.Registered): ActionResult =
        core.actions.invoke(action.info.id)

    override suspend fun openDeepLink(uri: String): ActionResult {
        deepLinks += uri
        return ActionResult(true, "Opened $uri")
    }

    override fun lanAddress(): String? = lanIpv4()

    companion object {
        fun lanIpv4(): String? = NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
            ?.hostAddress

        private val palette = mapOf(
            "Home" to Color(0x1D, 0x1B, 0x2E),
            "Scan" to Color(0x10, 0x10, 0x10),
            "PayFlow.EnterAmount" to Color(0x14, 0x24, 0x1C),
            "PayFlow.Pin" to Color(0x24, 0x14, 0x14),
            "TransactionDetail" to Color(0x14, 0x1E, 0x2C),
        )

        /** A phone-sized JPEG with the screen name drawn on it, standing in for a PixelCopy frame. */
        fun renderScreen(screen: String): ByteArray {
            System.setProperty("java.awt.headless", "true")
            val image = BufferedImage(360, 780, BufferedImage.TYPE_INT_RGB)
            val g = image.createGraphics()
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
            g.color = palette[screen] ?: Color(0x1A, 0x1A, 0x1A)
            g.fillRect(0, 0, 360, 780)
            g.color = Color(0xF2, 0xA9, 0x00)
            g.fillRect(0, 0, 360, 64)
            g.color = Color.BLACK
            g.font = Font(Font.SANS_SERIF, Font.BOLD, 20)
            g.drawString("Swag Pay", 20, 40)
            g.color = Color.WHITE
            g.font = Font(Font.SANS_SERIF, Font.BOLD, 26)
            g.drawString(screen, 20, 140)
            g.font = Font(Font.SANS_SERIF, Font.PLAIN, 14)
            g.drawString(java.time.LocalTime.now().withNano(0).toString(), 20, 170)
            g.color = Color(255, 255, 255, 40)
            for (i in 0 until 5) g.fillRoundRect(20, 220 + i * 90, 320, 70, 18, 18)
            g.dispose()
            val out = ByteArrayOutputStream()
            ImageIO.write(image, "jpg", out)
            return out.toByteArray()
        }
    }
}

class InMemoryPrefs : PrefsProvider {
    private val files = linkedMapOf(
        "swag-pay-startup" to linkedMapOf(
            "onboarding-complete" to PrefEntry("onboarding-complete", PrefType.Boolean, "true"),
            "session-expired" to PrefEntry("session-expired", PrefType.Boolean, "false"),
        ),
        "swag-pay-user" to linkedMapOf(
            "vpa" to PrefEntry("vpa", PrefType.String, "rahul@swag"),
            "last-login-ms" to PrefEntry("last-login-ms", PrefType.Long, "1727160000000"),
            "recent-payees" to PrefEntry("recent-payees", PrefType.StringSet, """["priya@okaxis","chaiwala@paytm"]"""),
        ),
    )

    override fun files() = synchronized(this) {
        files.map { (name, entries) -> PrefFile(name, entries.size, entries.values.sumOf { it.value.length.toLong() }) }
    }

    override fun entries(file: String) = synchronized(this) { files[file]?.values?.toList() }

    override fun put(file: String, entry: PrefEntry) = synchronized(this) {
        files.getOrPut(file) { linkedMapOf() }[entry.key] = entry
        entry
    }

    override fun remove(file: String, key: String) = synchronized(this) { files[file]?.remove(key) != null }
}

class CannedDatabase : DatabaseProvider {
    private val columns = listOf("id", "payee_vpa", "amount_paise", "status", "created_at")
    private val rows = (1..137).map { i ->
        listOf(
            JsonPrimitive(i),
            JsonPrimitive(listOf("priya@okaxis", "chaiwala@paytm", "rent@ybl", "swiggy@icici")[i % 4]),
            JsonPrimitive((i * 7919) % 250_000),
            JsonPrimitive(if (i % 11 == 0) "FAILED" else "SUCCESS"),
            JsonPrimitive(1_727_000_000_000L + i * 3_600_000L),
        )
    }

    override fun databases() = listOf(
        DbInfo(
            name = "swag-pay.db",
            path = "/data/data/com.swag.pay/databases/swag-pay.db",
            sizeBytes = 98_304,
            tables = listOf(DbTable("transactions", "table", rows.size.toLong()), DbTable("recent_payees", "view", 4)),
        ),
    )

    override fun browse(database: String, table: String, offset: Int, limit: Int, orderBy: String?, descending: Boolean): QueryResult {
        if (table != "transactions") return QueryResult.failure("no such table: $table")
        var sorted = rows
        val index = orderBy?.let { columns.indexOf(it) } ?: -1
        if (index >= 0) {
            val ascending = compareBy<List<JsonPrimitive>>({ it[index].content.toLongOrNull() ?: 0L }, { it[index].content })
            sorted = rows.sortedWith(if (descending) ascending.reversed() else ascending)
        }
        val page = sorted.drop(offset).take(limit)
        return QueryResult(columns, page, rows.size.toLong(), null, false, 1, null)
    }

    override fun query(database: String, sql: String): QueryResult {
        val trimmed = sql.trim().lowercase()
        return when {
            trimmed.startsWith("select") -> QueryResult(columns, rows.take(20), null, null, rows.size > 20, 2, null)
            trimmed.startsWith("delete") || trimmed.startsWith("update") ->
                QueryResult(emptyList(), emptyList(), null, 1, false, 1, null)
            else -> QueryResult.failure("near \"${sql.trim().substringBefore(' ')}\": syntax error")
        }
    }
}

class FakeMmkv : MmkvProvider {
    private val stores = linkedMapOf(
        "mmkv.default" to linkedMapOf(
            "onboarding.done" to MmkvEntry("onboarding.done", MmkvValueType.Bool, "true", 1),
            "user.vpa" to MmkvEntry("user.vpa", MmkvValueType.String, "rahul@swag", 11),
            "balance.cachedPaise" to MmkvEntry("balance.cachedPaise", MmkvValueType.Double, "1245000.0", 8),
        ),
    )

    override fun instances() = synchronized(this) {
        stores.map { (id, entries) -> MmkvInstance(id, entries.size, entries.values.sumOf { it.sizeBytes }, false, null) } +
            MmkvInstance("swag.secure", 0, 4096, true, "Registered without a crypt key")
    }

    override fun entries(id: String) = synchronized(this) { stores[id]?.values?.toList() }

    override fun put(id: String, update: MmkvUpdate) = synchronized(this) {
        val store = stores[id] ?: throw com.krafton.killcam.core.ApiException(404, "No MMKV instance '$id'")
        MmkvEntry(update.key, update.type, update.value, update.value.length.toLong()).also { store[update.key] = it }
    }

    override fun remove(id: String, key: String) = synchronized(this) { stores[id]?.remove(key) != null }
}

class FakeRemoteConfig : RemoteConfigProvider {
    private var lastFetch: Long? = null
    private val values = listOf(
        RemoteConfigValue("pay_new_pin_pad", "true", RemoteConfigSource.Remote, null),
        RemoteConfigValue("upi_lite_limit_paise", "50000", RemoteConfigSource.Remote, null),
        RemoteConfigValue("home_banner_json", """{"title":"5% cashback","cta":"Pay now"}""", RemoteConfigSource.Remote, null),
        RemoteConfigValue("support_email", "help@swag.gg", RemoteConfigSource.Default, null),
        RemoteConfigValue("psp_timeout_s", "12.5", RemoteConfigSource.Static, null),
    )

    override fun snapshot() = RemoteConfigInfo(
        fetchStatus = if (lastFetch == null) RemoteConfigFetchStatus.NoFetchYet else RemoteConfigFetchStatus.Success,
        lastFetchMs = lastFetch,
        minimumFetchIntervalSeconds = 3600,
        fetchTimeoutSeconds = 60,
        values = values,
    )

    override fun fetchAndActivate(): RemoteConfigInfo {
        lastFetch = System.currentTimeMillis()
        return snapshot()
    }
}
