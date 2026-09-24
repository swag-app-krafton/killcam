package com.krafton.killcam.sample

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.krafton.killcam.Killcam
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException

/**
 * A tiny fake payments app. Each button is a "screen" transition plus a real
 * HTTP call, so the Network, Logs and Replay panels have something honest to show.
 */
class MainActivity : Activity() {
    private val http by lazy { (application as SampleApp).http }
    private lateinit var output: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val newPinPad = Killcam.booleanFlag("pay.new_pin_pad", false, "Redesigned UPI PIN pad", "Payments")
        val bannerVariant = Killcam.stringFlag(
            "home.banner_variant", "control", "Home hero banner experiment", "Home",
            options = listOf("control", "cashback", "rewards"),
        )

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.parseColor("#121316"))
        }
        column.addView(TextView(this).apply {
            text = "Swag Pay · Killcam sample"
            textSize = 22f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
        })
        column.addView(TextView(this).apply {
            text = "Banner: $bannerVariant · New PIN pad: $newPinPad\nTap the red Killcam bubble, or run adb forward tcp:8090 tcp:8090 and open localhost:8090."
            setTextColor(Color.parseColor("#A0A3AB"))
            setPadding(0, 12, 0, 24)
        })

        button(column, "Home: load balance") {
            Killcam.screen("Home")
            get("https://httpbin.org/json")
        }
        button(column, "Scan: validate VPA") {
            Killcam.screen("Scan")
            post("https://httpbin.org/post", """{"vpa":"chaiwala@paytm"}""")
        }
        button(column, "Pay ₹249") {
            Killcam.screen("PayFlow.Pin")
            Killcam.event("payment_initiated", mapOf("amount_paise" to 24_900, "flow" to "scan"))
            post("https://httpbin.org/anything/v1/upi/pay", """{"payee":"chaiwala@paytm","amountPaise":24900}""")
        }
        button(column, "Slow PSP (3 s)") { get("https://httpbin.org/delay/3") }
        button(column, "Server error (500)") { get("https://httpbin.org/status/500") }
        button(column, "Receipt image") { get("https://httpbin.org/image/png") }
        button(column, "Gzip response") { get("https://httpbin.org/gzip") }
        button(column, "Log a warning") {
            Killcam.w("PayFlow", "PSP latency above SLO", IllegalStateException("p95 3120ms > 2000ms"))
            android.util.Log.w("PayFlow", "Same warning via android.util.Log (captured from logcat)")
        }
        button(column, "Non-fatal exception") {
            Killcam.recordException(IllegalArgumentException("Amount exceeds UPI Lite limit"), "Validation failed")
        }
        button(column, "Crash the app") {
            Killcam.screen("TransactionDetail")
            throw IllegalStateException("VPA handle missing for payee")
        }

        output = TextView(this).apply {
            setTextColor(Color.parseColor("#F2A900"))
            typeface = Typeface.MONOSPACE
            setPadding(0, 24, 0, 0)
        }
        column.addView(output)

        val scroll = ScrollView(this).apply { addView(column) }
        scroll.setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(scroll)
        Killcam.screen("Home")
        intent?.data?.let { Killcam.timeline("Opened via deep link", mapOf("uri" to it.toString())) }
    }

    private fun button(parent: LinearLayout, label: String, onClick: () -> Unit) {
        parent.addView(
            Button(this).apply {
                text = label
                isAllCaps = false
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setOnClickListener { onClick() }
            },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
    }

    private fun get(url: String) = enqueue(Request.Builder().url(url).header("Authorization", "Bearer sample-token").build())

    private fun post(url: String, json: String) = enqueue(
        Request.Builder().url(url)
            .header("Authorization", "Bearer sample-token")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build(),
    )

    private fun enqueue(request: Request) {
        output.text = "→ ${request.method} ${request.url.encodedPath}"
        http.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = show("✕ ${e.javaClass.simpleName}: ${e.message}")

            override fun onResponse(call: Call, response: Response) {
                val size = response.body?.use { it.bytes().size } ?: 0
                show("← ${response.code} ${request.url.encodedPath} ($size bytes)")
            }
        })
    }

    private fun show(text: String) = runOnUiThread { output.text = text }
}
