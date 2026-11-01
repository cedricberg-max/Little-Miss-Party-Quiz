package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cedric, 1/11 au soir : la permission d'installer n'était demandée qu'à la toute fin, le réglage Android renvoyait au
 * gestionnaire de fichiers au lieu de revenir dans l'appli, et l'appli ne se rouvrait pas seule.
 */
class ReglagesMiseAJourTest {
    @Test
    fun `box neuve en Android 14, les deux reglages sont proposes des le lancement`() {
        assertEquals(
            listOf(Reglage.INSTALLER, Reglage.RELANCER),
            ReglagesMiseAJour.manquants(peutInstaller = false, sdk = 34, peutSAfficher = false, relanceEssayee = false),
        )
    }

    @Test
    fun `box en Android 9, seule la permission d'installer compte`() {
        assertEquals(listOf(Reglage.INSTALLER), ReglagesMiseAJour.manquants(false, 28, false, false))
        assertEquals(emptyList<Reglage>(), ReglagesMiseAJour.manquants(true, 28, false, false))
        assertTrue(ReglagesMiseAJour.seRouvreSeule(28, peutSAfficher = false))
    }

    @Test
    fun `tout est accorde, plus aucune fenetre`() {
        assertEquals(emptyList<Reglage>(), ReglagesMiseAJour.manquants(true, 34, true, false))
        assertTrue(ReglagesMiseAJour.seRouvreSeule(34, peutSAfficher = true))
    }

    @Test
    fun `box qui n'a pas vraiment le reglage de relance, on ne le redemande plus`() {
        assertEquals(emptyList<Reglage>(), ReglagesMiseAJour.manquants(true, 34, false, relanceEssayee = true))
        // Et l'écran d'installation le dit : rouvrir avec l'icône.
        assertFalse(ReglagesMiseAJour.seRouvreSeule(34, peutSAfficher = false))
    }

    @Test
    fun `le reglage s'ouvre dans la tache de l'appli, Retour revient dessus`() {
        val code = java.io.File("src/main/java/com/littlemissparty/quiz/tv/ReglagesMiseAJour.kt").readText()
        val ouvrir = code.substringAfter("fun ouvrir(")
        assertTrue(ouvrir.contains("activite.startActivity("))
        assertFalse(ouvrir.contains("FLAG_ACTIVITY_NEW_TASK"))
        val activite = java.io.File("src/main/java/com/littlemissparty/quiz/tv/MainActivity.kt").readText()
        assertTrue(activite.contains("ReglagesMiseAJour.ouvrir(this@MainActivity, Reglage.INSTALLER)"))
        assertTrue(java.io.File("src/main/AndroidManifest.xml").readText().contains("android.permission.SYSTEM_ALERT_WINDOW"))
    }

    @Test
    fun `au retour du reglage, l'installation en attente reprend toute seule`() {
        val vm = java.io.File("src/main/java/com/littlemissparty/quiz/tv/UpdateViewModel.kt").readText()
        val auRetour = vm.substringAfter("fun onResume()").substringBefore("private fun onInstallResult")
        assertTrue(auRetour.contains("ReglagesMiseAJour.manquants(app)"))
        assertTrue(auRetour.contains("install()"))
        // Les réglages passent avant la proposition de mise à jour, à l'accueil seulement.
        val app = java.io.File("src/main/java/com/littlemissparty/quiz/tv/QuizTvApp.kt").readText()
        assertTrue(app.indexOf("ReglagesDialog(") in 1 until app.indexOf("UpdateOfferDialog("))
    }
}
