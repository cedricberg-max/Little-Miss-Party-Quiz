plugins {
    kotlin("jvm") version "2.1.0"
}

group = "com.littlemissparty.quiz"
version = "1"

// Bytecode Java 17, comme l'appli TV, quel que soit le JDK qui compile.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // Fourni par Android sur la box ; seulement nécessaire ici pour compiler et tester.
    compileOnly("org.json:json:20240303")
    testImplementation("org.json:json:20240303")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
