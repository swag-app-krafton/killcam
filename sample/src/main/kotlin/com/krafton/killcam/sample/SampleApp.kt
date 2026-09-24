package com.krafton.killcam.sample

import android.app.Application
import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.krafton.killcam.Killcam
import com.krafton.killcam.KillcamConfig
import com.krafton.killcam.KillcamInterceptor
import com.tencent.mmkv.MMKV
import okhttp3.OkHttpClient
import java.io.File

class SampleApp : Application() {
    lateinit var http: OkHttpClient
        private set

    override fun onCreate() {
        super.onCreate()
        // One line in the app; a no-op in release builds.
        Killcam.install(this, KillcamConfig(redactHeaders = setOf("Authorization")))

        http = OkHttpClient.Builder()
            .addInterceptor(KillcamInterceptor())
            .build()

        Killcam.setInfo("Environment", "sample")
        Killcam.registerAction("Reset onboarding", "Clears the onboarding pref", "Session") {
            getSharedPreferences("sample-startup", MODE_PRIVATE).edit().clear().apply()
            "Onboarding reset"
        }
        Killcam.registerAction("Trigger test crash", "Throws on the main thread", "Debug") {
            throw IllegalStateException("Test crash from Killcam")
        }

        seedStorage()
    }

    /** Something to look at in every Storage tab. */
    private fun seedStorage() {
        getSharedPreferences("sample-startup", MODE_PRIVATE).edit()
            .putBoolean("onboarding-complete", true)
            .putLong("first-launch-ms", System.currentTimeMillis())
            .putStringSet("recent-payees", setOf("priya@okaxis", "chaiwala@paytm"))
            .apply()

        MMKV.initialize(this)
        MMKV.defaultMMKV().apply {
            encode("user.vpa", "rahul@swag")
            encode("balance.cachedPaise", 1_245_000.0)
            encode("onboarding.done", true)
            encode("launches", decodeInt("launches") + 1)
        }
        Killcam.registerMmkv("sample.secure", cryptKey = "sample-key")
        MMKV.mmkvWithID("sample.secure", MMKV.SINGLE_PROCESS_MODE, "sample-key").encode("pin.attempts", 2)

        TransactionsDb(this).writableDatabase.use { db ->
            if (db.compileStatement("SELECT COUNT(*) FROM transactions").simpleQueryForLong() == 0L) {
                listOf("priya@okaxis" to 24_900, "chaiwala@paytm" to 2_000, "rent@ybl" to 1_800_000).forEach { (vpa, paise) ->
                    db.insert("transactions", null, ContentValues().apply {
                        put("payee_vpa", vpa)
                        put("amount_paise", paise)
                        put("status", "SUCCESS")
                        put("created_at", System.currentTimeMillis())
                    })
                }
            }
        }
        File(filesDir, "receipts").mkdirs()
        File(filesDir, "receipts/txn_8Q2K.json").writeText("""{"txnId":"8Q2K","amountPaise":24900}""")

        // Placeholder Firebase project: defaults show up in the Remote Config
        // panel, and "Fetch & activate" reports an honest failure.
        if (FirebaseApp.getApps(this).isEmpty()) {
            FirebaseApp.initializeApp(
                this,
                FirebaseOptions.Builder()
                    .setApplicationId("1:000000000000:android:0000000000000000")
                    .setApiKey("AIzaSy-placeholder-for-killcam-sample")
                    .setProjectId("killcam-sample")
                    .build(),
            )
        }
        FirebaseRemoteConfig.getInstance().setDefaultsAsync(
            mapOf(
                "pay_new_pin_pad" to false,
                "upi_lite_limit_paise" to 50_000L,
                "home_banner_json" to """{"title":"5% cashback","cta":"Pay now"}""",
                "support_email" to "help@swag.gg",
            ),
        )
    }
}

class TransactionsDb(app: Application) : SQLiteOpenHelper(app, "transactions.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, payee_vpa TEXT NOT NULL, " +
                "amount_paise INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL)",
        )
        db.execSQL("CREATE VIEW recent AS SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
}
