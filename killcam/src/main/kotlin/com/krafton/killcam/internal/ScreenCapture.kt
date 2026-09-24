package com.krafton.killcam.internal

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.view.PixelCopy
import android.view.WindowManager
import com.krafton.killcam.core.model.TimelineEvent
import com.krafton.killcam.core.model.TimelineType
import com.krafton.killcam.internal.ui.KillcamActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Frames for the replay.
 *
 * PixelCopy reads the activity window's own surface, so the Killcam bubble (a
 * separate panel window) never appears in captures, and GPU content such as
 * the camera preview does. Frames are downscaled to [MAX_WIDTH] and JPEG'd on a
 * worker thread; frames identical to the previous one are dropped so an idle
 * screen costs nothing on disk.
 *
 * Windows with FLAG_SECURE (UPI PIN entry, card screens) are never captured.
 */
internal class ScreenCapture(private val rt: KillcamRuntime) {
    private val workerThread = HandlerThread("killcam-capture", Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val worker = Handler(workerThread.looper)
    private val main = rt.main

    // Main thread only.
    private var lastCaptureAt = 0L
    private val pending = HashMap<String, Runnable>()
    private var periodicOn = false
    private var lastSecureNote: String? = null

    // Worker thread only.
    private var lastHash = 0L
    private var hasHash = false

    private val periodic = object : Runnable {
        override fun run() {
            if (!periodicOn) return
            // Catches what changes without a touch: payment result screens, async content, errors.
            if (SystemClock.uptimeMillis() - lastCaptureAt > PERIODIC_MS) capture("settle", force = false) { }
            main.postDelayed(this, PERIODIC_MS)
        }
    }

    /** Debounced per trigger: a burst of requests with the same trigger yields one frame. */
    fun request(trigger: String, delayMs: Long, force: Boolean = false) {
        if (!rt.config.captureScreenshots) return
        main.post {
            pending.remove(trigger)?.let(main::removeCallbacks)
            val task = Runnable {
                pending.remove(trigger)
                capture(trigger, force) { }
            }
            pending[trigger] = task
            main.postDelayed(task, delayMs)
        }
    }

    suspend fun captureNow(trigger: String): TimelineEvent? = suspendCancellableCoroutine { continuation ->
        main.post { capture(trigger, force = true) { if (continuation.isActive) continuation.resume(it) } }
    }

    fun startPeriodic() {
        if (!rt.config.captureScreenshots || periodicOn) return
        periodicOn = true
        main.postDelayed(periodic, PERIODIC_MS)
    }

    fun stopPeriodic() {
        periodicOn = false
        main.removeCallbacks(periodic)
    }

    private fun capture(trigger: String, force: Boolean, done: (TimelineEvent?) -> Unit) {
        val activity = capturable() ?: return done(null)
        val now = SystemClock.uptimeMillis()
        if (!force && now - lastCaptureAt < MIN_INTERVAL_MS) return done(null)
        val window = activity.window
        val decor = window.peekDecorView()
        if (decor == null || decor.width == 0 || decor.height == 0 || !decor.isAttachedToWindow) return done(null)
        lastCaptureAt = now
        // Stamp the frame with the moment and screen it shows, not when encoding finishes.
        val capturedAt = rt.core.store.now()
        val screen = rt.core.store.currentScreen

        val scale = min(1f, MAX_WIDTH.toFloat() / decor.width)
        val bitmap = Bitmap.createBitmap(
            (decor.width * scale).roundToInt().coerceAtLeast(1),
            (decor.height * scale).roundToInt().coerceAtLeast(1),
            Bitmap.Config.ARGB_8888,
        )
        try {
            PixelCopy.request(window, bitmap, { result ->
                val event = if (result == PixelCopy.SUCCESS) store(bitmap, trigger, !force, capturedAt, screen) else null
                bitmap.recycle()
                main.post { done(event) }
            }, worker)
        } catch (_: IllegalArgumentException) {
            // The window has no surface yet (or any more).
            bitmap.recycle()
            done(null)
        }
    }

    /** The top app activity if a frame may be taken of it, else null. Main thread. */
    private fun capturable(): Activity? {
        if (!rt.config.captureScreenshots || rt.core.store.paused) return null
        val activity = rt.activities.current() ?: return null
        if (activity is KillcamActivity) return null
        val window = activity.window ?: return null
        if (window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) {
            val screen = rt.core.store.currentScreen
            if (lastSecureNote != screen) {
                lastSecureNote = screen
                rt.core.store.timeline(TimelineType.Custom, "Screenshots skipped: secure window (FLAG_SECURE)")
            }
            return null
        }
        return activity
    }

    /** Worker thread. Returns the timeline event, or null if the frame duplicated the last one. */
    private fun store(bitmap: Bitmap, trigger: String, dedupe: Boolean, capturedAt: Long, screen: String?): TimelineEvent? {
        val hash = averageHash(bitmap)
        if (dedupe && hasHash && java.lang.Long.bitCount(hash xor lastHash) <= 2) return null
        lastHash = hash
        hasHash = true
        val out = ByteArrayOutputStream(64 * 1024)
        bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
        return rt.core.recordScreenshot(out.toByteArray(), bitmap.width, bitmap.height, trigger, capturedAt, screen)
    }

    /** 64-bit perceptual hash: good enough to tell "nothing changed" from "something did". */
    private fun averageHash(bitmap: Bitmap): Long {
        val small = Bitmap.createScaledBitmap(bitmap, 8, 8, true)
        val pixels = IntArray(64)
        small.getPixels(pixels, 0, 8, 0, 0, 8, 8)
        if (small !== bitmap) small.recycle()
        val luma = pixels.map { (Color.red(it) * 299 + Color.green(it) * 587 + Color.blue(it) * 114) / 1000 }
        val mean = luma.average()
        var hash = 0L
        luma.forEachIndexed { i, value -> if (value > mean) hash = hash or (1L shl i) }
        return hash
    }

    /**
     * The last frame before a crash: the most valuable one in the replay.
     * On the main thread the view tree is drawn in software (PixelCopy needs a
     * looper turn we will never get); elsewhere PixelCopy runs with a short wait.
     */
    fun captureForCrash() {
        if (!rt.config.captureScreenshots) return
        val onMain = Looper.myLooper() == Looper.getMainLooper()
        val activity = (if (onMain) capturable() else rt.activities.current()) ?: return
        val window = activity.window ?: return
        if (window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) return
        val decor = window.peekDecorView() ?: return
        if (decor.width == 0 || decor.height == 0) return
        val scale = min(1f, MAX_WIDTH.toFloat() / decor.width)
        val bitmap = Bitmap.createBitmap(
            (decor.width * scale).roundToInt().coerceAtLeast(1),
            (decor.height * scale).roundToInt().coerceAtLeast(1),
            Bitmap.Config.ARGB_8888,
        )
        val ok = if (onMain) {
            runCatching {
                val canvas = Canvas(bitmap)
                canvas.scale(scale, scale)
                decor.draw(canvas)
            }.isSuccess
        } else {
            val latch = CountDownLatch(1)
            var result = -1
            runCatching {
                PixelCopy.request(window, bitmap, { result = it; latch.countDown() }, worker)
                latch.await(400, TimeUnit.MILLISECONDS)
            }
            result == PixelCopy.SUCCESS
        }
        if (ok) {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            rt.core.recordScreenshot(out.toByteArray(), bitmap.width, bitmap.height, "crash")
        }
        bitmap.recycle()
    }

    private companion object {
        const val MAX_WIDTH = 540
        const val JPEG_QUALITY = 70
        const val MIN_INTERVAL_MS = 300L
        const val PERIODIC_MS = 2_500L
    }
}
