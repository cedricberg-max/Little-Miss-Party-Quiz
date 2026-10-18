// Moteur de jeu en Kotlin pur : aucune dépendance Android ni Firebase,
// il se compile et se teste partout (`./gradlew -p engine test`).
pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}
rootProject.name = "engine"
