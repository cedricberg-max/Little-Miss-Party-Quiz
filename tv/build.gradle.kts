import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    // Lit tv/google-services.json et initialise Firebase automatiquement au démarrage.
    id("com.google.gms.google-services")
}

// Configuration Firebase publique partagée avec la page pupitre (adresse de la base).
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

        buildConfigField("String", "FB_PROJECT_ID", fb("projectId"))
        buildConfigField("String", "FB_DATABASE_URL", fb("databaseURL"))
        // Description de la dernière version stable, publiée avec le pupitre par GitHub Actions.
        // Les tests sur émulateur peuvent la remplacer : ./gradlew -PlmpUpdateUrl=http://10.0.2.2:8080/tv/latest.json
        val updateUrl = (project.findProperty("lmpUpdateUrl") as String?)
            ?: "https://${firebaseConfig["projectId"] ?: ""}.web.app/tv/latest.json"
        buildConfigField("String", "UPDATE_URL", "\"$updateUrl\"")
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
    implementation("com.littlemissparty.quiz:engine")
}
