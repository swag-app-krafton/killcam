package com.krafton.killcam.internal

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.krafton.killcam.R
import com.krafton.killcam.internal.ui.KillcamActivity

/** The ongoing "Killcam is recording" notification, carrying the dashboard address. */
internal class Notifier(private val rt: KillcamRuntime) {
    private val manager = rt.app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    fun show() {
        if (!rt.config.showNotification || !manager.areNotificationsEnabled()) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Killcam", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shows that Killcam is capturing this debug build"
                setShowBadge(false)
            },
        )
        val app = rt.app
        val open = PendingIntent.getActivity(
            app, 0,
            Intent(app, KillcamActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val mark = PendingIntent.getBroadcast(
            app, 1,
            Intent(app, KillcamReceiver::class.java).setAction(KillcamReceiver.ACTION_MARK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val core = rt.core
        val port = core.port
        val status = core.status(remote = false)
        val title = if (status.capturePaused) "Killcam · paused" else "Killcam · recording"
        val text = status.wifiUrl?.let { "Wi-Fi: $it · PIN ${core.access.pin}" }
            ?: if (rt.serverError != null) "Dashboard unavailable: ${rt.serverError?.message}"
            else "adb forward tcp:$port tcp:$port → http://localhost:$port"
        val notification = Notification.Builder(app, CHANNEL)
            .setSmallIcon(R.drawable.killcam_ic_stat)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setColor(0xFFF2A900.toInt())
            .addAction(Notification.Action.Builder(null, "Mark moment", mark).build())
            .build()
        runCatching { manager.notify(NOTIFICATION_ID, notification) }
    }

    private companion object {
        const val CHANNEL = "killcam"
        const val NOTIFICATION_ID = 0x4B1C
    }
}
