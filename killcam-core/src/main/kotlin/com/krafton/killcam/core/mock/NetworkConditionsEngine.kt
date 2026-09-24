package com.krafton.killcam.core.mock

import com.krafton.killcam.core.ApiException
import com.krafton.killcam.core.model.MockFailure
import com.krafton.killcam.core.model.NetworkConditions
import com.krafton.killcam.core.model.NetworkConditionsInput
import com.krafton.killcam.core.model.NetworkPreset
import com.krafton.killcam.core.model.NetworkProfile
import com.krafton.killcam.core.store.JsonFile

/**
 * The simulated network every intercepted call goes through: latency,
 * bandwidth caps, loss, or no connectivity at all.
 *
 * Persisted like mock rules, so a cold start can be reproduced on a slow
 * network. This class only decides; KillcamInterceptor sleeps, throttles
 * and throws.
 */
public class NetworkConditionsEngine(
    private val storage: JsonFile<NetworkConditions>? = null,
    private val random: kotlin.random.Random = kotlin.random.Random.Default,
    private val onChange: (NetworkConditions) -> Unit = {},
) {
    @Volatile
    private var current: NetworkConditions = storage?.read() ?: NetworkConditions()

    public fun get(): NetworkConditions = current

    public fun set(input: NetworkConditionsInput): NetworkConditions {
        val profile = input.profile
        val next = if (profile != null && profile != NetworkProfile.Custom) {
            preset(profile)
        } else {
            validate(input)
            NetworkConditions(
                profile = NetworkProfile.Custom,
                latencyMs = input.latencyMs,
                jitterMs = input.jitterMs,
                downloadKbps = input.downloadKbps,
                uploadKbps = input.uploadKbps,
                lossPercent = input.lossPercent,
                offline = input.offline,
            ).let { if (it.active) it else NetworkConditions() }
        }
        return set(next)
    }

    public fun clear(): NetworkConditions = set(NetworkConditions())

    private fun set(next: NetworkConditions): NetworkConditions {
        if (next == current) return next
        current = next
        storage?.write(next)
        onChange(next)
        return next
    }

    /** What to do to the next call, or null when the network is untouched. */
    public fun plan(): Plan? {
        val c = current
        if (!c.active) return null
        val failure = when {
            c.offline -> MockFailure.DnsFailure
            c.lossPercent > 0 && random.nextInt(100) < c.lossPercent ->
                // A lost packet surfaces as whichever gives up first: the read timer or the peer.
                if (random.nextBoolean()) MockFailure.Timeout else MockFailure.ConnectionReset
            else -> null
        }
        val jitter = if (c.jitterMs > 0) random.nextLong(c.jitterMs + 1) else 0
        return Plan(
            delayMs = if (c.offline) 0 else c.latencyMs + jitter,
            failure = failure,
            downloadBytesPerSecond = c.downloadKbps * 1000 / 8,
            uploadBytesPerSecond = c.uploadKbps * 1000 / 8,
        )
    }

    /** Rates are bytes per second; 0 means unlimited. */
    public data class Plan(
        val delayMs: Long,
        val failure: MockFailure?,
        val downloadBytesPerSecond: Long,
        val uploadBytesPerSecond: Long,
    )

    private fun validate(input: NetworkConditionsInput) {
        if (input.latencyMs !in 0..MAX_LATENCY_MS) throw ApiException(400, "latencyMs must be 0..$MAX_LATENCY_MS")
        if (input.jitterMs !in 0..MAX_LATENCY_MS) throw ApiException(400, "jitterMs must be 0..$MAX_LATENCY_MS")
        if (input.downloadKbps < 0 || input.uploadKbps < 0) throw ApiException(400, "Kbps must be 0 (unlimited) or more")
        if (input.lossPercent !in 0..100) throw ApiException(400, "lossPercent must be 0..100")
    }

    public companion object {
        private const val MAX_LATENCY_MS = 60_000L

        public fun storageSerializer(): kotlinx.serialization.KSerializer<NetworkConditions> =
            NetworkConditions.serializer()

        /** Built-in profiles. Numbers follow common emulator and DevTools profiles, rounded. */
        public val PRESETS: List<NetworkPreset> = listOf(
            NetworkPreset(NetworkProfile.Gprs, "GPRS", "500 ms, 50/20 kbps, 2% loss",
                NetworkConditions(NetworkProfile.Gprs, 500, 200, 50, 20, 2)),
            NetworkPreset(NetworkProfile.Edge, "2G (EDGE)", "300 ms, 250/50 kbps, 1% loss",
                NetworkConditions(NetworkProfile.Edge, 300, 100, 250, 50, 1)),
            NetworkPreset(NetworkProfile.Slow3g, "Slow 3G", "400 ms, 400/400 kbps",
                NetworkConditions(NetworkProfile.Slow3g, 400, 100, 400, 400, 0)),
            NetworkPreset(NetworkProfile.Fast3g, "Fast 3G", "150 ms, 1.6 Mbps/750 kbps",
                NetworkConditions(NetworkProfile.Fast3g, 150, 50, 1_600, 750, 0)),
            NetworkPreset(NetworkProfile.Lte, "4G", "50 ms, 12/6 Mbps",
                NetworkConditions(NetworkProfile.Lte, 50, 20, 12_000, 6_000, 0)),
            NetworkPreset(NetworkProfile.FlakyWifi, "Flaky Wi-Fi", "80 ms ± 600 ms, 2/1 Mbps, 10% loss",
                NetworkConditions(NetworkProfile.FlakyWifi, 80, 600, 2_000, 1_000, 10)),
            NetworkPreset(NetworkProfile.Offline, "Offline", "Every call fails DNS resolution",
                NetworkConditions(NetworkProfile.Offline, offline = true)),
        )

        public fun preset(profile: NetworkProfile): NetworkConditions =
            if (profile == NetworkProfile.Off) NetworkConditions()
            else PRESETS.firstOrNull { it.profile == profile }?.conditions
                ?: throw ApiException(400, "No preset '$profile'")

        /** "Slow 3G", "Custom", "Off": how a change is labelled on the timeline. */
        public fun label(conditions: NetworkConditions): String = when (conditions.profile) {
            NetworkProfile.Off -> "Off"
            NetworkProfile.Custom -> buildList {
                if (conditions.offline) add("offline")
                if (conditions.latencyMs > 0 || conditions.jitterMs > 0) {
                    add("${conditions.latencyMs} ms" + if (conditions.jitterMs > 0) " ± ${conditions.jitterMs}" else "")
                }
                if (conditions.downloadKbps > 0) add("↓${conditions.downloadKbps} kbps")
                if (conditions.uploadKbps > 0) add("↑${conditions.uploadKbps} kbps")
                if (conditions.lossPercent > 0) add("${conditions.lossPercent}% loss")
            }.joinToString(", ", prefix = "Custom (", postfix = ")")
            else -> PRESETS.first { it.profile == conditions.profile }.label
        }
    }
}
