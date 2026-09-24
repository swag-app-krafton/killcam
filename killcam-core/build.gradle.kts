plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    `java-library`
}

// Pure JVM on purpose: the store, mock engine and server run unchanged in unit
// tests and in the desktop demo server, so the dashboard can be exercised
// without a phone. Everything Android-specific lives in :killcam.
java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(17)) }
}

kotlin {
    jvmToolchain(17)
    explicitApi()
}

dependencies {
    api(libs.kotlinx.coroutines.core)
    api(libs.kotlinx.serialization.json)
    implementation(libs.ktor.server.cio)

    testImplementation(kotlin("test"))
    testImplementation(libs.junit)
}

tasks.test {
    useJUnit()
}

// `./gradlew :killcam-core:demo` serves the dashboard with synthetic data on :8090.
tasks.register<JavaExec>("demo") {
    group = "killcam"
    description = "Runs the Killcam server on the desktop with synthetic Swag Pay data."
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.krafton.killcam.core.demo.DemoServerKt")
    standardInput = System.`in`
}
