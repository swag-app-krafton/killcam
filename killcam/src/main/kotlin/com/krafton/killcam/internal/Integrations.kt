package com.krafton.killcam.internal

import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.google.android.gms.tasks.Tasks
import com.krafton.killcam.core.ApiException
import com.krafton.killcam.core.model.MmkvEntry
import com.krafton.killcam.core.model.MmkvInstance
import com.krafton.killcam.core.model.MmkvUpdate
import com.krafton.killcam.core.model.MmkvValueType
import com.krafton.killcam.core.model.RemoteConfigFetchStatus
import com.krafton.killcam.core.model.RemoteConfigInfo
import com.krafton.killcam.core.model.RemoteConfigSource
import com.krafton.killcam.core.model.RemoteConfigValue
import com.krafton.killcam.core.platform.MmkvProvider
import com.krafton.killcam.core.platform.RemoteConfigProvider
import com.tencent.mmkv.MMKV
import java.util.Base64
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * Optional integrations. Killcam compiles against MMKV and Firebase Remote
 * Config but does not ship them: each provider is only created when its
 * library is on the app's classpath, checked by name so these classes are
 * never loaded otherwise.
 */
internal object Integrations {
    fun mmkv(registry: Map<String, MmkvRegistration>): MmkvProvider? =
        if (present("com.tencent.mmkv.MMKV")) AndroidMmkvProvider(registry) else null

    fun remoteConfig(): RemoteConfigProvider? =
        if (present("com.google.firebase.remoteconfig.FirebaseRemoteConfig")) AndroidRemoteConfigProvider() else null

    private fun present(className: String) = runCatching { Class.forName(className) }.isSuccess
}

internal data class MmkvRegistration(val cryptKey: String?, val multiProcess: Boolean)

/**
 * Tencent MMKV stores. Only the default instance and ids the app registered
 * are ever opened: opening an encrypted store without its key fails MMKV's CRC
 * check, and its default recovery is to discard the file.
 */
internal class AndroidMmkvProvider(private val registry: Map<String, MmkvRegistration>) : MmkvProvider {

    override fun instances(): List<MmkvInstance> {
        requireInitialized()
        return (listOf(DEFAULT_ID) + registry.keys.sorted()).distinct().map { id ->
            runCatching {
                val store = open(id) ?: error("not registered")
                MmkvInstance(id, store.count().toInt(), store.totalSize(), store.cryptKey() != null, null)
            }.getOrElse { MmkvInstance(id, 0, 0, registry[id]?.cryptKey != null, it.message ?: it.javaClass.simpleName) }
        }
    }

    override fun entries(id: String): List<MmkvEntry>? {
        requireInitialized()
        val store = open(id) ?: return null
        return store.allKeys().orEmpty().sorted().map { key -> read(store, key) }
    }

    override fun put(id: String, update: MmkvUpdate): MmkvEntry {
        requireInitialized()
        val store = open(id) ?: throw ApiException(404, "No MMKV instance '$id'")
        val value = update.value.trim()
        val ok = try {
            when (update.type) {
                MmkvValueType.String -> store.encode(update.key, update.value)
                MmkvValueType.Bool -> store.encode(update.key, value.toBooleanStrict())
                MmkvValueType.Int -> store.encode(update.key, value.toInt())
                MmkvValueType.Long -> store.encode(update.key, value.toLong())
                MmkvValueType.Float -> store.encode(update.key, value.toFloat())
                MmkvValueType.Double -> store.encode(update.key, value.toDouble())
                MmkvValueType.Bytes -> store.encode(update.key, Base64.getDecoder().decode(value))
            }
        } catch (e: IllegalArgumentException) {
            throw ApiException(400, "'${update.value}' is not a valid ${update.type.name.lowercase()}")
        }
        if (!ok) throw ApiException(500, "MMKV refused the write")
        return MmkvEntry(update.key, update.type, update.value, store.getValueSize(update.key).toLong())
    }

    override fun remove(id: String, key: String): Boolean {
        requireInitialized()
        val store = open(id) ?: return false
        if (!store.containsKey(key)) return false
        store.removeValueForKey(key)
        return true
    }

    private fun requireInitialized() {
        if (MMKV.getRootDir() == null) throw ApiException(409, "MMKV.initialize() has not been called yet")
    }

    private fun open(id: String): MMKV? {
        if (id == DEFAULT_ID) return MMKV.defaultMMKV()
        val registration = registry[id] ?: return null
        val mode = if (registration.multiProcess) MMKV.MULTI_PROCESS_MODE else MMKV.SINGLE_PROCESS_MODE
        return MMKV.mmkvWithID(id, mode, registration.cryptKey)
    }

