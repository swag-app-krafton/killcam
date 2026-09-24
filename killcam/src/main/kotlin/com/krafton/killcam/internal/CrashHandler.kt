package com.krafton.killcam.internal

import android.os.Process
import kotlin.system.exitProcess

/**
 * Records uncaught exceptions and saves the session before the process dies,
 * then hands over to whatever handler was installed before (Crashlytics,
 * Sentry, the platform's "app has stopped" dialog), so Killcam never changes
 * how the app crashes.
 */
internal object CrashHandler {
    @Volatile private var installed = false

    fun install(rt: KillcamRuntime) {
        if (installed) return
        installed = true
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                rt.onCrash(thread, throwable)
            } catch (_: Throwable) {
                // Never let recording a crash replace the original crash.
            }
            if (previous != null) {
                previous.uncaughtException(thread, throwable)
            } else {
                Process.killProcess(Process.myPid())
                exitProcess(10)
            }
        }
    }
}
