package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Portes des transitions (cedric, 31/10) : au petit rebond, les battants s'entrouvrent et la fente laissait voir l'écran
 * du jeu suivant en train de se charger (« texture métallique » à traits horizontaux sur la TV). Derrière les portes
 * fermées, rebond compris, un fond de nuit.
 */
class PortesTransitionTest {
    @Test
    fun `fond de nuit derriere les portes, du contact a la reouverture`() {
        val duree = 1_700L
        assertFalse("pendant la fermeture, on voit encore l'écran", fondDerriereLesPortes(279f, duree))
        assertTrue("au contact", fondDerriereLesPortes(280f, duree))
        assertTrue("pendant le rebond (fente ouverte)", fondDerriereLesPortes(400f, duree))
        assertTrue("portes fermées", fondDerriereLesPortes(1_000f, duree))
        assertTrue(fondDerriereLesPortes(1_300f, duree))
        assertFalse("à l'ouverture, on voit le nouveau jeu", fondDerriereLesPortes(1_301f, duree))
    }

    @Test
    fun `le fond est dessine sous les battants, le rebond est garde`() {
        val t = File("src/main/java/com/littlemissparty/quiz/tv/habillage/Transitions.kt").readText()
        val fond = t.indexOf("if (fondDerriereLesPortes(ms(), a.dureeMs)) drawRect(FondPortes)")
        assertTrue(fond > 0 && fond < t.indexOf("Battant(portes.first"))
        assertTrue(t.contains("0.018f * sin(PI.toFloat() * (v - FERMETURE_MS) / REBOND_PORTES_MS)"))
    }
    /**
     * Cedric, 1/11 au soir : la « texture métallique à traits » était la lumière du joint, dessinée en 12 bandes qui se
     * chevauchaient d'un pixel (un trait clair tous les douzièmes de l'écran, vu sur le film de l'émulateur).
     */
    @Test
    fun `lumiere du joint d'un seul trait, fondu haut et bas continu, plus aucune bande`() {
        val t = File("src/main/java/com/littlemissparty/quiz/tv/habillage/Transitions.kt").readText()
        assertFalse(t.contains("val bandes = 12"))
        assertFalse(t.contains("for (b in 0 until bandes)"))
        assertTrue(t.contains("drawRect(MasqueJoint, blendMode = BlendMode.DstIn)"))
        assertTrue(t.contains("compositingStrategy = CompositingStrategy.Offscreen"))
        // Profil : 1 au milieu, 0,65 en haut et en bas, sans marche entre deux arrêts voisins.
        org.junit.Assert.assertEquals(1f, profilJoint(0f), 1e-6f)
        org.junit.Assert.assertEquals(0.65f, profilJoint(-1f), 1e-6f)
        org.junit.Assert.assertEquals(0.65f, profilJoint(1f), 1e-6f)
        assertTrue(ARRETS_JOINT.size >= 33)
        ARRETS_JOINT.zipWithNext().forEach { (a, b) -> assertTrue(kotlin.math.abs(a.second - b.second) < 0.05f) }
    }
}
