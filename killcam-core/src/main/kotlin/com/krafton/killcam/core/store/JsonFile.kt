package com.krafton.killcam.core.store

import com.krafton.killcam.core.KillcamJson
import kotlinx.serialization.KSerializer
import java.io.File

/**
 * A value persisted as one JSON file, written via temp-file + rename so a
 * crash mid-write (Killcam runs in apps being debugged, crashes are the point)
 * leaves the previous version rather than a truncated file.
 */
public class JsonFile<T>(private val file: File, private val serializer: KSerializer<T>) {
    public fun read(): T? = runCatching {
        if (!file.isFile) return null
        KillcamJson.decodeFromString(serializer, file.readText())
    }.getOrNull()

    public fun write(value: T) {
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, file.name + ".tmp")
        temp.writeText(KillcamJson.encodeToString(serializer, value))
        if (!temp.renameTo(file)) {
            file.delete()
            temp.renameTo(file)
        }
    }
}
