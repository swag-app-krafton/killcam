package com.krafton.killcam.internal

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import kotlin.math.sqrt

/** Two firm shakes within a second open the inspector. Only listens while the app is in the foreground. */
internal class ShakeDetector(context: Context, private val onShake: () -> Unit) : SensorEventListener {
    private val sensors = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private var firstShakeAt = 0L
    private var lastTriggerAt = 0L
    private var listening = false

    fun start() {
        if (listening) return
        val accelerometer = sensors?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        listening = sensors.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_UI)
    }

    fun stop() {
        if (!listening) return
        sensors?.unregisterListener(this)
        listening = false
    }

    override fun onSensorChanged(event: SensorEvent) {
        val (x, y, z) = Triple(event.values[0], event.values[1], event.values[2])
        val g = sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH
        if (g < THRESHOLD_G) return
        val now = SystemClock.uptimeMillis()
        if (now - lastTriggerAt < COOLDOWN_MS) return
        when {
            firstShakeAt == 0L || now - firstShakeAt > WINDOW_MS -> firstShakeAt = now
            now - firstShakeAt > MIN_GAP_MS -> {
                firstShakeAt = 0
                lastTriggerAt = now
                onShake()
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private companion object {
        const val THRESHOLD_G = 2.7f
        const val WINDOW_MS = 1_000L
        const val MIN_GAP_MS = 200L
        const val COOLDOWN_MS = 2_000L
    }
}
