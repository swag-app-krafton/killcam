package com.krafton.killcam.core.session

import com.krafton.killcam.core.Ids
import com.krafton.killcam.core.KillcamJson
import com.krafton.killcam.core.model.SessionBundle
import com.krafton.killcam.core.model.SessionSummary
import com.krafton.killcam.core.store.JsonFile
import kotlinx.serialization.json.JsonObject
import java.io.File
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Session data on disk: `<root>/<sessionId>/screenshots/<id>.jpg`, plus
 * `session.json` (the full [SessionBundle]) and `summary.json` once a session
 * is saved, either by a tester or by the crash handler as the process dies.
 *
 * On startup, directories of earlier sessions that were never saved are
 * deleted: their screenshots belong to a run nobody asked to keep.
 */
public class SessionStore(
    private val root: File,
    public val liveId: String,
    private val maxSaved: Int = 10,
    private val maxScreenshots: Int = 300,
) {
    private val lock = Any()
    private val liveShots = ArrayDeque<String>()

    init {
        root.mkdirs()
        shotsDir(liveId).mkdirs()
        prune()
    }

    private fun dirOf(id: String): File = File(root, id)

    private fun shotsDir(id: String): File = File(dirOf(id), "screenshots")

    private fun summaryFile(id: String) = JsonFile(File(dirOf(id), "summary.json"), SessionSummary.serializer())

    private fun bundleFile(id: String) = JsonFile(File(dirOf(id), "session.json"), SessionBundle.serializer())

    // ------------------------------------------------------ screenshots ----

    /** Stores a JPEG for the live session and returns its id; the oldest are dropped past the cap. */
    public fun saveScreenshot(jpeg: ByteArray): String {
        val id = Ids.next()
        File(shotsDir(liveId), "$id.jpg").writeBytes(jpeg)
        val evicted = synchronized(lock) {
            liveShots.addLast(id)
            buildList { while (liveShots.size > maxScreenshots) add(liveShots.removeFirst()) }
        }
        evicted.forEach { File(shotsDir(liveId), "$it.jpg").delete() }
        return id
    }

    public fun screenshot(sessionId: String, shotId: String): File? {
        if (!Ids.isSafe(sessionId) || !Ids.isSafe(shotId)) return null
        return File(shotsDir(sessionId), "$shotId.jpg").takeIf { it.isFile }
    }

    public fun screenshotCount(sessionId: String): Int =
        if (sessionId == liveId) synchronized(lock) { liveShots.size }
        else shotsDir(sessionId).list()?.size ?: 0

    // --------------------------------------------------------- sessions ----

    /**
     * Persists [bundle] under its session id. For the live session (crash
     * path) that is the live directory itself; a manual save uses a new id and
     * copies the screenshots so the snapshot stays intact as the session goes on.
     */
    public fun save(bundle: SessionBundle) {
        val id = bundle.session.id
        require(Ids.isSafe(id)) { "Bad session id" }
        if (id != liveId) {
            val target = shotsDir(id).apply { mkdirs() }
            val referenced = bundle.timeline.mapNotNull { it.screenshotId }.toSet()
            for (shot in referenced) {
                val source = File(shotsDir(liveId), "$shot.jpg")
                if (source.isFile) source.copyTo(File(target, "$shot.jpg"), overwrite = true)
            }
        }
        bundleFile(id).write(bundle)
        summaryFile(id).write(bundle.session)
    }

    public fun saved(): List<SessionSummary> =
        root.listFiles().orEmpty()
            .filter { it.isDirectory }
            .mapNotNull { summaryFile(it.name).read() }
            .sortedByDescending { it.startMs }

    public fun load(id: String): SessionBundle? =
        if (Ids.isSafe(id)) bundleFile(id).read() else null

    public fun delete(id: String): Boolean {
        if (!Ids.isSafe(id) || id == liveId) return false
        return dirOf(id).takeIf { it.isDirectory }?.deleteRecursively() ?: false
    }

    /** Writes a bug bundle zip: session.json, network.har, screenshots, and a README for whoever receives it. */
    public fun export(bundle: SessionBundle, har: JsonObject, out: OutputStream) {
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry("session.json"))
            zip.write(KillcamJson.encodeToString(SessionBundle.serializer(), bundle).toByteArray())
            zip.closeEntry()

            zip.putNextEntry(ZipEntry("network.har"))
            zip.write(KillcamJson.encodeToString(JsonObject.serializer(), har).toByteArray())
            zip.closeEntry()

            val shots = bundle.timeline.mapNotNull { it.screenshotId }.distinct()
            for (shot in shots) {
                val file = screenshot(bundle.session.id, shot) ?: continue
                zip.putNextEntry(ZipEntry("screenshots/$shot.jpg"))
                file.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }

            zip.putNextEntry(ZipEntry("README.txt"))
            zip.write(readme(bundle).toByteArray())
            zip.closeEntry()
        }
    }

    private fun readme(bundle: SessionBundle): String = buildString {
        appendLine("Killcam bug bundle")
        appendLine("==================")
        appendLine("App:      ${bundle.app.appName} ${bundle.app.versionName} (${bundle.app.versionCode}) ${bundle.app.buildType}")
        appendLine("Device:   ${bundle.app.deviceName}")
        appendLine("Session:  ${bundle.session.id} (${bundle.session.reason.name.lowercase()})")
        bundle.session.crash?.let { appendLine("Crash:    ${it.exception}: ${it.message ?: ""}") }
        appendLine()
        appendLine("session.json   network calls, logs, crashes and the replay timeline")
        appendLine("network.har    open in Chrome DevTools, Charles or Proxyman")
        appendLine("screenshots/   frames referenced by timeline events (screenshotId)")
    }

    private fun prune() {
        val dirs = root.listFiles().orEmpty().filter { it.isDirectory && it.name != liveId }
        val (saved, unsaved) = dirs.partition { File(it, "summary.json").isFile }
        unsaved.forEach { it.deleteRecursively() }
        saved.sortedByDescending { it.name }.drop(maxSaved).forEach { it.deleteRecursively() }
    }
}
