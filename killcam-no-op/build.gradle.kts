plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

// Release builds depend on this instead of :killcam. Same public API, no
// server, no capture, no Ktor: calls compile and do nothing, and flag reads
// return the remote value the app pushed, else the default.
android {
    namespace = "com.krafton.killcam.noop"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].kotlin.srcDir("../killcam/src/shared/kotlin")
}

kotlin {
    jvmToolchain(17)
    explicitApi()
}

dependencies {
    compileOnly(libs.okhttp)
}
