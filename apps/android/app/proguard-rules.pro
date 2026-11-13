# R8 rules for the release build.
# The legacy JS bridge (WebView without WebMessageListener) is called by name from JavaScript.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
# OkHttp ships its own consumer rules; these silence optional platform warnings.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
