import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// The version is set in one place: the monorepo's root package.json (scripts/check.js keeps every copy in step).
// versionCode = major * 10000 + minor * 100 + patch, so 0.8.0 -> 800 and 1.0.0 -> 10000 (minor and patch < 100).
val rootPackageJson = rootProject.file("../../package.json")
val appVersion: String = Regex("\"version\"\\s*:\\s*\"(\\d+\\.\\d+\\.\\d+)\"")
    .find(rootPackageJson.readText())?.groupValues?.get(1)
    ?: throw GradleException("No x.y.z version in ${rootPackageJson.path}")
val appVersionCode: Int = appVersion.split(".").map { it.toInt() }.let { (major, minor, patch) ->
    require(minor < 100 && patch < 100) { "minor and patch must stay below 100 for versionCode" }
    major * 10000 + minor * 100 + patch
}

// Release signing comes only from environment variables (GitHub Actions secrets, see README.md).
// Without them the release build is signed with the debug key so it still installs for testing.
val keystoreFile: String? = System.getenv("ANDROID_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }
val hasReleaseKey = keystoreFile != null && file(keystoreFile).exists() &&
    listOf("ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")
        .all { !System.getenv(it).isNullOrBlank() }

// Optional override for the bridge WebSocket (gradle -Pcolon.bridgeUrl=wss://...).
val bridgeUrl: String = (findProperty("colon.bridgeUrl") as String?) ?: "wss://api.apparatus.name.ng/ws"

// Extra sign-in hosts that open in a Chrome Custom Tab (banks that block WebView sign-in), added to the list in
// UrlRules.CUSTOM_TAB_HOSTS without a code change: gradle -Pcolon.customTabHosts=ibank.example.com,.bank.example
val customTabHosts: String = ((findProperty("colon.customTabHosts") as String?) ?: "")
    .split(',').map { it.trim().lowercase() }.filter { Regex("^\\.?[a-z0-9.-]+$").matches(it) }.joinToString(",")

// Phase 10: how many chats keep their own in-chat browser (WebView profile, tabs, history); the least recently used
// beyond it are deleted. gradle -Pcolon.chatProfiles=30 (1..100, default 20).
val chatProfilesMax: Int = ((findProperty("colon.chatProfiles") as String?)?.toIntOrNull() ?: 20).coerceIn(1, 100)

android {
    namespace = "ng.nifelux.colonai"
    compileSdk = 36

    defaultConfig {
        applicationId = "ng.nifelux.colonai"
        minSdk = 24
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersion
        buildConfigField("String", "WEB_URL", "\"https://chat.apparatus.name.ng/\"")
        buildConfigField("String", "API_URL", "\"https://api.apparatus.name.ng\"")
        buildConfigField("String", "BRIDGE_URL", "\"$bridgeUrl\"")
        buildConfigField("String", "UPDATE_URL", "\"https://chat.apparatus.name.ng/android/version.json\"")
        buildConfigField("String", "RELEASES_URL", "\"https://github.com/Nifeluxtech/colon-ai/releases/latest\"")
        buildConfigField("boolean", "RELEASE_SIGNED", hasReleaseKey.toString())
        buildConfigField("String", "EXTRA_CUSTOM_TAB_HOSTS", "\"$customTabHosts\"")
        buildConfigField("int", "CHAT_PROFILES_MAX", chatProfilesMax.toString())
    }

    // Two apps from one project (Phase 8): Colon AI (chat with the in-chat browser panel) and Colon Browser (the
    // standalone browser). Code lives in src/main; each flavor has its own manifest (activities), name and icon.
    flavorDimensions += "app"
    productFlavors {
        create("colonai") {
            dimension = "app"
            applicationId = "ng.nifelux.colonai"
            buildConfigField("String", "APP_KEY", "\"colonai\"")
            buildConfigField("String", "APK_NAME", "\"colon-ai\"")
            buildConfigField("String", "PARTNER_PACKAGE", "\"ng.nifelux.colonbrowser\"")
            buildConfigField("boolean", "IS_BROWSER_APP", "false")
        }
        create("colonbrowser") {
            dimension = "app"
            applicationId = "ng.nifelux.colonbrowser"
            buildConfigField("String", "APP_KEY", "\"colonbrowser\"")
            buildConfigField("String", "APK_NAME", "\"colon-browser\"")
            buildConfigField("String", "PARTNER_PACKAGE", "\"ng.nifelux.colonai\"")
            buildConfigField("boolean", "IS_BROWSER_APP", "true")
        }
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystoreFile!!)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                enableV1Signing = true // Android 7.0 (API 24-25) still checks v1 signatures
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release")
            else signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // Version-freshness checks are advice, not defects; CI must not fail when a newer library ships.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi",
            "UseKtx") // KTX style suggestions, not defects
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/AL2.0", "META-INF/LGPL2.1")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.browser) // Chrome Custom Tabs for Google and bank sign-in
    implementation(libs.material)
    implementation(libs.okhttp)

    testImplementation(libs.junit)
    testImplementation(libs.json) // org.json is a stub in local unit tests; this is the real implementation
}
