plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}

// A consuming build that does `includeBuild("../killcam")` gets these projects
// substituted for `com.krafton.killcam:<name>` automatically, by group + name.
// JitPack builds a tag and serves this multi-module repo as com.github.swag-app-krafton.killcam:<module>:<tag>; it sets
// JITPACK, GROUP, ARTIFACT and VERSION. Following them keeps killcam's dependency on killcam-core resolvable from
// JitPack too. Everywhere else the coordinates are com.krafton.killcam:<module>:KILLCAM_VERSION.
val jitpack = System.getenv("JITPACK") == "true"

subprojects {
    group = if (jitpack) "${System.getenv("GROUP")}.${System.getenv("ARTIFACT")}" else providers.gradleProperty("KILLCAM_GROUP").get()
    version = if (jitpack) System.getenv("VERSION") else providers.gradleProperty("KILLCAM_VERSION").get()

    // Swag app (PT-D1): killcam, killcam-no-op and killcam-core publish to this repo's GitHub Packages
    // (`./gradlew publish`, credentials gpr.user/gpr.key or GITHUB_ACTOR/GITHUB_TOKEN), and to mavenLocal for local work
    // (`./gradlew publishToMavenLocal`). Each module declares what it publishes.
    plugins.withId("maven-publish") {
        extensions.configure<PublishingExtension> {
            repositories {
                maven {
                    name = "GitHubPackages"
                    url = uri("https://maven.pkg.github.com/swag-app-krafton/killcam")
                    credentials {
                        username = providers.gradleProperty("gpr.user").orElse(providers.environmentVariable("GITHUB_ACTOR")).orNull
                        password = providers.gradleProperty("gpr.key").orElse(providers.environmentVariable("GITHUB_TOKEN")).orNull
                    }
                }
            }
        }
    }
}
