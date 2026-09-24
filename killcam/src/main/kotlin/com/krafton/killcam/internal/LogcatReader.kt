package com.krafton.killcam.internal

import android.os.Process
import android.os.SystemClock
import com.krafton.killcam.core.model.LogKind
import com.krafton.killcam.core.model.LogLevel
import com.krafton.killcam.core.store.KillcamStore
import java.io.BufferedReader
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Copies this process's own logcat into Logs, so `Log.*`, `println`, OkHttp's
 * logging interceptor and React Native's `console.log` (tag ReactNativeJS)
 * all show up without touching app code.
 *
 * It polls with `logcat -d -T <last seen>` instead of tailing: on Android 16
 * (seen on vivo) an app may dump its own logs but a live `logcat` stream
 * from the app's uid delivers the backlog and then nothing, forever.
 * Dumping works on every version, so polling is the one path.
 *
 * Framework and OEM chatter is dropped by tag ([ignoredTags], `Foo*` matches
 * a prefix), and any tag logging faster than [MAX_PER_WINDOW] lines per
 * [WINDOW_MS] is rate-limited with a "suppressed" summary, so a vendor
 * compositor logging every frame cannot push the app's own lines out of the
 * 5,000-entry buffer.
 */
internal class LogcatReader(private val store: KillcamStore, ignoredTags: Set<String>) {
    private val exactIgnored = ignoredTags.filterNot { it.endsWith("*") }.toSet()
    private val prefixIgnored = ignoredTags.filter { it.endsWith("*") }.map { it.dropLast(1) }

    @Volatile private var started = false

    /** Faster while the app is in front; the runtime slows it down in the background. */
    @Volatile var intervalMs: Long = FOREGROUND_INTERVAL_MS

    // Poller thread only.
    private var sinceMs = processStartEpochMs()
    private val seenAtSince = HashSet<String>()
    private val windows = HashMap<String, RateWindow>()

    private class Entry(val key: String, val tsMs: Long, val tid: String, val level: LogLevel, val tag: String, val message: StringBuilder)

    private class RateWindow(var startedAt: Long, var count: Int = 0, var suppressed: Int = 0, var level: LogLevel = LogLevel.Info)

    fun start() {
        if (started) return
        started = true
        thread(name = "killcam-logcat", isDaemon = true, priority = Thread.MIN_PRIORITY) {
            while (true) {
                runCatching { poll() }
                Thread.sleep(intervalMs)
            }
        }
    }

    private fun poll() {
        val since = "%d.%03d".format(sinceMs / 1000, sinceMs % 1000)
        val process = ProcessBuilder(
            "logcat", "-d", "-v", "epoch", "--pid=${Process.myPid()}", "-b", "main,system,crash", "-T", since,
        ).redirectErrorStream(true).start()
        val entries = try {
            process.inputStream.bufferedReader().use(::parse)
        } finally {
            process.waitFor(2, TimeUnit.SECONDS)
            process.destroy()
        }

        // -T is inclusive, so lines stamped exactly `since` come back every poll: skip the ones already shown.
        var newest = sinceMs
        val seenAtNewest = HashSet<String>()
        for (entry in entries) {
            if (entry.tsMs < sinceMs) continue
            if (entry.tsMs == sinceMs && entry.key in seenAtSince) continue
            if (entry.tsMs > newest) {
                newest = entry.tsMs
                seenAtNewest.clear()
            }
            if (entry.tsMs == newest) seenAtNewest += entry.key
            publish(entry)
        }
        if (newest > sinceMs) {
            sinceMs = newest
            seenAtSince.clear()
        }
        seenAtSince += seenAtNewest
        flushSuppressed()
    }

    /** Groups consecutive lines sharing a header: a stack trace logged with `Log.e(tag, msg, t)` becomes one entry. */
    private fun parse(reader: BufferedReader): List<Entry> {
        val entries = ArrayList<Entry>()
        var current: Entry? = null
        var header: String? = null
        while (true) {
            val line = reader.readLine() ?: break
            val match = LINE.matchEntire(line)
            if (match == null) {
                if (!line.startsWith("---------")) current?.message?.append('\n')?.append(line)
                continue
            }
            val (secs, millis, _, tid, level, tag, message) = match.destructured
            val lineHeader = "$secs.$millis/$tid/$level/$tag"
            if (current != null && lineHeader == header) {
                current.message.append('\n').append(message)
                continue
            }
            val parsedLevel = LEVELS[level.first()] ?: continue
            header = lineHeader
            current = Entry(
                key = lineHeader,
                tsMs = secs.toLong() * 1000 + millis.padEnd(3, '0').take(3).toLong(),
                tid = tid,
                level = parsedLevel,
                tag = tag.trim(),
                message = StringBuilder(message),
            ).also(entries::add)
        }
        return entries
    }

    private fun publish(entry: Entry) {
        if (entry.tag in exactIgnored || prefixIgnored.any(entry.tag::startsWith)) return
        val now = SystemClock.elapsedRealtime()
        val window = windows.getOrPut(entry.tag) { RateWindow(now) }
        if (now - window.startedAt >= WINDOW_MS) {
            report(entry.tag, window)
            window.startedAt = now
            window.count = 0
        }
        // Errors are never rate-limited: they are the lines worth keeping.
        if (++window.count > MAX_PER_WINDOW && entry.level < LogLevel.Error) {
            window.suppressed++
            window.level = maxOf(window.level, entry.level)
            return
        }
        store.log(
            level = entry.level,
            tag = entry.tag,
            message = entry.message.toString(),
            kind = LogKind.Logcat,
            thread = "tid ${entry.tid}",
            ts = entry.tsMs,
        )
    }

    private fun flushSuppressed() {
        val now = SystemClock.elapsedRealtime()
        for ((tag, window) in windows) {
            if (window.suppressed > 0 && now - window.startedAt >= WINDOW_MS) report(tag, window)
        }
    }

    private fun report(tag: String, window: RateWindow) {
        if (window.suppressed == 0) return
        store.log(
            level = window.level,
            tag = tag,
            message = "… ${window.suppressed} more lines from $tag suppressed (over $MAX_PER_WINDOW per ${WINDOW_MS / 1000}s). " +
                "Hide noisy tags with KillcamConfig(ignoredLogTags = …).",
            kind = LogKind.Logcat,
            thread = null,
        )
        window.suppressed = 0
        window.level = LogLevel.Info
    }

    private fun processStartEpochMs(): Long =
        System.currentTimeMillis() - (SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime())

    companion object {
        const val FOREGROUND_INTERVAL_MS = 1_000L
        const val BACKGROUND_INTERVAL_MS = 5_000L
        private const val WINDOW_MS = 5_000L
        private const val MAX_PER_WINDOW = 40

        // "1727165432.123  1234  1256 D Tag     : message"
        private val LINE = Regex("""^\s*(\d+)\.(\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*:(?: (.*))?$""")
        private val LEVELS = mapOf(
            'V' to LogLevel.Verbose, 'D' to LogLevel.Debug, 'I' to LogLevel.Info,
            'W' to LogLevel.Warn, 'E' to LogLevel.Error, 'F' to LogLevel.Assert, 'A' to LogLevel.Assert,
        )
    }
}
