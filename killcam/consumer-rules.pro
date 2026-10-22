# Killcam ships only in debug builds, but keep it intact if a team minifies those.
-keep class com.krafton.killcam.** { *; }
-dontwarn org.slf4j.**
-dontwarn io.ktor.**

# Optional integrations, compileOnly in Killcam and used only when the app has them: an app without Firebase Remote
# Config, MMKV or OkHttp still minifies (a release-type build carrying Killcam, such as a QA build).
-dontwarn com.google.firebase.remoteconfig.**
-dontwarn com.google.android.gms.tasks.**
-dontwarn com.tencent.mmkv.**
-dontwarn okhttp3.**
