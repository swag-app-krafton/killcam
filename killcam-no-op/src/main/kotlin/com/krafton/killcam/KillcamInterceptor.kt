package com.krafton.killcam

import okhttp3.Interceptor
import okhttp3.Response

/** Release-build stand-in: passes every request straight through. */
public class KillcamInterceptor @JvmOverloads constructor(
    @Suppress("unused") private val source: String = "okhttp",
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response = chain.proceed(chain.request())
}
