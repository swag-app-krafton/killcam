package com.krafton.killcam.core.flags

import com.krafton.killcam.core.ApiException
import com.krafton.killcam.core.KillcamJson
import com.krafton.killcam.core.model.Flag
import com.krafton.killcam.core.model.FlagSource
import com.krafton.killcam.core.model.FlagType
import com.krafton.killcam.core.store.JsonFile
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import java.util.concurrent.CopyOnWriteArrayList

public fun interface FlagChangeListener {
    public fun onFlagChanged(key: String)
}

/**
 * Feature flags as the app declares them, with Killcam overrides on top.
 *
 * Effective value = override ?? remote ?? default. The app keeps owning its
 * real flag source (Remote Config, its own backend) and pushes values in via
 * [setRemote]; Killcam only adds the override layer testers flip from the
 * dashboard. Overrides persist across restarts, since most flags are read once
 * at startup and a flip that disappears on relaunch is useless.
 *
 * Usable before storage is attached: the app may read flags before
 * `Killcam.install`; those reads just see no overrides yet.
 */
public class FlagRegistry {
    private data class Definition(
        val key: String,
        val type: FlagType,
        val default: String,
        val description: String?,
        val group: String?,
        val options: List<String>?,
    )

    private val lock = Any()
    private val definitions = LinkedHashMap<String, Definition>()
    private val remote = HashMap<String, String>()
    private val overrides = HashMap<String, String>()
    private var storage: JsonFile<Map<String, String>>? = null
    private val listeners = CopyOnWriteArrayList<FlagChangeListener>()

    /** Called by the dashboard layer to broadcast the full list after any change. */
    public var onListChanged: ((List<Flag>) -> Unit)? = null

    public fun attachStorage(file: JsonFile<Map<String, String>>) {
        val stored = file.read().orEmpty()
        synchronized(lock) {
            storage = file
            overrides.putAll(stored)
        }
        stored.keys.forEach(::notify)
    }

    /** Declares a flag (idempotent) and returns its effective value. */
    public fun register(
        key: String,
        type: FlagType,
        default: String,
        description: String? = null,
        group: String? = null,
        options: List<String>? = null,
    ): String {
        val (value, added) = synchronized(lock) {
            val existing = definitions[key]
            val added = existing == null
            definitions[key] = Definition(
                key = key,
                type = type,
                default = default,
                description = description ?: existing?.description,
                group = group ?: existing?.group,
                options = options ?: existing?.options,
            )
            effective(key) to added
        }
        if (added) publishList()
        return value ?: default
    }

    public fun value(key: String): String? = synchronized(lock) { effective(key) }

    public fun typeOf(key: String): FlagType? = synchronized(lock) { definitions[key]?.type }

    public fun groupOf(key: String): String? = synchronized(lock) { definitions[key]?.group }

    public fun overrideOf(key: String): String? = synchronized(lock) { overrides[key] }

    public fun setRemote(key: String, value: String?) {
        val changed = synchronized(lock) {
            val before = effective(key)
            if (value == null) remote.remove(key) else remote[key] = value
            before != effective(key)
        }
        if (changed) notify(key)
        publishList()
    }

    public fun setOverride(key: String, value: String): Flag {
        val definition = synchronized(lock) { definitions[key] } ?: throw ApiException(404, "Unknown flag '$key'")
        val normalized = normalize(definition, value)
        synchronized(lock) { overrides[key] = normalized }
        persist()
        notify(key)
        publishList()
        return list().first { it.key == key }
    }

    public fun clearOverride(key: String?) {
        val cleared = synchronized(lock) {
            if (key == null) overrides.keys.toList().also { overrides.clear() }
            else listOfNotNull(key.takeIf { overrides.remove(it) != null })
        }
        persist()
        cleared.forEach(::notify)
        publishList()
    }

    public fun list(): List<Flag> = synchronized(lock) {
        definitions.values.map { definition ->
            val override = overrides[definition.key]
            val remoteValue = remote[definition.key]
            Flag(
                key = definition.key,
                type = definition.type,
                description = definition.description,
                group = definition.group,
                defaultValue = definition.default,
                remoteValue = remoteValue,
                override = override,
                value = override ?: remoteValue ?: definition.default,
                source = when {
                    override != null -> FlagSource.Override
                    remoteValue != null -> FlagSource.Remote
                    else -> FlagSource.Default
                },
                options = definition.options,
            )
        }
    }

    public fun addListener(listener: FlagChangeListener) {
        listeners += listener
    }

    public fun removeListener(listener: FlagChangeListener) {
        listeners -= listener
    }

    private fun effective(key: String): String? = overrides[key] ?: remote[key] ?: definitions[key]?.default

    private fun normalize(definition: Definition, value: String): String {
        val trimmed = value.trim()
        return when (definition.type) {
            FlagType.Boolean -> when (trimmed.lowercase()) {
                "true", "1", "on", "yes" -> "true"
                "false", "0", "off", "no" -> "false"
                else -> throw ApiException(400, "'$value' is not a boolean")
            }
            FlagType.Int -> trimmed.toLongOrNull()?.toString() ?: throw ApiException(400, "'$value' is not an integer")
            FlagType.Double -> trimmed.toDoubleOrNull()?.toString() ?: throw ApiException(400, "'$value' is not a number")
            FlagType.Json -> runCatching { KillcamJson.parseToJsonElement(trimmed) }
                .map { trimmed }
                .getOrElse { throw ApiException(400, "Invalid JSON: ${it.message}") }
            FlagType.String -> value
        }
    }

    private fun persist() {
        val (file, snapshot) = synchronized(lock) { storage to HashMap(overrides) }
        file?.write(snapshot)
    }

    private fun notify(key: String) {
        for (listener in listeners) runCatching { listener.onFlagChanged(key) }
    }

    private fun publishList() {
        onListChanged?.invoke(list())
    }

    public companion object {
        public val storageSerializer: kotlinx.serialization.KSerializer<Map<String, String>> =
            MapSerializer(String.serializer(), String.serializer())
    }
}
