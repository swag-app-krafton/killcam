package com.krafton.killcam.internal

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.SystemClock
import com.krafton.killcam.core.KillcamCore
import com.krafton.killcam.core.model.ActionResult
import com.krafton.killcam.core.model.FileRoot
import com.krafton.killcam.core.model.InfoSection
import com.krafton.killcam.core.model.KeyValue
import com.krafton.killcam.core.model.TimelineEvent
import com.krafton.killcam.core.model.TimelineType
import com.krafton.killcam.core.platform.ActionRegistry
import com.krafton.killcam.core.platform.DatabaseProvider
import com.krafton.killcam.core.platform.DirectoryFilesProvider
import com.krafton.killcam.core.platform.FilesProvider
import com.krafton.killcam.core.platform.KillcamPlatform
import com.krafton.killcam.core.platform.MmkvProvider
import com.krafton.killcam.core.platform.RemoteConfigProvider
import com.krafton.killcam.core.platform.PrefsProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

internal class AndroidPlatform(private val app: Application, private val rt: KillcamRuntime) : KillcamPlatform {
    lateinit var core: KillcamCore

    private val packageInfo = runCatching { app.packageManager.getPackageInfo(app.packageName, 0) }.getOrNull()

    override val appName: String = app.applicationInfo.loadLabel(app.packageManager).toString()
    override val packageName: String = app.packageName
    override val versionName: String = packageInfo?.versionName ?: "?"
    override val versionCode: Long = packageInfo?.let {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.longVersionCode else @Suppress("DEPRECATION") it.versionCode.toLong()
    } ?: 0
    override val buildType: String =
        if (app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) "debug" else "release"
    override val deviceName: String =
        "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}"

    override val prefs: PrefsProvider = AndroidPrefsProvider(app)
    override val databases: DatabaseProvider = AndroidDatabaseProvider(app)
    override val files: FilesProvider = DirectoryFilesProvider(
        buildList {
            fun root(id: String, label: String, dir: File?) {
                if (dir != null) add(FileRoot(id, label, dir.absolutePath) to dir)
            }
            root("files", "Files", app.filesDir)
            root("cache", "Cache", app.cacheDir)
            root("databases", "Databases", app.getDatabasePath("x").parentFile)
            root("shared_prefs", "Shared prefs", File(app.applicationInfo.dataDir, "shared_prefs"))
            root("no_backup", "No backup", app.noBackupFilesDir)
            root("external", "External files", app.getExternalFilesDir(null))
        },
    )

    override val mmkv: MmkvProvider? = Integrations.mmkv(rt.mmkvRegistry)
    override val remoteConfig: RemoteConfigProvider? = Integrations.remoteConfig()

    override fun infoSections(): List<InfoSection> {
        val metrics = app.resources.displayMetrics
        val runtime = Runtime.getRuntime()
        val activityManager = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memory = ActivityManager.MemoryInfo().also(activityManager::getMemoryInfo)
        val date = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
        return listOf(
            InfoSection(
                "App",
                listOfNotNull(
                    KeyValue("Package", packageName),
                    KeyValue("Version", "$versionName ($versionCode)"),
                    KeyValue("Build type", buildType),
                    KeyValue("Min / target SDK", "${app.applicationInfo.minSdkVersion} / ${app.applicationInfo.targetSdkVersion}"),
                    packageInfo?.let { KeyValue("First installed", date.format(Date(it.firstInstallTime))) },
                    packageInfo?.let { KeyValue("Last updated", date.format(Date(it.lastUpdateTime))) },
                    KeyValue("Installer", installer() ?: "unknown (adb / IDE)"),
                    KeyValue("Data dir", app.applicationInfo.dataDir),
                ),
            ),
            InfoSection(
                "Device",
                listOf(
                    KeyValue("Model", "${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})"),
                    KeyValue("Android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), patch ${Build.VERSION.SECURITY_PATCH}"),
                    KeyValue("ABI", Build.SUPPORTED_ABIS.joinToString()),
                    KeyValue(
                        "Screen",
                        "${metrics.widthPixels} × ${metrics.heightPixels} px, ${metrics.densityDpi} dpi, " +
                            "${app.resources.configuration.fontScale}× font",
                    ),
                    KeyValue("Locale / time zone", "${Locale.getDefault().toLanguageTag()} · ${TimeZone.getDefault().id}"),
                    KeyValue("Battery", battery()),
                    KeyValue("Network", network()),
                    KeyValue("Emulator", if (isEmulator()) "yes" else "no"),
                ),
            ),
            InfoSection(
                "Runtime",
                listOf(
                    KeyValue("Process", "${android.os.Process.myPid()} · up ${(SystemClock.elapsedRealtime() - android.os.Process.getStartElapsedRealtime()) / 1000}s"),
                    KeyValue("Java heap", "${(runtime.totalMemory() - runtime.freeMemory()) / MB} MB used of ${runtime.maxMemory() / MB} MB"),
                    KeyValue("Native heap", "${Debug.getNativeHeapAllocatedSize() / MB} MB"),
                    KeyValue("Device memory", "${memory.availMem / MB} MB free of ${memory.totalMem / MB} MB${if (memory.lowMemory) " (LOW)" else ""}"),
                    KeyValue("Threads", Thread.activeCount().toString()),
                ),
            ),
        )
    }

    override suspend fun captureScreenshot(trigger: String): TimelineEvent? = rt.capture.captureNow(trigger)

    override suspend fun runAction(action: ActionRegistry.Registered): ActionResult = withContext(Dispatchers.Main) {
        val result = core.actions.invoke(action.info.id)
        core.store.timeline(TimelineType.Custom, "Action: ${action.info.label}")
        result
    }

    override suspend fun openDeepLink(uri: String): ActionResult = withContext(Dispatchers.Main) {
        val parsed = Uri.parse(uri)
        // Deep links are resolved inside this app only: this is a test hook, not a general launcher.
        val intent = Intent(Intent.ACTION_VIEW, parsed).setPackage(app.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (app.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).isEmpty()) {
            return@withContext ActionResult(false, "No activity in ${app.packageName} handles $uri")
        }
        runCatching { app.startActivity(intent) }
            .map {
                core.store.timeline(TimelineType.Custom, "Deep link: $uri")
                ActionResult(true, "Opened $uri")
            }
            .getOrElse { ActionResult(false, "${it.javaClass.simpleName}: ${it.message}") }
    }

    override fun lanAddress(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .sortedBy { if (it.name.startsWith("wlan")) 0 else 1 }
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
            ?.hostAddress
    }.getOrNull()

    private fun installer(): String? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            app.packageManager.getInstallSourceInfo(packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION") app.packageManager.getInstallerPackageName(packageName)
        }
    }.getOrNull()

    private fun battery(): String {
        val manager = app.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return "unknown"
        val level = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return "$level%${if (manager.isCharging) " · charging" else ""}"
    }

    private fun network(): String = runCatching {
        val connectivity = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return "offline"
        val transport = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            else -> "Other"
        }
        val metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        "$transport${if (metered) " · metered" else ""} · ↓${caps.linkDownstreamBandwidthKbps / 1000} Mbps"
    }.getOrElse { "unknown" }

    private fun isEmulator(): Boolean =
        Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator") ||
            Build.MODEL.contains("sdk_gphone") || Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish")

    private companion object {
        const val MB = 1_048_576L
    }
}
