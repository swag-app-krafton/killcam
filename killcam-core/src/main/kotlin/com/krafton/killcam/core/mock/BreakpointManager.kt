package com.krafton.killcam.core.mock

import com.krafton.killcam.core.ApiException
import com.krafton.killcam.core.Ids
import com.krafton.killcam.core.model.PausedCall
import com.krafton.killcam.core.model.ResumeRequest
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Calls held at breakpoints. The HTTP integration calls [pause] on the app's
 * request thread, which blocks until a tester resumes it from the dashboard,
 * the call is cancelled, or [timeoutMs] passes (then it continues unchanged,
 * so a forgotten breakpoint cannot hang the app forever).
 */
public class BreakpointManager(
    private val clock: () -> Long = System::currentTimeMillis,
    public val timeoutMs: Long = 120_000,
    private val onChange: (List<PausedCall>) -> Unit = {},
) {
    private class Held(val call: PausedCall, val resume: CompletableFuture<ResumeRequest>)

    private val held = java.util.concurrent.ConcurrentHashMap<String, Held>()

    public fun list(): List<PausedCall> = held.values.map { it.call }.sortedBy { it.pausedMs }

    /**
     * Blocks until resumed. [build] receives the paused-call id and deadline.
     * Returns what the tester chose, a plain continue on timeout, or null when
     * [isCancelled] turned true (the app gave up on the call).
     */
    public fun pause(build: (id: String, pausedMs: Long, deadlineMs: Long) -> PausedCall, isCancelled: () -> Boolean): ResumeRequest? {
        val now = clock()
        val call = build(Ids.next(), now, now + timeoutMs)
        val entry = Held(call, CompletableFuture())
        held[call.id] = entry
        onChange(list())
        try {
            while (true) {
                if (isCancelled()) return null
                val left = call.deadlineMs - clock()
                if (left <= 0) return ResumeRequest()
                try {
                    return entry.resume.get(minOf(left, POLL_MS), TimeUnit.MILLISECONDS)
                } catch (_: TimeoutException) {
                    // Poll again: the deadline and cancellation are checked each round.
                }
            }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            return null
        } finally {
            held.remove(call.id)
            onChange(list())
        }
    }

    public fun resume(id: String, request: ResumeRequest) {
        val entry = held[id] ?: throw ApiException(404, "No paused call '$id' (already resumed or timed out)")
        if (request.status != null && request.status !in 100..599) throw ApiException(400, "status must be 100..599")
        entry.resume.complete(request)
    }

    /** Continues every held call unchanged, e.g. when a tester turns breakpoints off. */
    public fun resumeAll() {
        held.values.forEach { it.resume.complete(ResumeRequest()) }
    }

    private companion object {
        const val POLL_MS = 200L
    }
}
