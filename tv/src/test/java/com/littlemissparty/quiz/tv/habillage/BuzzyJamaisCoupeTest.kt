package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Point 52 (cedric, 1/11 au soir) : une fois arrivé, Buzzy n'est jamais coupé par un bord de l'écran, dans aucun clip. */
class BuzzyJamaisCoupeTest {
    private val ratio = 16f / 9f

    /** Bords du robot à l'écran (fractions) pour une étape : gauche, droite, haut. */
    private fun bords(e: EtapeRobot, boite: BoiteRobot, format: Float, sauts: Float): Triple<Float, Float, Float> {
        val h = HAUTEUR_CLIP_ROBOT * e.echelle
        val l = h * format / ratio
        return Triple(e.x + (boite.gauche - 0.5f) * l, e.x + (boite.droite - 0.5f) * l, e.bas - h + boite.haut * h - sauts)
    }

    private fun verifier(clip: ClipRobot, trajet: TrajetRobot, quoi: String) {
        val boite = BOITES_ROBOT[clip.fichier]
        assertNotNull("${clip.fichier} : boîte mesurée", boite)
        val t = trajet.entierDansLEcran(boite!!, formatClip(clip.fichier), ratio)
        for (e in t.etapes) {
            val (g, d, haut) = bords(e, boite, formatClip(clip.fichier), t.sauts)
            if (!t.fluide && e.x in 0f..1f && e.bas in 0.3f..1f) {
                assertTrue("$quoi ${clip.fichier} ${clip.moment} : coupé à gauche ($g)", g >= 0f)
                assertTrue("$quoi ${clip.fichier} ${clip.moment} : coupé à droite ($d)", d <= 1f)
            }
            if (e.bas in 0.3f..1f) assertTrue("$quoi ${clip.fichier} ${clip.moment} : tête coupée en haut ($haut)", haut >= 0f)
            // Posé, son socle ne passe jamais sous le bas de l'écran.
            if (e.bas in 0.3f..1f) assertTrue(e.bas <= 1f)
        }
    }

    @Test
    fun `tous les clips du catalogue, de 1 a 8 equipes, restent entiers une fois arrives`() {
        for (clip in CATALOGUE) {
            verifier(clip, clip.trajet, "normal")
            for (n in 7..8) verifier(clip, clip.trajet.resserre(resserre(n)!!), "$n équipes")
        }
    }

    @Test
    fun `a 8 equipes il n est plus centre sur le bord droit (coupe en deux)`() {
        val clip = CATALOGUE.first { it.fichier == "gs_robot_rate" }
        val t = clip.trajet.resserre(resserre(8)!!).entierDansLEcran(BOITES_ROBOT.getValue(clip.fichier), formatClip(clip.fichier), ratio)
        val pose = t.etapes.filter { it.x in 0f..1f }
        assertTrue(pose.isNotEmpty() && pose.all { it.x < 0.97f })
    }

    @Test
    fun `le trajet entier sert a l ecran`() {
        val s = java.io.File("src/main/java/com/littlemissparty/quiz/tv/habillage/RobotGameShow.kt").readText()
        assertTrue(s.contains("trajetBrut.entierDansLEcran(boite, formatClip(clip.fichier), largeur / hauteur)"))
        assertTrue(MARGE_BORD_ROBOT > 0f && MARGE_HAUT_ROBOT > 0f)
    }
}
