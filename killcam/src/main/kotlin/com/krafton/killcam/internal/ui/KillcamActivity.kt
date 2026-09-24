package com.krafton.killcam.internal.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.window.OnBackInvokedDispatcher
import android.widget.Toast
import androidx.core.content.FileProvider
import com.krafton.killcam.Killcam
import com.krafton.killcam.internal.KillcamRuntime
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/**
 * The in-app debugging window: the dashboard, full screen, in a WebView.
 *
 * The dashboard's phone layout (`?embed=1`) owns all of the chrome. What only
 * the phone can do (close this window, share a bug bundle through the Android
 * share sheet, switch Wi-Fi sharing and show its PIN, copy to the clipboard)
 * is offered to it as `window.KillcamNative`. The page is only ever the
 * dashboard from the local server: any other URL opens outside the WebView,
 * so nothing else can reach the bridge.
 *
 * Plain framework views on purpose: no AppCompat or Compose dependency that
 * could clash with the app's own versions in its debug build.
 */
internal class KillcamActivity : Activity() {
    private val runtime: KillcamRuntime? get() = Killcam.runtime
    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var loadAttempts = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val rt = runtime ?: return finish()
        web = buildWebView()
        root = FrameLayout(this).apply {
            setBackgroundColor(BG)
            addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        applyInsets(root)
        setContentView(root)
        setChrome(BG, lightBackground = false)
        registerBack()
        rt.whenServerReady { loadDashboard() }
        maybeAskForNotifications()
    }

    /**
     * Back steps through the dashboard's own history first: every sheet,
     * dialog and full-screen pane it opens pushes an entry. Apps targeting
     * Android 16 never get onBackPressed() (predictive back is always on), so
     * from Android 13 the callback is registered with the dispatcher instead.
     */
    private fun registerBack() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) {
            if (web.canGoBack()) web.goBack() else finish()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onDestroy() {
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    // ------------------------------------------------------------- webview ---

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun buildWebView(): WebView = WebView(this).apply {
        setBackgroundColor(BG)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        addJavascriptInterface(NativeBridge(), "KillcamNative")
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isDashboard(uri)) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // The server may still be binding right after process start.
                if (request.isForMainFrame && loadAttempts < 10) view.postDelayed({ loadDashboard() }, 600)
            }
        }
        // Downloads (HAR, bundles) don't work inside a WebView; share natively instead.
        setDownloadListener { _, _, _, _, _ -> shareBundle() }
    }

    private fun isDashboard(uri: Uri): Boolean =
        uri.scheme == "http" && (uri.host == "127.0.0.1" || uri.host == "localhost") && uri.port == runtime?.core?.port

    private fun loadDashboard() {
        val rt = runtime ?: return
        loadAttempts++
        val error = rt.serverError
        if (error != null) {
            web.loadData(
                "<body style='background:#0F1012;color:#E8E8EA;font:15px sans-serif;padding:20px'>" +
                    "<h3 style='color:#FF3B3B'>Dashboard unavailable</h3><p>${error.message}</p>" +
                    "<p>Capture continues, and crashes still save the session.</p></body>",
                "text/html", "utf-8",
            )
            return
        }
        web.loadUrl("http://127.0.0.1:${rt.core.port}/?embed=1")
    }

    /** Tells the page something changed natively, e.g. Wi-Fi sharing finished switching. */
    private fun notifyPage(type: String) {
        web.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('killcam-native',{detail:{type:'$type'}}))",
            null,
        )
    }

    /** `window.KillcamNative`. Called on a WebView binder thread; UI work hops to the main thread. */
    private inner class NativeBridge {
        @JavascriptInterface
        fun close() = runOnUiThread { finish() }

        @JavascriptInterface
        fun shareBundle() = runOnUiThread { this@KillcamActivity.shareBundle() }

        @JavascriptInterface
        fun getConnection(): String {
            val core = runtime?.core ?: return "{}"
            val status = core.status(remote = false)
            return JSONObject()
                .put("port", status.port)
                .put("usbCommand", "adb forward tcp:${status.port} tcp:${status.port}")
                .put("wifiEnabled", status.wifiEnabled)
                .put("wifiUrl", status.wifiUrl ?: JSONObject.NULL)
                .put("pin", if (status.wifiEnabled) core.access.pin else JSONObject.NULL)
                .toString()
        }

        @JavascriptInterface
        fun setWifiSharing(enabled: Boolean) = runOnUiThread {
            runtime?.setWifiSharing(enabled) { notifyPage("connection") }
        }

        /** Matches the system-bar areas to the page's theme: `setChrome("#ffffff", true)`. */
        @JavascriptInterface
        fun setChrome(background: String, light: Boolean) = runOnUiThread {
            runCatching { Color.parseColor(background) }.onSuccess { setChrome(it, light) }
        }

        @JavascriptInterface
        fun copy(text: String) = runOnUiThread {
            (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Killcam", text))
            // Android 13+ shows its own clipboard confirmation.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) toast("Copied")
        }
    }

    // ------------------------------------------------------------- actions ---

    /** Zips the live session and hands it to the share sheet (Slack, Gmail, Drive, JIRA…). */
    private fun shareBundle() {
        val rt = runtime ?: return
        toast("Preparing bug bundle…")
        thread(isDaemon = true) {
            val result = runCatching {
                val dir = File(cacheDir, "killcam-share").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val bundle = rt.core.liveBundle()
                val file = File(dir, "killcam-${bundle.session.id}.zip")
                file.outputStream().use { rt.core.sessions.export(bundle, rt.core.har(bundle), it) }
                FileProvider.getUriForFile(this, "$packageName.killcam.files", file)
            }
            runOnUiThread {
                result.onSuccess(::share).onFailure { toast("Could not build the bundle: ${it.message}") }
            }
        }
    }

    private fun share(uri: Uri) {
        val send = Intent(Intent.ACTION_SEND)
            .setType("application/zip")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, "Killcam bug bundle · ${runtime?.platform?.appName}")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri("bundle", uri)
        startActivity(Intent.createChooser(send, "Share bug bundle"))
    }

    private fun maybeAskForNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (runtime?.config?.showNotification != true) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_NOTIFICATIONS) runtime?.notifier?.show()
    }

    // ------------------------------------------------------------- helpers ---

    /**
     * Pads the content clear of the status bar, cutout, navigation bar and
     * keyboard. Apps targeting Android 15+ are always edge-to-edge, so without
     * this the page draws under the clock.
     */
    private fun applyInsets(root: View) {
        root.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                val ime = insets.getInsets(WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
    }

    /** Paints the inset areas and picks light or dark system-bar icons to suit. */
    private fun setChrome(color: Int, lightBackground: Boolean) {
        root.setBackgroundColor(color)
        web.setBackgroundColor(color)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val lightIcons = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (lightBackground) lightIcons else 0, lightIcons)
        }
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    private companion object {
        const val REQUEST_NOTIFICATIONS = 0x4B1
        val BG = Color.parseColor("#0F1012")
    }
}
