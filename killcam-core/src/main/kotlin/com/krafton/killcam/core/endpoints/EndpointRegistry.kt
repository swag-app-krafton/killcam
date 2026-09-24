package com.krafton.killcam.core.endpoints

import com.krafton.killcam.core.ApiException
import com.krafton.killcam.core.KillcamJson
import com.krafton.killcam.core.model.Endpoint
import com.krafton.killcam.core.model.EndpointCatalog
import com.krafton.killcam.core.model.EndpointInput
import com.krafton.killcam.core.model.EndpointSource
import com.krafton.killcam.core.model.MatchType
import com.krafton.killcam.core.store.JsonFile
import kotlinx.serialization.builtins.ListSerializer

/**
 * The app's named APIs ("/page/fetch", "/data/sync"), so testers pick an
 * endpoint instead of typing URL patterns.
 *
 * Three layers, merged by key, later winning: the catalog file from the app's
 * repo (shipped as a debug asset), endpoints registered in code, and ones
 * testers add from the dashboard (persisted on the device). [export] writes the
 * merged catalog back out in the repo file's format, which is how endpoints
 * found during testing reach GitHub.
 *
 * Usable before storage is attached, like flags: the app may register
 * endpoints before `Killcam.install`.
 */
public class EndpointRegistry {
    private val lock = Any()
    private val repo = LinkedHashMap<String, EndpointInput>()
    private val code = LinkedHashMap<String, EndpointInput>()
    private val dashboard = LinkedHashMap<String, EndpointInput>()
    private var storage: JsonFile<List<EndpointInput>>? = null

    /** Called with the full list after any change. */
    public var onListChanged: ((List<Endpoint>) -> Unit)? = null

    public fun attachStorage(file: JsonFile<List<EndpointInput>>) {
        val stored = file.read().orEmpty()
        synchronized(lock) {
            storage = file
            stored.forEach { dashboard[it.key] = it }
        }
        publish()
    }

    /** Replaces the repo layer with a `killcam-endpoints.json` file's contents. */
    public fun loadCatalog(json: String) {
        val catalog = try {
            KillcamJson.decodeFromString(EndpointCatalog.serializer(), json)
        } catch (e: Exception) {
            throw IllegalArgumentException("Not an endpoint catalog: ${e.message}", e)
        }
        val entries = catalog.endpoints.map { normalize(it) }
        synchronized(lock) {
            repo.clear()
            entries.forEach { repo[it.key] = it }
        }
        publish()
    }

    /** `Killcam.registerEndpoint`: idempotent; the latest registration of a key wins. */
    public fun register(input: EndpointInput) {
        val entry = normalize(input)
        val changed = synchronized(lock) { code.put(entry.key, entry) != entry }
        if (changed) publish()
    }

    /** Adds or replaces a dashboard endpoint. */
    public fun put(input: EndpointInput): Endpoint {
        val entry = normalize(input)
        val snapshot = synchronized(lock) {
            dashboard[entry.key] = entry
            dashboard.values.toList()
        }
        storage?.write(snapshot)
        publish()
        return get(entry.key)!!
    }

    /** Removes a dashboard endpoint (a repo or code one underneath shows again). False if there was none. */
    public fun delete(key: String): Boolean {
        val snapshot = synchronized(lock) {
            if (dashboard.remove(key) == null) return false
            dashboard.values.toList()
        }
        storage?.write(snapshot)
        publish()
        return true
    }

    public fun get(key: String): Endpoint? = list().firstOrNull { it.key == key }

    /** Every endpoint, grouped then sorted by key. */
    public fun list(): List<Endpoint> = synchronized(lock) {
        val keys = LinkedHashSet<String>().apply { addAll(repo.keys); addAll(code.keys); addAll(dashboard.keys) }
        keys.map { key ->
            val fromRepo = repo[key]
            val fromDashboard = dashboard[key]
            val (entry, source) = when {
                fromDashboard != null && fromDashboard != fromRepo -> fromDashboard to EndpointSource.Dashboard
                code[key] != null && fromDashboard == null -> code.getValue(key) to EndpointSource.Code
                else -> (fromRepo ?: fromDashboard!!) to EndpointSource.Repo
            }
            Endpoint(
                key = entry.key,
                name = entry.name,
                method = entry.method,
                urlPattern = entry.urlPattern ?: entry.key,
                matchType = entry.matchType,
                group = entry.group ?: topLevel(entry.key),
                description = entry.description,
                source = source,
                unexported = entry != fromRepo,
            )
        }.sortedWith(compareBy({ it.group }, { it.key }))
    }

    /** The merged catalog in the repo file's format: commit it as `killcam-endpoints.json`. */
    public fun export(): EndpointCatalog = EndpointCatalog(
        endpoints = list().map {
            EndpointInput(
                key = it.key,
                name = it.name,
                method = it.method,
                urlPattern = it.urlPattern.takeIf { pattern -> pattern != it.key },
                matchType = it.matchType,
                group = it.group.takeIf { group -> group != topLevel(it.key) },
                description = it.description,
            )
        },
    )

    private fun publish() {
        onListChanged?.invoke(list())
    }

    private fun normalize(input: EndpointInput): EndpointInput {
        val key = input.key.trim()
        if (key.isEmpty()) throw ApiException(400, "key is required")
        val pattern = input.urlPattern?.trim()?.takeIf { it.isNotEmpty() && it != key }
        if (input.matchType == MatchType.Regex) {
            runCatching { Regex(pattern ?: key) }.onFailure { throw ApiException(400, "Invalid regex: ${it.message}") }
        }
        return input.copy(
            key = key,
            name = input.name?.trim()?.ifEmpty { null },
            method = input.method?.trim()?.uppercase()?.ifEmpty { null },
            urlPattern = pattern,
            group = input.group?.trim()?.ifEmpty { null }?.takeIf { it != topLevel(key) },
            description = input.description?.trim()?.ifEmpty { null },
        )
    }

    public companion object {
        public const val CATALOG_FILE: String = "killcam-endpoints.json"

        public val storageSerializer: kotlinx.serialization.KSerializer<List<EndpointInput>> =
            ListSerializer(EndpointInput.serializer())

        /** "/page/fetch" → "page", "page.fetch" → "page", "https://x/v1/a" → "v1". */
        public fun topLevel(key: String): String {
            val path = key.substringAfter("://", key).let { if ("://" in key) it.substringAfter('/', "") else it }
            return path.split('/', '.', '?').firstOrNull { it.isNotBlank() } ?: key
        }
    }
}
