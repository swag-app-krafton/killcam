plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}

// A consuming build that does `includeBuild("../killcam")` gets these projects
// substituted for `com.krafton.killcam:<name>` automatically, by group + name.
subprojects {
    group = providers.gradleProperty("KILLCAM_GROUP").get()
    version = providers.gradleProperty("KILLCAM_VERSION").get()
}
