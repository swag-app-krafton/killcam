package com.krafton.killcam

/**
 * Tuning for [Killcam.install]. Defaults suit a QA build of a payments app:
 * everything captured, nothing reachable off-device until a tester turns on
 * Wi-Fi sharing from the in-app window.
 */
public data class KillcamConfig @JvmOverloads constructor(
    /** First port to try; the next free one is used if taken. Forward it with `adb forward tcp:P tcp:P`. */
    val port: Int = 8090,
    /** Draggable Killcam button over the app. Tap opens the inspector, long-press marks the moment. */
    val showBubble: Boolean = true,
    /** Ongoing notification with the dashboard address. Needs POST_NOTIFICATIONS on Android 13+. */
    val showNotification: Boolean = true,
    /** Shake the device to open the inspector. */
    val shakeToOpen: Boolean = true,
    /** Frames for the replay: on screen change, around taps, and when the screen settles. FLAG_SECURE windows are skipped. */
    val captureScreenshots: Boolean = true,
    /** Tap and swipe positions for the replay. */
    val captureTaps: Boolean = true,
    /** This process's logcat, so `Log.*`, `println` and React Native `console.log` show up without code changes. */
    val captureLogcat: Boolean = true,
    /** Uncaught exceptions; the session is saved to disk as the process dies. */
    val captureCrashes: Boolean = true,
    val maxNetworkCalls: Int = 500,
    /** Bytes kept per request/response body; the rest is dropped and marked truncated. */
    val maxBodyBytes: Long = 128 * 1024,
    /** Header names (case-insensitive) whose values are masked before they are stored. */
    val redactHeaders: Set<String> = emptySet(),
    /** Killcam refuses to start in non-debuggable builds unless this is set. */
    val allowNonDebuggable: Boolean = false,
    /**
     * Logcat tags never copied into Logs; `Foo*` matches a prefix. Defaults to
     * framework and OEM chatter (a vivo compositor alone logs every frame).
     * Pass `DEFAULT_IGNORED_LOG_TAGS + setOf("MySdk")` to extend it.
     */
    val ignoredLogTags: Set<String> = DEFAULT_IGNORED_LOG_TAGS,
) {
    public companion object {
        @JvmField
        public val DEFAULT_IGNORED_LOG_TAGS: Set<String> = setOf(
            // Rendering and window plumbing, logged per frame or per layout.
            "SurfaceComposerClient", "BLASTBufferQueue", "BufferQueueConsumer", "BufferQueueProducer",
            "HWUI", "OpenGLRenderer", "libEGL", "Adreno*", "Gralloc*", "DMABUFHEAPS", "Choreographer*",
            "ViewRootImpl*", "VRI*", "InsetsController", "InsetsSourceConsumer", "ImeTracker",
            "InputMethodManager*", "SurfaceView*", "HandWritingStubImpl", "AutofillManager",
            "CompatChangeReporter", "nativeloader", "ziparchive",
            // Media and camera capability probes.
            "VideoCapabilities", "CameraManagerGlobal", "CXCP", "DMA-BUF*",
            // OEM layers: vivo, OPPO/OnePlus/realme, Xiaomi, Huawei, Samsung.
            "VSPA", "Vivo*", "vivo*", "Oplus*", "OplusViewDebug*", "MIUI*", "MiuiFrame*", "HiTouch*", "HwApi*",
            "SemWallpaper*", "SamsungAlarmManager",
        )
    }
}
