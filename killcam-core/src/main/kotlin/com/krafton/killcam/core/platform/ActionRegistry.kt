package com.krafton.killcam.core.platform

import com.krafton.killcam.core.model.ActionInfo
import com.krafton.killcam.core.model.ActionResult
import java.util.concurrent.ConcurrentHashMap

/**
 * Buttons the app exposes to testers: "Expire session", "Reset onboarding",
 * "Trigger test crash". The block runs wherever the platform decides (Android
 * runs it on the main thread) and may return a message shown as a toast.
 */
public class ActionRegistry {
    public class Registered(public val info: ActionInfo, public val run: () -> String?)

    private val actions = ConcurrentHashMap<String, Registered>()
    private val order = java.util.concurrent.CopyOnWriteArrayList<String>()

    public fun register(label: String, description: String? = null, group: String? = null, run: () -> String?): String {
        val id = label.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "action" }
        if (actions.put(id, Registered(ActionInfo(id, label, description, group), run)) == null) order += id
        return id
    }

    public fun list(): List<ActionInfo> = order.mapNotNull { actions[it]?.info }

    public fun get(id: String): Registered? = actions[id]

    /** Runs the action on the calling thread. */
    public fun invoke(id: String): ActionResult {
        val action = actions[id] ?: return ActionResult(false, "No action '$id'")
        return runCatching { ActionResult(true, action.run()) }
            .getOrElse { ActionResult(false, "${it.javaClass.simpleName}: ${it.message}") }
    }
}