    /**
     * MMKV keeps raw bytes, so the type is inferred from the encoding:
     * length-prefixed values are strings or bytes, one byte is a bool (or a
     * small int), eight bytes a double (react-native-mmkv's number), four a
     * float, anything else a varint integer.
     */
    private fun read(store: MMKV, key: String): MmkvEntry {
        val size = store.getValueSize(key)
        val actual = store.getValueActualSize(key)
        return when {
            size == 1 -> {
                val value = store.decodeInt(key)
                if (value == 0 || value == 1) MmkvEntry(key, MmkvValueType.Bool, (value == 1).toString(), 1)
                else MmkvEntry(key, MmkvValueType.Int, value.toString(), 1)
            }
            actual in 0 until size -> {
                val bytes = store.decodeBytes(key) ?: ByteArray(0)
                val text = runCatching { Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString() }.getOrNull()
                if (text != null && text.none { it.isISOControl() && it !in "\n\r\t" }) {
                    MmkvEntry(key, MmkvValueType.String, text, size.toLong())
                } else {
                    MmkvEntry(key, MmkvValueType.Bytes, Base64.getEncoder().encodeToString(bytes), size.toLong())
                }
            }
            size == 8 -> {
                val double = store.decodeDouble(key)
                if (double.isFinite() && (double == 0.0 || abs(double) > 1e-300)) {
                    MmkvEntry(key, MmkvValueType.Double, double.toString(), 8)
                } else {
                    MmkvEntry(key, MmkvValueType.Long, store.decodeLong(key).toString(), 8)
                }
            }
            size == 4 -> MmkvEntry(key, MmkvValueType.Float, store.decodeFloat(key).toString(), 4)
            else -> MmkvEntry(key, MmkvValueType.Long, store.decodeLong(key).toString(), size.toLong())
        }
    }

    private companion object {
        const val DEFAULT_ID = "mmkv.default"
    }
}

/**
 * Firebase Remote Config as the app sees it right now: every active value
 * with its source, and the last fetch's status. Also used by the core to
 * mirror keys into Flags.
 */
internal class AndroidRemoteConfigProvider : RemoteConfigProvider {
    override fun snapshot(): RemoteConfigInfo {
        val config = instance()
        val info = config.info
        return RemoteConfigInfo(
            fetchStatus = when (info.lastFetchStatus) {
                FirebaseRemoteConfig.LAST_FETCH_STATUS_SUCCESS -> RemoteConfigFetchStatus.Success
                FirebaseRemoteConfig.LAST_FETCH_STATUS_FAILURE -> RemoteConfigFetchStatus.Failure
                FirebaseRemoteConfig.LAST_FETCH_STATUS_THROTTLED -> RemoteConfigFetchStatus.Throttled
                else -> RemoteConfigFetchStatus.NoFetchYet
            },
            lastFetchMs = info.fetchTimeMillis.takeIf { it > 0 },
            minimumFetchIntervalSeconds = info.configSettings.minimumFetchIntervalInSeconds,
            fetchTimeoutSeconds = info.configSettings.fetchTimeoutInSeconds,
            values = config.all.entries.sortedBy { it.key }.map { (key, value) ->
                RemoteConfigValue(
                    key = key,
                    value = value.asString(),
                    source = when (value.source) {
                        FirebaseRemoteConfig.VALUE_SOURCE_REMOTE -> RemoteConfigSource.Remote
                        FirebaseRemoteConfig.VALUE_SOURCE_DEFAULT -> RemoteConfigSource.Default
                        else -> RemoteConfigSource.Static
                    },
                    flagOverride = null,
                )
            },
        )
    }

    override fun fetchAndActivate(): RemoteConfigInfo {
        val config = instance()
        val timeout = config.info.configSettings.fetchTimeoutInSeconds + 5
        try {
            Tasks.await(config.fetch(0), timeout, TimeUnit.SECONDS)
            Tasks.await(config.activate(), 10, TimeUnit.SECONDS)
        } catch (_: ExecutionException) {
            // Throttled or offline: the snapshot's fetchStatus says which.
        } catch (_: java.util.concurrent.TimeoutException) {
            // Same: report whatever state Remote Config is in.
        }
        return snapshot()
    }

    private fun instance(): FirebaseRemoteConfig = try {
        FirebaseRemoteConfig.getInstance()
    } catch (e: IllegalStateException) {
        throw ApiException(503, "Firebase is not initialized in this process: ${e.message}")
    }
}
