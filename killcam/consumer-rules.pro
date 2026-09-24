# Killcam ships only in debug builds, but keep it intact if a team minifies those.
-keep class com.krafton.killcam.** { *; }
-dontwarn org.slf4j.**
-dontwarn io.ktor.**
