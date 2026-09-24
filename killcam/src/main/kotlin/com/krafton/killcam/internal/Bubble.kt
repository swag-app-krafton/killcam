package com.krafton.killcam.internal

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.ColorDrawable
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.PopupWindow
import android.widget.Toast
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The floating Killcam button: tap opens the inspector, long-press marks the
 * moment, drag moves it (snapping to the nearer edge).
 *
 * It lives in a PopupWindow, a panel window of its own on top of the
 * activity, so it needs no overlay permission, never receives the app's
 * touches, and is absent from PixelCopy frames of the activity window.
 */
internal class Bubble(private val rt: KillcamRuntime) {
    private var popup: PopupWindow? = null
    private var host: Activity? = null
    private val prefs = rt.app.getSharedPreferences("killcam_ui", Context.MODE_PRIVATE)

    fun attach(activity: Activity) {
        if (!rt.config.showBubble) return
        val decor = activity.window?.decorView ?: return
        decor.post {
            if (activity.isFinishing || activity.isDestroyed || rt.activities.current() !== activity) return@post
            if (decor.windowToken == null || popup?.isShowing == true && host === activity) return@post
            detach(host ?: activity)
            show(activity, decor)
        }
    }

    fun detach(activity: Activity) {
        if (host !== activity) return
        runCatching { popup?.dismiss() }
        popup = null
        host = null
    }

    private fun show(activity: Activity, anchor: View) {
        val density = activity.resources.displayMetrics.density
        val size = (SIZE_DP * density).roundToInt()
        val view = BubbleView(activity)
        val window = PopupWindow(view, size, size, false).apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            isClippingEnabled = false
            elevation = 8 * density
        }
        val screenWidth = anchor.width.coerceAtLeast(size)
        val x = if (prefs.getBoolean(KEY_LEFT, false)) EDGE_DP.dp(density) else screenWidth - size - EDGE_DP.dp(density)
        val y = prefs.getInt(KEY_Y, (anchor.height * 0.6f).roundToInt())
        runCatching { window.showAtLocation(anchor, Gravity.TOP or Gravity.START, x, y) }.onFailure { return }
        view.bind(window, anchor, size, x, y)
        popup = window
        host = activity
    }

    private fun Int.dp(density: Float) = (this * density).roundToInt()

    @SuppressLint("ViewConstructor")
    private inner class BubbleView(context: Context) : View(context) {
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFF2A900.toInt(); style = Paint.Style.STROKE }
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xE6141518.toInt() }
        private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFF3B3B.toInt() }
        private val slop = ViewConfiguration.get(context).scaledTouchSlop
        private lateinit var window: PopupWindow
        private lateinit var anchor: View
        private var size = 0
        private var x = 0
        private var y = 0
        private var startRawX = 0f
        private var startRawY = 0f
        private var startX = 0
        private var startY = 0
        private var dragging = false
        private var longPressed = false
        private val longPress = Runnable {
            longPressed = true
            performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            rt.mark("Marked from bubble")
            Toast.makeText(context, "Killcam: moment marked", Toast.LENGTH_SHORT).show()
        }

        init {
            contentDescription = "Open Killcam"
        }

        fun bind(window: PopupWindow, anchor: View, size: Int, x: Int, y: Int) {
            this.window = window
            this.anchor = anchor
            this.size = size
            this.x = x
            this.y = y
        }

        override fun onDraw(canvas: Canvas) {
            val r = width / 2f
            ring.strokeWidth = r * 0.12f
            canvas.drawCircle(r, r, r * 0.9f, fill)
            canvas.drawCircle(r, r, r * 0.84f, ring)
            // Pulses between a big and a small dot: "recording".
            val phase = (System.currentTimeMillis() / 600) % 2 == 0L
            canvas.drawCircle(r, r, r * if (phase) 0.34f else 0.28f, dot)
            if (!rt.core.store.paused) postInvalidateDelayed(600)
        }

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startRawX = event.rawX
                    startRawY = event.rawY
                    startX = x
                    startY = y
                    dragging = false
                    longPressed = false
                    postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - startRawX
                    val dy = event.rawY - startRawY
                    if (!dragging && (abs(dx) > slop || abs(dy) > slop)) {
                        dragging = true
                        removeCallbacks(longPress)
                    }
                    if (dragging) {
                        x = (startX + dx).roundToInt().coerceIn(0, (anchor.width - size).coerceAtLeast(0))
                        y = (startY + dy).roundToInt().coerceIn(0, (anchor.height - size).coerceAtLeast(0))
                        window.update(x, y, -1, -1)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    removeCallbacks(longPress)
                    when {
                        dragging -> snap()
                        !longPressed -> {
                            performClick()
                        }
                    }
                }
                MotionEvent.ACTION_CANCEL -> removeCallbacks(longPress)
            }
            return true
        }

        override fun performClick(): Boolean {
            super.performClick()
            rt.openInspector()
            return true
        }

        private fun snap() {
            val left = x + size / 2 < anchor.width / 2
            val edge = (EDGE_DP * resources.displayMetrics.density).roundToInt()
            x = if (left) edge else anchor.width - size - edge
            window.update(x, y, -1, -1)
            prefs.edit().putBoolean(KEY_LEFT, left).putInt(KEY_Y, y).apply()
        }
    }

    private companion object {
        const val SIZE_DP = 44
        const val EDGE_DP = 6
        const val KEY_LEFT = "bubble_left"
        const val KEY_Y = "bubble_y"
    }
}
