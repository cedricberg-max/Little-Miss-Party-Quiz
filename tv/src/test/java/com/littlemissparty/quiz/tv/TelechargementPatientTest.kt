package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Soirée du 31/10 : sur le Wi-Fi faible de la box, le téléchargement de la mise à jour restait bloqué à 0 %. */
class TelechargementPatientTest {
    @Test
    fun `plusieurs essais qui patientent de plus en plus, sans jamais attendre trop longtemps`() {
        assertTrue(UpdateViewModel.ESSAIS_TELECHARGEMENT >= 6)
        assertEquals(3_000L, UpdateViewModel.pauseAvantEssai(1))
        assertEquals(6_000L, UpdateViewModel.pauseAvantEssai(2))
        assertEquals(20_000L, UpdateViewModel.pauseAvantEssai(10))
    }

    @Test
    fun `secours GitHub, la release de la meme version que publie la CI`() {
        assertEquals(
            "https://github.com/cedricberg-max/Little-Miss-Party-Quiz/releases/download/tv-v0.1.921/little-miss-party-quiz-tv.apk",
            UpdateViewModel.urlGithub("0.1.921"),
        )
        // Même nom de release et même fichier que l'étape de publication de la CI.
        val ci = java.io.File("../.github/workflows/build.yml").readText()
        assertTrue(ci.contains("gh release create \"tv-v0.1.\${{ github.run_number }}\" little-miss-party-quiz-tv.apk"))
        val gradle = java.io.File("build.gradle.kts").readText()
        assertTrue(gradle.contains("versionName = \"0.1.\${System.getenv(\"GITHUB_RUN_NUMBER\")"))
    }

    @Test
    fun `la raison de la coupure est dite en mots simples`() {
        assertEquals("le Wi-Fi ne répond plus, délai dépassé", UpdateViewModel.raisonEnClair(java.net.SocketTimeoutException("Read timed out")))
        assertEquals("pas d'accès à Internet", UpdateViewModel.raisonEnClair(java.net.UnknownHostException("x")))
        assertEquals("Téléchargement incomplet", UpdateViewModel.raisonEnClair(IllegalStateException("Téléchargement incomplet")))
    }

    @Test
    fun `la progression bouge des 64 Ko et l'ecran dit qu'un nouvel essai reprend`() {
        val vm = java.io.File("src/main/java/com/littlemissparty/quiz/tv/UpdateViewModel.kt").readText()
        assertTrue(vm.contains("have - lastShown >= 64 * 1024"))
        assertTrue(vm.contains("telechargerAvecPatience(r)"))
        val ecran = java.io.File("src/main/java/com/littlemissparty/quiz/tv/UpdateScreens.kt").readText()
        assertTrue(ecran.contains("reprend là où il s'est arrêté"))
    }
}
