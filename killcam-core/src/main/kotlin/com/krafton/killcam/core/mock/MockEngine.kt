package com.krafton.killcam.core.mock

import com.krafton.killcam.core.ApiException
import com.krafton.killcam.core.Ids
import com.krafton.killcam.core.model.MatchType
import com.krafton.killcam.core.model.MockRule
import com.krafton.killcam.core.model.MockRuleInput
import com.krafton.killcam.core.store.JsonFile
import kotlinx.serialization.builtins.ListSerializer

/**
 * Mock rules, evaluated in list order; the first enabled match wins.
 *
 * A rule limited by `times` stops matching once used up, and a rule with a
 * `probability` below 100 skips the calls it loses the roll for; either way
 * the call falls through to later rules, then to the real network. That is
 * what makes "fail once, succeed on retry" and "30% of calls 503" possible.
 *
 * Rules survive app restarts (they live in the app's files dir) because the
 * usual reason to mock is to reproduce a backend state across a cold start,
 * e.g. "payment returns 402 on the very first launch".
 */
public class MockEngine(
    private val storage: JsonFile<List<MockRule>>? = null,
    private val clock: () -> Long = System::currentTimeMillis,
    private val random: kotlin.random.Random = kotlin.random.Random.Default,
    /** Resolves `endpoint` keys in rule inputs; rules keep a copy of the match, so they outlive the endpoint. */
    private val endpoints: com.krafton.killcam.core.endpoints.EndpointRegistry? = null,
    private val onChange: (List<MockRule>) -> Unit = {},
) {
    private val lock = Any()
    private var rules: List<MockRule> = storage?.read().orEmpty().map { it.copy(hits = 0) }
    private val compiled = java.util.concurrent.ConcurrentHashMap<String, Regex>()

    public fun list(): List<MockRule> = synchronized(lock) { rules }

    public fun get(id: String): MockRule? = synchronized(lock) { rules.firstOrNull { it.id == id } }

    public fun create(request: MockRuleInput): MockRule {
        val input = resolve(request)
        validate(input)
        val rule = MockRule(
            id = Ids.next(), name = input.name.ifBlank { input.urlPattern }, enabled = input.enabled,
            method = input.method?.uppercase()?.ifBlank { null }, urlPattern = input.urlPattern,
            matchType = input.matchType, action = input.action, status = input.status,
            headers = input.headers, body = input.body, delayMs = input.delayMs.coerceIn(0, 120_000),
            failure = input.failure, hits = 0, createdMs = clock(),
            dropAfterBytes = input.dropAfterBytes, times = input.times, probability = input.probability,
            endpoint = input.endpoint, breakOn = input.breakOn,
        )
        mutate { it + rule }
        return rule
    }

    public fun update(id: String, request: MockRuleInput): MockRule {
        val input = resolve(request)
        validate(input)
        var updated: MockRule? = null
        mutate { current ->
            current.map { rule ->
                if (rule.id != id) return@map rule
                rule.copy(
                    name = input.name.ifBlank { input.urlPattern }, enabled = input.enabled,
                    method = input.method?.uppercase()?.ifBlank { null }, urlPattern = input.urlPattern,
                    matchType = input.matchType, action = input.action, status = input.status,
                    headers = input.headers, body = input.body, delayMs = input.delayMs.coerceIn(0, 120_000),
                    failure = input.failure, dropAfterBytes = input.dropAfterBytes,
                    times = input.times, probability = input.probability,
                    endpoint = input.endpoint, breakOn = input.breakOn,
                    // A new limit re-arms the rule; otherwise the count carries on.
                    hits = if (input.times != rule.times) 0 else rule.hits,
                ).also { updated = it }
            }
        }
        return updated ?: throw ApiException(404, "No mock rule '$id'")
    }

    public fun delete(id: String): Boolean {
        var removed = false
        mutate { current -> current.filterNot { (it.id == id).also { hit -> if (hit) removed = true } } }
        return removed
    }

    /** Reorders rules to follow [ids]; unknown ids are ignored, unmentioned rules keep their relative order at the end. */
    public fun reorder(ids: List<String>) {
        mutate { current ->
            val byId = current.associateBy { it.id }
            val ordered = ids.mapNotNull { byId[it] }
            ordered + current.filter { it.id !in ids }
        }
    }

    /** Zeroes a rule's hit counter, which re-arms a rule limited by `times`. */
    public fun resetHits(id: String): MockRule {
        var reset: MockRule? = null
        mutate { current -> current.map { if (it.id == id) it.copy(hits = 0).also { r -> reset = r } else it } }
        return reset ?: throw ApiException(404, "No mock rule '$id'")
    }

    /** The rule that applies to this request, with its hit counter bumped, or null. */
    public fun match(method: String, url: String): MockRule? {
        val hit = synchronized(lock) {
            val index = rules.indexOfFirst { applies(it, method, url) }
            if (index < 0) return null
            val bumped = rules[index].copy(hits = rules[index].hits + 1)
            rules = rules.toMutableList().also { it[index] = bumped }
            bumped
        }
        onChange(list())
        return hit
    }

    /** Caller holds [lock]. Matching, not used up, and (for a partial rule) won the roll. */
    private fun applies(rule: MockRule, method: String, url: String): Boolean {
        if (!rule.enabled || rule.exhausted || !matches(rule, method, url)) return false
        return rule.probability >= 100 || random.nextInt(100) < rule.probability
    }

    public fun matches(rule: MockRule, method: String, url: String): Boolean {
        if (rule.method != null && !rule.method.equals(method, ignoreCase = true)) return false
        return when (rule.matchType) {
            MatchType.Contains -> url.contains(rule.urlPattern)
            MatchType.Exact -> url == rule.urlPattern
            MatchType.Glob -> regexFor(rule, globToRegex(rule.urlPattern))?.matches(url) == true
            MatchType.Regex -> regexFor(rule, rule.urlPattern)?.containsMatchIn(url) == true
        }
    }

    private fun regexFor(rule: MockRule, pattern: String): Regex? =
        compiled.getOrPut(rule.id + "\u0000" + pattern) {
            runCatching { Regex(pattern) }.getOrElse { return null }
        }

    /** Fills method and match from the catalog endpoint the input names, if any. */
    private fun resolve(input: MockRuleInput): MockRuleInput {
        val key = input.endpoint?.trim()?.ifEmpty { null } ?: return input.copy(endpoint = null)
        val endpoint = endpoints?.get(key) ?: throw ApiException(400, "No endpoint '$key' in the catalog")
        return input.copy(
            endpoint = endpoint.key,
            name = input.name.ifBlank { endpoint.name ?: endpoint.key },
            method = input.method?.ifBlank { null } ?: endpoint.method,
            urlPattern = endpoint.urlPattern,
            matchType = endpoint.matchType,
        )
    }

    private fun validate(input: MockRuleInput) {
        if (input.urlPattern.isBlank()) throw ApiException(400, "urlPattern is required")
        if (input.status !in 100..599) throw ApiException(400, "status must be 100..599")
        if (input.times < 0) throw ApiException(400, "times must be 0 (always) or more")
        if (input.probability !in 1..100) throw ApiException(400, "probability must be 1..100")
        if (input.dropAfterBytes < 0) throw ApiException(400, "dropAfterBytes must be 0 or more")
        if (input.matchType == MatchType.Regex) {
            runCatching { Regex(input.urlPattern) }.onFailure { throw ApiException(400, "Invalid regex: ${it.message}") }
        }
    }

    private fun mutate(block: (List<MockRule>) -> List<MockRule>) {
        val snapshot = synchronized(lock) {
            rules = block(rules)
            compiled.clear()
            rules
        }
        storage?.write(snapshot)
        onChange(snapshot)
    }

    public companion object {
        public fun storageSerializer(): kotlinx.serialization.KSerializer<List<MockRule>> =
            ListSerializer(MockRule.serializer())

        /** `*` spans anything, `?` one character; everything else is literal. */
        public fun globToRegex(glob: String): String = buildString {
            append('^')
            for (c in glob) {
                when (c) {
                    '*' -> append(".*")
                    '?' -> append('.')
                    else -> append(Regex.escape(c.toString()))
                }
            }
            append('$')
        }
    }
}
