package com.krafton.killcam.internal

import android.app.Activity
import android.content.res.Resources
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.Window
import android.widget.TextView
import com.krafton.killcam.core.model.TimelineType
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.lang.ref.WeakReference
import java.lang.reflect.InvocationHandler
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.lang.reflect.Proxy
import kotlin.math.hypot

/**
 * Records taps and swipes by wrapping each activity's [Window.Callback], the
 * first code to see every touch, before any view or Compose node does. A
 * dynamic proxy is used instead of a subclass so methods added to the
 * interface in future Android versions still reach the original callback.
 *
 * Positions are stored as fractions of the window, which is also what the
 * screenshots show, so the replay can draw taps over frames of any size.
 */
internal class TouchTracker(private val rt: KillcamRuntime) {

    fun wrap(activity: Activity) {
        val window = activity.window ?: return
        val original = window.callback ?: return
        if (Proxy.isProxyClass(original.javaClass) && Proxy.getInvocationHandler(original) is Tracker) return
        window.callback = Proxy.newProxyInstance(
            Window.Callback::class.java.classLoader,
            arrayOf(Window.Callback::class.java),
            Tracker(original, activity),
        ) as Window.Callback
    }

    private inner class Tracker(private val delegate: Window.Callback, activity: Activity) : InvocationHandler {
        private val activity = WeakReference(activity)
        private val slop = ViewConfiguration.get(activity).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var downAt = 0L

        override fun invoke(proxy: Any, method: Method, args: Array<out Any?>?): Any? {
            if (method.name == "dispatchTouchEvent" && args?.size == 1) {
                (args[0] as? MotionEvent)?.let { event -> runCatching { onTouch(event) } }
            }
            return try {
                if (args == null) method.invoke(delegate) else method.invoke(delegate, *args)
            } catch (e: InvocationTargetException) {
                throw e.targetException
            }
        }

        private fun onTouch(event: MotionEvent) {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.x
                    downY = event.y
                    downAt = event.eventTime
                    // The frame the user is looking at as they touch it.
                    rt.capture.request("touch", 0)
                }
                MotionEvent.ACTION_UP -> record(event)
            }
        }

        private fun record(event: MotionEvent) {
            val decor = activity.get()?.window?.peekDecorView() ?: return
            if (decor.width == 0 || decor.height == 0) return
            val distance = hypot(event.x - downX, event.y - downY)
            val duration = event.eventTime - downAt
            val gesture = when {
                distance > slop * 2 -> "swipe"
                duration > ViewConfiguration.getLongPressTimeout() -> "long_press"
                else -> "tap"
            }
            val target = if (gesture == "swipe") null else describeTarget(decor, downX, downY)
            rt.core.store.timeline(
                TimelineType.Tap,
                target?.let { "$gesture · $it" } ?: gesture,
                buildJsonObject {
                    put("x", JsonPrimitive(downX / decor.width))
                    put("y", JsonPrimitive(downY / decor.height))
                    put("gesture", JsonPrimitive(gesture))
                    put("target", JsonPrimitive(target))
                    if (gesture == "swipe") {
                        put("x2", JsonPrimitive(event.x / decor.width))
                        put("y2", JsonPrimitive(event.y / decor.height))
                    }
                    put("durationMs", JsonPrimitive(duration))
                },
            )
            // And the frame after the app has reacted to it.
            rt.capture.request("after-tap", 700)
        }
    }

    /**
     * Names the view under a tap for classic View UIs. Compose and React
     * Native draw their content inside one host view, so for them this
     * returns null rather than an unhelpful "AndroidComposeView".
     */
    private fun describeTarget(root: View, x: Float, y: Float): String? {
        val hit = deepestAt(root, x.toInt(), y.toInt()) ?: return null
        if (HOST_VIEWS.any { hit.javaClass.name.contains(it) }) return null
        hit.contentDescription?.takeIf { it.isNotBlank() }?.let { return it.toString().take(60) }
        (hit as? TextView)?.text?.takeIf { it.isNotBlank() }?.let { return "\"${it.toString().take(40)}\"" }
        if (hit.id != View.NO_ID) {
            runCatching { return "#" + hit.resources.getResourceEntryName(hit.id) }
                .onFailure { if (it !is Resources.NotFoundException) return null }
        }
        return hit.javaClass.simpleName
    }

    private fun deepestAt(view: View, x: Int, y: Int): View? {
        if (view.visibility != View.VISIBLE) return null
        val location = IntArray(2)
        view.getLocationInWindow(location)
        if (x < location[0] || y < location[1] || x >= location[0] + view.width || y >= location[1] + view.height) return null
        if (view is ViewGroup) {
            for (i in view.childCount - 1 downTo 0) {
                deepestAt(view.getChildAt(i), x, y)?.let { return it }
            }
        }
        return view.takeIf { it.isClickable || it is TextView || view !is ViewGroup }
    }

    private companion object {
        val HOST_VIEWS = listOf("ComposeView", "ReactRootView", "ReactSurfaceView", "WebView")
    }
}
