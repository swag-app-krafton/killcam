plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    `maven-publish`
}

android {
    namespace = "com.krafton.killcam"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    publishing {
        singleVariant("release") { withSourcesJar() }
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
    compileOnly(libs.ktor.client.core) // the app's own Ktor (PT-D2), only to register the engine below
    compileOnly(libs.ktor.client.okhttp)
    compileOnly(libs.mmkv)
    compileOnly(libs.firebase.config)

    testImplementation(kotlin("test"))
    testImplementation(libs.junit)
    testImplementation(libs.okhttp)
    testImplementation(libs.ktor.client.core)
    testImplementation(libs.ktor.client.okhttp)
}

publishing {
    publications {
        register<MavenPublication>("release") {
            afterEvaluate { from(components["release"]) }
        }
    }
}
