package com.krafton.killcam

public enum class KillcamLevel { Verbose, Debug, Info, Warn, Error, Assert }

/**
 * Called when a flag's effective value changes: a tester flipped an override,
 * or the app pushed a remote value. Runs on the thread that made the change
 * (a Killcam server thread for dashboard edits), so hop to the main thread
 * before touching UI.
 */
public fun interface KillcamFlagListener {
    public fun onFlagChanged(key: String)
}
