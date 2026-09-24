package com.krafton.killcam.internal

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.krafton.killcam.core.model.TimelineType
import com.krafton.killcam.internal.ui.KillcamActivity
import java.lang.ref.WeakReference

/**
 * Follows the app's activities: which one is on top (for screenshots and the
 * bubble), foreground/background transitions, and screen names for apps that
 * do not report their own.
 */
internal class ActivityTracker(private val rt: KillcamRuntime) : Application.ActivityLifecycleCallbacks {
    private var resumed: WeakReference<Activity>? = null
    private var started = 0

    fun current(): Activity? = resumed?.get()?.takeUnless { it.isFinishing || it.isDestroyed }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity is KillcamActivity) return
        if (rt.config.captureTaps) rt.touches.wrap(activity)
        rt.core.store.timeline(TimelineType.Lifecycle, "${activity.javaClass.simpleName} created")
    }

    override fun onActivityStarted(activity: Activity) {
        if (started++ == 0) rt.onForeground()
    }

    override fun onActivityResumed(activity: Activity) {
        resumed = WeakReference(activity)
        if (activity is KillcamActivity) return
        // Fall back to the activity name only if the app has not reported a
        // screen of its own by the time the first frames are up.
        rt.main.postDelayed({
            if (!rt.appReportsScreens && current() === activity) rt.recordScreen(activity.javaClass.simpleName)
        }, SCREEN_FALLBACK_DELAY_MS)
        rt.bubble.attach(activity)
    }

    override fun onActivityPaused(activity: Activity) {
        rt.bubble.detach(activity)
    }

    override fun onActivityStopped(activity: Activity) {
        if (--started == 0) rt.onBackground()
    }

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    override fun onActivityDestroyed(activity: Activity) {
        if (resumed?.get() === activity) resumed = null
    }

    private companion object {
        const val SCREEN_FALLBACK_DELAY_MS = 800L
    }
}
