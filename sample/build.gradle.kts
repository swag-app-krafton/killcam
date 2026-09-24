plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.krafton.killcam.sample"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.krafton.killcam.sample"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("META-INF/INDEX.LIST", "META-INF/io.netty.versions.properties", "META-INF/{AL2.0,LGPL2.1}")
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // The whole integration: the real thing in debug, an empty shell in release.
    debugImplementation(project(":killcam"))
    releaseImplementation(project(":killcam-no-op"))

    implementation(libs.okhttp)
    implementation(libs.mmkv)
    implementation(libs.firebase.config)
}
