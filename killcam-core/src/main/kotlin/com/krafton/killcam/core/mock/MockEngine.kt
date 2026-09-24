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
 * Rules survive app restarts (they live in the app's files dir) because the
 * usual reason to mock is to reproduce a backend state across a cold start,
 * e.g. "payment returns 402 on the very first launch".
 */
public class MockEngine(
    private val storage: JsonFile<List<MockRule>>? = null,
    private val clock: () -> Long = System::currentTimeMillis,
    private val onChange: (List<MockRule>) -> Unit = {},
) {
    private val lock = Any()
    private var rules: List<MockRule> = storage?.read().orEmpty().map { it.copy(hits = 0) }
    private val compiled = java.util.concurrent.ConcurrentHashMap<String, Regex>()

    public fun list(): List<MockRule> = synchronized(lock) { rules }

    public fun get(id: String): MockRule? = synchronized(lock) { rules.firstOrNull { it.id == id } }

    public fun create(input: MockRuleInput): MockRule {
        validate(input)
        val rule = MockRule(
            id = Ids.next(), name = input.name.ifBlank { input.urlPattern }, enabled = input.enabled,
            method = input.method?.uppercase()?.ifBlank { null }, urlPattern = input.urlPattern,
            matchType = input.matchType, action = input.action, status = input.status,
            headers = input.headers, body = input.body, delayMs = input.delayMs.coerceIn(0, 120_000),
            failure = input.failure, hits = 0, createdMs = clock(),
        )
        mutate { it + rule }
        return rule
    }

    public fun update(id: String, input: MockRuleInput): MockRule {
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
                    failure = input.failure,
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

    /** The rule that applies to this request, with its hit counter bumped, or null. */
    public fun match(method: String, url: String): MockRule? {
        val hit = synchronized(lock) {
            val index = rules.indexOfFirst { it.enabled && matches(it, method, url) }
            if (index < 0) return null
            val bumped = rules[index].copy(hits = rules[index].hits + 1)
            rules = rules.toMutableList().also { it[index] = bumped }
            bumped
        }
        onChange(list())
        return hit
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

    private fun validate(input: MockRuleInput) {
        if (input.urlPattern.isBlank()) throw ApiException(400, "urlPattern is required")
        if (input.status !in 100..599) throw ApiException(400, "status must be 100..599")
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
