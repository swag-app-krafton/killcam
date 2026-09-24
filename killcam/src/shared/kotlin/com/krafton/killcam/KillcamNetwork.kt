package com.krafton.killcam

/** Built-in network profiles for [Killcam.setNetworkProfile]. */
public enum class KillcamNetworkProfile {
    /** No throttling. */
    Off,

    /** 500 ms, 50/20 kbps, 2% loss. */
    Gprs,

    /** 2G: 300 ms, 250/50 kbps, 1% loss. */
    Edge,

    /** 400 ms, 400/400 kbps. */
    Slow3g,

    /** 150 ms, 1.6 Mbps/750 kbps. */
    Fast3g,

    /** 4G: 50 ms, 12/6 Mbps. */
    Lte,

    /** 80 ms with up to 600 ms jitter, 2/1 Mbps, 10% loss. */
    FlakyWifi,

    /** Every call fails DNS resolution. */
    Offline,
}

/** Network failures for [Killcam.failRequests], thrown as Android throws them. */
public enum class KillcamFailure {
    /** `SocketTimeoutException: timeout` (read timeout). */
    Timeout,

    /** `UnknownHostException: Unable to resolve host "…": No address associated with hostname`. */
    DnsFailure,

    /** `SocketException: Connection reset`. */
    ConnectionReset,

    /** `ConnectException: Failed to connect to …`: server down. */
    ConnectionRefused,

    /** `SocketTimeoutException: failed to connect to … after 10000ms`. */
    ConnectTimeout,

    /** `SSLHandshakeException`: pinning or TLS failure. */
    SslHandshake,

    /**
     * The real call goes out; the response body then aborts with
     * `SocketException: Software caused connection abort`, as when the phone
     * switches between Wi-Fi and mobile data mid-download.
     */
    NetworkSwitch,

    /** `IOException: unexpected end of stream`: the server closed the connection. */
    UnexpectedEof,
}
