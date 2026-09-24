package com.krafton.killcam.internal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import com.krafton.killcam.Killcam

/** Handles the notification's "Mark moment" action. */
internal class KillcamReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_MARK) {
            Killcam.mark("Marked from notification")
            Toast.makeText(context, "Killcam: moment marked", Toast.LENGTH_SHORT).show()
        }
    }

    companion object {
        const val ACTION_MARK = "com.krafton.killcam.MARK"
    }
}

/** A distinct subclass so the app's own androidx FileProvider declaration never collides with ours. */
internal class KillcamFileProvider : androidx.core.content.FileProvider()
