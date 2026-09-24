package com.krafton.killcam.internal

import android.app.Application
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.krafton.killcam.KillcamConfig
import com.krafton.killcam.core.CoreConfig
import com.krafton.killcam.core.KillcamCore
import com.krafton.killcam.core.endpoints.EndpointRegistry
import com.krafton.killcam.core.flags.FlagRegistry
import com.krafton.killcam.core.model.TimelineType
import com.krafton.killcam.core.platform.ActionRegistry
import com.krafton.killcam.core.store.StoreLimits
import com.krafton.killcam.internal.ui.KillcamActivity
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/** Everything Killcam runs inside an installed app, wired together once by [com.krafton.killcam.Killcam.install]. */
internal class KillcamRuntime(
    val app: Application,
    val config: KillcamConfig,
    flags: FlagRegistry,
    actions: ActionRegistry,
    val mmkvRegistry: Map<String, MmkvRegistration>,
    endpoints: EndpointRegistry,
) {
    val main = Handler(Looper.getMainLooper())
    val platform = AndroidPlatform(app, this)
    val core = KillcamCore(
        platform = platform,
        config = CoreConfig(
            dataDir = File(app.filesDir, "killcam"),
            port = config.port,
            limits = StoreLimits(maxNetworkCalls = config.maxNetworkCalls, maxBodyBytes = config.maxBodyBytes),
        ),
        flags = flags,
        actions = actions,
        endpoints = endpoints,
    )
    val redactedHeaders: Set<String> = config.redactHeaders.map { it.lowercase() }.toSet()

    val activities = ActivityTracker(this)
    val capture = ScreenCapture(this)
    val touches = TouchTracker(this)
    val bubble = Bubble(this)
    val notifier = Notifier(this)
    private val shake = ShakeDetector(app) { openInspector() }
    private val logcat = LogcatReader(core.store, config.ignoredLogTags)

    @Volatile var serverStarted = false
        private set
    @Volatile var serverError: Throwable? = null
        private set
    private val readyCallbacks = CopyOnWriteArrayList<() -> Unit>()

    /** True once the app reports its own screens; activity names are then no longer used as screens. */
    @Volatile var appReportsScreens = false
        private set

    init {
        platform.core = core
    }

    fun start() {
        registerBuiltInActions()
        loadEndpointCatalog()
        if (config.captureCrashes) CrashHandler.install(this)
        app.registerActivityLifecycleCallbacks(activities)
        core.store.timeline(TimelineType.Lifecycle, "Process start")
        if (config.captureLogcat) logcat.start()
        thread(name = "killcam-server", isDaemon = true) {
            try {
                val port = core.start()
                Log.i(TAG, "Dashboard ready: adb forward tcp:$port tcp:$port, then open http://localhost:$port")
                // Mirror Remote Config keys into Flags up front, so they are overridable before anyone opens that panel.
                runCatching { core.remoteConfig(fetch = false) }
            } catch (t: Throwable) {
                serverError = t
                Log.e(TAG, "Killcam server failed to start; capture continues without the dashboard", t)
            }
            serverStarted = true
            main.post {
                notifier.show()
                readyCallbacks.forEach { it() }
                readyCallbacks.clear()
            }
        }
    }

    /** The repo's endpoint catalog, shipped as a debug asset. A missing file is normal; a broken one is logged. */
    private fun loadEndpointCatalog() {
        val name = config.endpointsAsset ?: return
        val text = try {
            app.assets.open(name).bufferedReader().use { it.readText() }
        } catch (_: java.io.FileNotFoundException) {
            return
        } catch (e: java.io.IOException) {
            Log.w(TAG, "Could not read endpoint catalog asset '$name'", e)
            return
        }
        runCatching { core.endpoints.loadCatalog(text) }
            .onFailure { Log.w(TAG, "Endpoint catalog asset '$name' is not valid: ${it.message}") }
    }

    private fun registerBuiltInActions() {
        core.actions.register("Restart app", "Cold-starts the app, e.g. after changing flags read at startup", "Killcam") {
            val launch = app.packageManager.getLaunchIntentForPackage(app.packageName)?.component
                ?: return@register "No launcher activity to restart into"
            // Give the dashboard its response before the process goes away.
            main.postDelayed({
                app.startActivity(Intent.makeRestartActivityTask(launch))
                Runtime.getRuntime().exit(0)
            }, 300)
            "Restarting…"
        }
    }

    /** Runs [callback] on the main thread once the server has started (or failed to). */
    fun whenServerReady(callback: () -> Unit) {
        if (serverStarted) main.post(callback) else readyCallbacks += callback
    }

    fun onScreen(name: String, properties: Map<String, Any?>) {
        appReportsScreens = true
        recordScreen(name, properties)
    }

    fun recordScreen(name: String, properties: Map<String, Any?> = emptyMap()) {
        if (name == core.store.currentScreen) return
        core.store.timeline(TimelineType.Screen, name, properties.toJsonObject())
        // Let the new screen draw its first frames before grabbing one.
        capture.request("screen", 450)
    }

    fun mark(label: String) {
        core.store.timeline(TimelineType.Mark, label)
        capture.request("mark", 0, force = true)
    }

    fun onForeground() {
        core.store.timeline(TimelineType.Lifecycle, "Foreground")
        logcat.intervalMs = LogcatReader.FOREGROUND_INTERVAL_MS
        if (config.shakeToOpen) shake.start()
        capture.startPeriodic()
    }

    fun onBackground() {
        core.store.timeline(TimelineType.Lifecycle, "Background")
        logcat.intervalMs = LogcatReader.BACKGROUND_INTERVAL_MS
        shake.stop()
        capture.stopPeriodic()
    }

    fun openInspector() {
        val context = activities.current() ?: app
        if (context is KillcamActivity) return
        com.krafton.killcam.Killcam.open(context)
    }

    fun setCapturePaused(paused: Boolean) {
        core.setPaused(paused)
        notifier.show()
    }

    fun setWifiSharing(enabled: Boolean, done: () -> Unit) {
        thread(name = "killcam-wifi", isDaemon = true) {
            runCatching { core.setWifiEnabled(enabled) }
                .onFailure { Log.e(TAG, "Could not switch Wi-Fi sharing", it) }
            main.post {
                notifier.show()
                done()
            }
        }
    }

    /** Called on the crashing thread, before the previous handler kills the process. */
    fun onCrash(thread: Thread, throwable: Throwable) {
        runCatching { capture.captureForCrash() }
        core.onFatalCrash(thread, throwable)
    }

    companion object {
        const val TAG = "Killcam"
    }
}
