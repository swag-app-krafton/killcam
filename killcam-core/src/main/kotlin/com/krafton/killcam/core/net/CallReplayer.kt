package com.krafton.killcam.core.net

import com.krafton.killcam.core.model.RepeatRequest

/**
 * Re-sends a captured call through the app's own HTTP client, so its auth and
 * interceptors apply. Implemented per HTTP stack (OkHttp: KillcamInterceptor);
 * the repeated calls are captured like any other, with source "repeat".
 */
public fun interface CallReplayer {
    /** Starts the repeats and returns how many; throws ApiException when the call cannot be repeated. */
    public fun repeat(callId: String, request: RepeatRequest): Int
}
