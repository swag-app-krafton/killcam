plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.krafton.killcam"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Public types shared verbatim with :killcam-no-op, so the two can never disagree on them.
    sourceSets["main"].kotlin.srcDir("src/shared/kotlin")
}

kotlin {
    jvmToolchain(17)
    explicitApi()
}

dependencies {
    // Core stays an implementation detail: apps only see com.krafton.killcam.*,
    // which is exactly the surface :killcam-no-op mirrors for release builds.
    implementation(project(":killcam-core"))
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.core)
    compileOnly(libs.okhttp)
    compileOnly(libs.mmkv)
    compileOnly(libs.firebase.config)
}
