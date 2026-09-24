package com.krafton.killcam.core

import com.krafton.killcam.core.mock.MockEngine
import com.krafton.killcam.core.mock.NetworkConditionsEngine
import com.krafton.killcam.core.model.MockAction
import com.krafton.killcam.core.model.MockFailure
import com.krafton.killcam.core.model.MockRule
import com.krafton.killcam.core.model.MockRuleInput
import com.krafton.killcam.core.model.NetworkConditions
import com.krafton.killcam.core.model.NetworkConditionsInput
import com.krafton.killcam.core.model.NetworkProfile
import com.krafton.killcam.core.store.JsonFile
import org.junit.Test
import java.nio.file.Files
import kotlin.random.Random
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NetworkFaultsTest {
    private val pay = "https://api.swag.gg/v1/upi/pay"

    @Test
    fun ruleWithTimesFailsOnceThenLetsTheRetryThrough() {
        val engine = MockEngine()
        val rule = engine.create(
            MockRuleInput(name = "dns once", urlPattern = "/upi/pay", action = MockAction.Fail, failure = MockFailure.DnsFailure, times = 1),
        )
        assertEquals(rule.id, engine.match("POST", pay)?.id)
        assertNull(engine.match("POST", pay), "the retry must reach the real network")
        assertTrue(engine.get(rule.id)!!.exhausted)

        engine.resetHits(rule.id)
        assertEquals(rule.id, engine.match("POST", pay)?.id)
    }

    @Test
    fun exhaustedRuleFallsThroughToTheNextOne() {
        val engine = MockEngine()
        val first = engine.create(MockRuleInput(name = "503 twice", urlPattern = "/upi", status = 503, times = 2))
        val second = engine.create(MockRuleInput(name = "then 200", urlPattern = "/upi", status = 200))
        assertEquals(listOf(first.id, first.id, second.id), List(3) { engine.match("GET", pay)?.id })
    }

    @Test
    fun changingTimesReArmsTheRule() {
        val engine = MockEngine()
        val rule = engine.create(MockRuleInput(name = "x", urlPattern = "/upi", times = 1))
        engine.match("GET", pay)
        val updated = engine.update(rule.id, MockRuleInput(name = "x", urlPattern = "/upi", times = 2))
        assertEquals(0, updated.hits)
        engine.match("GET", pay)
        val renamed = engine.update(rule.id, MockRuleInput(name = "y", urlPattern = "/upi", times = 2))
        assertEquals(1, renamed.hits, "an edit that keeps the limit keeps the count")
    }

    @Test
    fun probabilityAppliesToRoughlyThatShareOfCalls() {
        val engine = MockEngine(random = Random(42))
        engine.create(MockRuleInput(name = "flaky", urlPattern = "/upi", status = 503, probability = 30))
        val applied = (0 until 2_000).count { engine.match("GET", pay) != null }
        assertTrue(applied in 500..700, "applied $applied of 2000")
    }

    @Test
    fun rejectsOutOfRangeRuleFields() {
        val engine = MockEngine()
        assertFailsWith<ApiException> { engine.create(MockRuleInput(name = "x", urlPattern = "/a", probability = 0)) }
        assertFailsWith<ApiException> { engine.create(MockRuleInput(name = "x", urlPattern = "/a", times = -1)) }
        assertFailsWith<ApiException> { engine.create(MockRuleInput(name = "x", urlPattern = "/a", dropAfterBytes = -1)) }
    }

    @Test
    fun rulesSavedBeforeTheNewFieldsStillLoad() {
        val dir = Files.createTempDirectory("killcam-mocks").toFile()
        val file = java.io.File(dir, "mocks.json")
        file.writeText(
            """[{"id":"a1","name":"old","enabled":true,"method":null,"urlPattern":"/x","matchType":"contains",
               "action":"fail","status":200,"headers":[],"body":"","delayMs":0,"failure":"no_network","hits":4,"createdMs":1}]""",
        )
        val rule = MockEngine(JsonFile(file, MockEngine.storageSerializer())).list().single()
        assertEquals(0, rule.times)
        assertEquals(100, rule.probability)
        assertEquals(0, rule.hits)
        dir.deleteRecursively()
    }

    @Test
    fun presetsAndCustomConditions() {
        val changes = mutableListOf<NetworkConditions>()
        val engine = NetworkConditionsEngine(random = Random(1)) { changes += it }
        assertNull(engine.plan(), "untouched by default")

        val slow = engine.set(NetworkConditionsInput(profile = NetworkProfile.Slow3g))
        assertEquals(NetworkProfile.Slow3g, slow.profile)
        val plan = assertNotNull(engine.plan())
        assertTrue(plan.delayMs in 400..500)
        assertEquals(50_000, plan.downloadBytesPerSecond)

        val custom = engine.set(NetworkConditionsInput(latencyMs = 800, downloadKbps = 64))
        assertEquals(NetworkProfile.Custom, custom.profile)
        assertEquals("Custom (800 ms, ↓64 kbps)", NetworkConditionsEngine.label(custom))

        // An all-zero custom setting is simply "off".
        assertEquals(NetworkProfile.Off, engine.set(NetworkConditionsInput(profile = NetworkProfile.Custom)).profile)
        assertEquals(3, changes.size)

        assertFailsWith<ApiException> { engine.set(NetworkConditionsInput(lossPercent = 101)) }
    }

    @Test
    fun offlineFailsEveryCallAsDns() {
        val engine = NetworkConditionsEngine()
        engine.set(NetworkConditionsInput(profile = NetworkProfile.Offline))
        repeat(5) { assertEquals(MockFailure.DnsFailure, engine.plan()?.failure) }
    }

    @Test
    fun lossDropsRoughlyThatShareOfCalls() {
        val engine = NetworkConditionsEngine(random = Random(7))
        engine.set(NetworkConditionsInput(lossPercent = 10))
        val failures = List(2_000) { engine.plan()!!.failure }
        val lost = failures.count { it != null }
        assertTrue(lost in 150..250, "lost $lost of 2000")
        assertTrue(failures.filterNotNull().toSet() == setOf(MockFailure.Timeout, MockFailure.ConnectionReset))
    }

    @Test
    fun conditionsPersistAcrossRestartsAndReachTheTimeline() {
        val dir = Files.createTempDirectory("killcam-conditions").toFile()
        val core = KillcamCore(com.krafton.killcam.core.demo.FakePlatform(dir), CoreConfig(dataDir = dir))
        core.conditions.set(NetworkConditionsInput(profile = NetworkProfile.Edge))
        assertTrue(core.store.timeline().any { it.label == "Network: 2G (EDGE)" })

        val restarted = KillcamCore(com.krafton.killcam.core.demo.FakePlatform(dir), CoreConfig(dataDir = dir))
        assertEquals(NetworkProfile.Edge, restarted.conditions.get().profile)
        assertTrue(restarted.store.logs().any { it.message.contains("2G (EDGE)") }, "a leftover throttle must be visible")
        dir.deleteRecursively()
    }

    @Test
    fun ruleWireFormatCarriesTheNewFields() {
        val json = KillcamJson.encodeToString(
            MockRule.serializer(),
            MockEngine().create(MockRuleInput(name = "x", urlPattern = "/a", action = MockAction.Fail, failure = MockFailure.NetworkSwitch, dropAfterBytes = 2048)),
        )
        assertTrue(""""failure":"network_switch"""" in json)
        assertTrue(""""dropAfterBytes":2048""" in json)
        assertTrue(""""exhausted"""" !in json, "computed properties stay off the wire")
    }
}
