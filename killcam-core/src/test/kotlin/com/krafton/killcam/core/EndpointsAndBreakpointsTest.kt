package com.krafton.killcam.core

import com.krafton.killcam.core.endpoints.EndpointRegistry
import com.krafton.killcam.core.mock.BreakpointManager
import com.krafton.killcam.core.mock.MockEngine
import com.krafton.killcam.core.model.BreakStage
import com.krafton.killcam.core.model.EndpointInput
import com.krafton.killcam.core.model.EndpointSource
import com.krafton.killcam.core.model.MatchType
import com.krafton.killcam.core.model.MockAction
import com.krafton.killcam.core.model.MockFailure
import com.krafton.killcam.core.model.MockRuleInput
import com.krafton.killcam.core.model.PausedCall
import com.krafton.killcam.core.model.ResumeAction
import com.krafton.killcam.core.model.ResumeRequest
import com.krafton.killcam.core.store.JsonFile
import org.junit.Test
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EndpointsAndBreakpointsTest {
    private val catalog = """
        {"version":1,"endpoints":[
          {"key":"/page/fetch","method":"POST","name":"Fetch page"},
          {"key":"/action/view"},
          {"key":"/data/sync","urlPattern":"/v2/data/sync","description":"Background sync"}
        ]}
    """

    @Test
    fun catalogLayersMergeByKeyAndGroupByTopLevelSegment() {
        val registry = EndpointRegistry()
        registry.loadCatalog(catalog)
        registry.register(EndpointInput(key = "/data/sync", urlPattern = "/v3/data/sync"))
        registry.register(EndpointInput(key = "/page/render"))

        val byKey = registry.list().associateBy { it.key }
        assertEquals(listOf("action", "data", "page", "page"), registry.list().map { it.group })
        assertEquals(EndpointSource.Repo, byKey.getValue("/page/fetch").source)
        assertFalse(byKey.getValue("/page/fetch").unexported)
        assertEquals("/v3/data/sync", byKey.getValue("/data/sync").urlPattern, "code wins over the repo file")
        assertEquals(EndpointSource.Code, byKey.getValue("/data/sync").source)
        assertTrue(byKey.getValue("/page/render").unexported)
        assertEquals("/action/view", byKey.getValue("/action/view").urlPattern, "pattern defaults to the key")
    }

    @Test
    fun dashboardEndpointsPersistAndExportBackToTheRepoFormat() {
        val dir = Files.createTempDirectory("killcam-endpoints").toFile()
        val file = JsonFile(java.io.File(dir, "endpoints.json"), EndpointRegistry.storageSerializer)
        val registry = EndpointRegistry().apply { attachStorage(file); loadCatalog(catalog) }
        registry.put(EndpointInput(key = "/user/profile", method = "get"))
        // Re-saving a repo endpoint unchanged is not an edit.
        registry.put(EndpointInput(key = "/action/view"))

        val reloaded = EndpointRegistry().apply { attachStorage(file); loadCatalog(catalog) }
        val profile = reloaded.get("/user/profile")!!
        assertEquals(EndpointSource.Dashboard, profile.source)
        assertEquals("GET", profile.method)
        assertTrue(profile.unexported)
        assertEquals(listOf("/user/profile"), reloaded.list().filter { it.unexported }.map { it.key })

        // After the exported file is committed and shipped, nothing is left to export.
        val exported = KillcamJson.encodeToString(com.krafton.killcam.core.model.EndpointCatalog.serializer(), reloaded.export())
        val next = EndpointRegistry().apply { attachStorage(file); loadCatalog(exported) }
        assertTrue(next.list().none { it.unexported })
        assertEquals(4, next.list().size)

        assertTrue(next.delete("/user/profile"))
        assertFalse(next.delete("/page/fetch"), "repo endpoints are changed in the repo, not deleted on a device")
        dir.deleteRecursively()
    }

    @Test
    fun rejectsBadCatalogsAndKeys() {
        val registry = EndpointRegistry()
        assertFailsWith<IllegalArgumentException> { registry.loadCatalog("""{"endpoints":"nope"}""") }
        assertFailsWith<ApiException> { registry.put(EndpointInput(key = " ")) }
        assertFailsWith<ApiException> { registry.put(EndpointInput(key = "/x", urlPattern = "(", matchType = MatchType.Regex)) }
    }

    @Test
    fun mockRulesTargetEndpointsByKey() {
        val registry = EndpointRegistry().apply { loadCatalog(catalog) }
        val engine = MockEngine(endpoints = registry)
        val rule = engine.create(
            MockRuleInput(name = "", urlPattern = "", endpoint = "/page/fetch", action = MockAction.Fail, failure = MockFailure.DnsFailure),
        )
        assertEquals("POST", rule.method)
        assertEquals("/page/fetch", rule.urlPattern)
        assertEquals("Fetch page", rule.name)
        assertEquals("/page/fetch", rule.endpoint)
        assertEquals(rule.id, engine.match("POST", "https://api.app.com/page/fetch?id=1")?.id)
        assertNull(engine.match("GET", "https://api.app.com/page/fetch"))

        val sync = engine.create(MockRuleInput(name = "sync", urlPattern = "", endpoint = "/data/sync", status = 503))
        assertEquals(sync.id, engine.match("GET", "https://api.app.com/v2/data/sync")?.id)

        assertFailsWith<ApiException> { engine.create(MockRuleInput(name = "x", urlPattern = "", endpoint = "/nope")) }
    }

    @Test
    fun breakpointBlocksUntilResumed() {
        val changes = mutableListOf<Int>()
        val manager = BreakpointManager(onChange = { synchronized(changes) { changes += it.size } })
        val result = AtomicReference<ResumeRequest?>()
        val worker = thread { result.set(manager.pause(::paused) { false }) }
        while (manager.list().isEmpty()) Thread.sleep(5)
        val held = manager.list().single()
        manager.resume(held.id, ResumeRequest(action = ResumeAction.Fail, failure = MockFailure.Timeout))
        worker.join(2_000)
        assertEquals(ResumeAction.Fail, result.get()!!.action)
        assertTrue(manager.list().isEmpty())
        assertEquals(listOf(1, 0), synchronized(changes) { changes.toList() })
        assertFailsWith<ApiException> { manager.resume(held.id, ResumeRequest()) }
    }

    @Test
    fun breakpointContinuesOnTimeoutAndGivesUpOnCancel() {
        var now = 0L
        val manager = BreakpointManager(clock = { now }, timeoutMs = 1_000)
        val result = AtomicReference<ResumeRequest?>()
        val worker = thread { result.set(manager.pause(::paused) { false }) }
        while (manager.list().isEmpty()) Thread.sleep(5)
        now = 1_001
        worker.join(2_000)
        assertEquals(ResumeAction.Continue, result.get()!!.action)

        var cancelled = false
        val cancelResult = AtomicReference<Any?>("unset")
        val second = thread { cancelResult.set(manager.pause(::paused) { cancelled }) }
        while (manager.list().isEmpty()) Thread.sleep(5)
        cancelled = true
        second.join(2_000)
        assertNull(cancelResult.get())
    }

    private fun paused(id: String, at: Long, deadline: Long) = PausedCall(
        id = id, callId = null, ruleId = "r", ruleName = "rule", stage = BreakStage.Request, pausedMs = at, deadlineMs = deadline,
        method = "GET", url = "https://x/a", requestHeaders = emptyList(), requestBody = null, requestBodyEditable = false,
        status = null, responseHeaders = emptyList(), responseBody = null, responseBodyEditable = false,
    )
}
