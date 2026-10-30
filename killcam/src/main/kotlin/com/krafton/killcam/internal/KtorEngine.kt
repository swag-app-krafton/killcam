package com.krafton.killcam.internal

import com.krafton.killcam.KillcamInterceptor
import io.ktor.client.HttpClientEngineContainer
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.engine.okhttp.OkHttpConfig
import java.util.ServiceConfigurationError
import java.util.ServiceLoader

/**
 * Puts Killcam's call capture on an app's Ktor client with no code in the app. Ktor's `HttpClient()` with no engine named
 * takes the first `HttpClientEngineContainer` that `ServiceLoader` finds; this one is listed in the artifact's
 * `META-INF/services`, so an app that depends on `killcam` (and not on `killcam-no-op`) gets an OkHttp engine with
 * [KillcamInterceptor] already added. A client built with `HttpClient(OkHttp)` names its engine and is not captured: add
 * the interceptor to that one by hand.
 *
 * ServiceLoader instantiates it, so it is public with a no-argument constructor.
 */
public class KillcamEngineContainer : HttpClientEngineContainer {
    override val factory: HttpClientEngineFactory<*> = KillcamOkHttp
}

/** OkHttp, with Killcam's interceptor first and then whatever the app's `engine { }` block adds. */
internal object KillcamOkHttp : HttpClientEngineFactory<OkHttpConfig> {
    const val SOURCE = "ktor"

    override fun create(block: OkHttpConfig.() -> Unit): HttpClientEngine =
        OkHttp.create {
            addInterceptor(KillcamInterceptor(SOURCE))
            block()
        }
}

/**
 * Ktor takes the first engine `ServiceLoader` lists, and the order comes from the app's classpath, which Killcam doesn't
 * control. [listedFirst] says whether Killcam's engine won: null when the app has no Ktor client to capture, false when
 * another engine is listed before it (so [Killcam.install] puts a line on the timeline instead of capturing nothing).
 */
internal object KtorEngineCheck {
    const val MISSED = "Ktor calls are not captured: another HttpClientEngineContainer is listed before Killcam's"

    fun listedFirst(): Boolean? =
        try {
            ServiceLoader.load(HttpClientEngineContainer::class.java).firstOrNull()?.let { it is KillcamEngineContainer }
        } catch (_: LinkageError) {
            null // no Ktor client on the app's classpath
        } catch (_: ServiceConfigurationError) {
            null
        }
}
