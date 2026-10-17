import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Configuration Firebase publique (la même que celle de la page pupitre).
@Suppress("UNCHECKED_CAST")
val firebaseConfig = JsonSlurper().parse(rootProject.file("firebase-config.json")) as Map<String, String>
fun fb(key: String) = "\"" + (firebaseConfig[key] ?: "") + "\""

android {
    namespace = "com.littlemissparty.quiz.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.littlemissparty.quiz.tv"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"

        buildConfigField("String", "FB_API_KEY", fb("apiKey"))
        buildConfigField("String", "FB_APP_ID", fb("appId"))
        buildConfigField("String", "FB_PROJECT_ID", fb("projectId"))
        buildConfigField("String", "FB_DATABASE_URL", fb("databaseURL"))
    }

    // Clé fixe pour que chaque nouvelle version s'installe par-dessus l'ancienne.
    signingConfigs {
        create("lmp") {
            storeFile = file("lmp-debug.keystore")
            storePassword = "lmpquiz"
            keyAlias = "lmp"
            keyPassword = "lmpquiz"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("lmp")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("lmp")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        checkReleaseBuilds = false
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.01.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.core:core-ktx:1.15.0")

    implementation(platform("com.google.firebase:firebase-bom:33.8.0"))
    implementation("com.google.firebase:firebase-database")
    implementation("com.google.firebase:firebase-auth")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    implementation("com.google.zxing:core:3.5.3")
}
