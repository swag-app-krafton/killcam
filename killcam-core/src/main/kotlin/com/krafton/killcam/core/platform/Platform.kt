package com.krafton.killcam.core.platform

import com.krafton.killcam.core.model.ActionResult
import com.krafton.killcam.core.model.DbInfo
import com.krafton.killcam.core.model.FileEntry
import com.krafton.killcam.core.model.FileRoot
import com.krafton.killcam.core.model.InfoSection
import com.krafton.killcam.core.model.MmkvEntry
import com.krafton.killcam.core.model.MmkvInstance
import com.krafton.killcam.core.model.MmkvUpdate
import com.krafton.killcam.core.model.PrefEntry
import com.krafton.killcam.core.model.PrefFile
import com.krafton.killcam.core.model.QueryResult
import com.krafton.killcam.core.model.RemoteConfigInfo
import com.krafton.killcam.core.model.TimelineEvent
import java.io.File

/** Everything the core needs from the host platform. Android implements it; tests and the demo fake it. */
public interface KillcamPlatform {
    public val appName: String
    public val packageName: String
    public val versionName: String
    public val versionCode: Long
    public val buildType: String
    public val deviceName: String

    /** Device, runtime and app sections for the Device panel. Called per request, so keep it cheap. */
    public fun infoSections(): List<InfoSection>

    public val prefs: PrefsProvider?
    public val databases: DatabaseProvider?
    public val files: FilesProvider?

    /** Null when the app does not ship com.tencent:mmkv. */
    public val mmkv: MmkvProvider?

    /** Null when the app does not ship firebase-config or has no default FirebaseApp. */
    public val remoteConfig: RemoteConfigProvider?

    /** Captures the screen now and records it; null when nothing capturable is on screen. */
    public suspend fun captureScreenshot(trigger: String): TimelineEvent?

    public suspend fun runAction(action: ActionRegistry.Registered): ActionResult

    public suspend fun openDeepLink(uri: String): ActionResult

    /** The device's LAN IPv4 address, for the Wi-Fi sharing URL. */
    public fun lanAddress(): String?
}

public interface PrefsProvider {
    public fun files(): List<PrefFile>
    public fun entries(file: String): List<PrefEntry>?
    public fun put(file: String, entry: PrefEntry): PrefEntry
    public fun remove(file: String, key: String): Boolean
}

public interface DatabaseProvider {
    public fun databases(): List<DbInfo>
    public fun browse(database: String, table: String, offset: Int, limit: Int, orderBy: String?, descending: Boolean): QueryResult
    public fun query(database: String, sql: String): QueryResult
}

public interface FilesProvider {
    public fun roots(): List<FileRoot>
    public fun list(root: String, path: String): List<FileEntry>?
    public fun resolve(root: String, path: String): File?
    public fun delete(root: String, path: String): Boolean
}

public interface MmkvProvider {
    public fun instances(): List<MmkvInstance>
    public fun entries(id: String): List<MmkvEntry>?
    public fun put(id: String, update: MmkvUpdate): MmkvEntry
    public fun remove(id: String, key: String): Boolean
}

/** Raw Remote Config state; `flagOverride` is left null here and filled in by the core. */
public interface RemoteConfigProvider {
    public fun snapshot(): RemoteConfigInfo

    /** Blocking fetch (minimum interval 0) + activate. Never called on the main thread. */
    public fun fetchAndActivate(): RemoteConfigInfo
}

/**
 * [FilesProvider] over plain directories. Every path is canonicalised and must
 * stay inside its root, so `../../` from the dashboard cannot reach other apps'
 * data or system files.
 */
public class DirectoryFilesProvider(private val roots: List<Pair<FileRoot, File>>) : FilesProvider {
    override fun roots(): List<FileRoot> = roots.filter { it.second.exists() }.map { it.first }

    override fun list(root: String, path: String): List<FileEntry>? {
        val base = baseOf(root) ?: return null
        val dir = resolve(root, path) ?: return null
        if (!dir.isDirectory) return null
        return dir.listFiles().orEmpty()
            .map { file ->
                FileEntry(
                    name = file.name,
                    path = file.canonicalFile.relativeTo(base).invariantSeparatorsPath,
                    dir = file.isDirectory,
                    size = if (file.isDirectory) (file.list()?.size ?: 0).toLong() else file.length(),
                    modifiedMs = file.lastModified(),
                )
            }
            .sortedWith(compareByDescending<FileEntry> { it.dir }.thenBy { it.name.lowercase() })
    }

    override fun resolve(root: String, path: String): File? {
        val base = baseOf(root) ?: return null
        val target = File(base, path.trim('/')).canonicalFile
        if (target != base && !target.path.startsWith(base.path + File.separator)) return null
        return target.takeIf { it.exists() }
    }

    override fun delete(root: String, path: String): Boolean {
        val base = baseOf(root) ?: return false
        val target = resolve(root, path) ?: return false
        if (target == base) return false
        return target.deleteRecursively()
    }

    private fun baseOf(root: String): File? = roots.firstOrNull { it.first.id == root }?.second?.canonicalFile
}
