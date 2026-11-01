package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.engine.DuelResult
import com.littlemissparty.quiz.engine.DuelRound
import com.littlemissparty.quiz.tv.etapeDuel
import com.littlemissparty.quiz.tv.tempsDuel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 🤠 Le Duel des robots sur la TV (cedric, 27/10) : le montage du face-à-face, les étapes, le temps affiché. */
class DuelRobotsTest {

    @Test
    fun `montage un plan toutes les 3 a 4 s, une feinte toutes les 8 a 12 s, jamais deux de suite`() {
        for (graine in 0 until 200) {
            val duree = 20_000L + graine * 200L
            val m = montageDuel(duree, graine)
            assertEquals(0L, m.first().debutMs)
            assertFalse("pas de feinte en premier plan", m.first().feinte)
            assertTrue("le montage s'arrête au PAN", m.all { it.debutMs < duree })
            m.zipWithNext().forEach { (a, b) ->
                assertFalse("deux feintes de suite", a.feinte && b.feinte)
                assertTrue("même plan deux fois de suite", a.nom != b.nom)
                val ecart = b.debutMs - a.debutMs
                if (a.feinte) assertEquals(FEINTE_DUEL_MS, ecart) else assertTrue("plan de $ecart ms", ecart in 3_000..4_000)
            }
            val feintes = m.filter { it.feinte }
            assertTrue("au moins une feinte en 20 s", feintes.isNotEmpty())
            assertTrue("première feinte entre 8 et 12 s (ou juste après le plan en cours)", feintes.first().debutMs in 8_000..16_000)
            feintes.zipWithNext().forEach { (a, b) -> assertTrue(b.debutMs - a.debutMs >= 8_000) }
            assertTrue(m.all { it.nom.startsWith(if (it.feinte) "feinte_" else "plan_") && it.cote in 0..1 })
        }
    }

    @Test
    fun `montage avec seulement les videos livrees`() {
        val m = montageDuel(40_000, 3, plans = listOf("large", "contre"), feintes = listOf("dos"))
        assertTrue(m.filter { !it.feinte }.all { it.nom in setOf("plan_large", "plan_contre") })
        assertTrue(m.filter { it.feinte }.all { it.nom == "feinte_dos" })
        assertTrue("une seule vidéo de plan : elle se répète", montageDuel(20_000, 3, plans = listOf("large"), feintes = emptyList()).all { it.nom == "plan_large" })
        assertTrue("aucune feinte livrée : pas de feinte", montageDuel(40_000, 3, plans = listOf("large", "contre"), feintes = emptyList()).none { it.feinte })
    }

    @Test
    fun `le meme duel donne toujours le meme montage`() {
        assertEquals(montageDuel(31_000, 42), montageDuel(31_000, 42))
        assertEquals("plan_large", planDuelA(listOf(PlanDuel(0, "plan_large"), PlanDuel(3_500, "plan_yeux")), 3_499)?.nom)
        assertEquals("plan_yeux", planDuelA(listOf(PlanDuel(0, "plan_large"), PlanDuel(3_500, "plan_yeux")), 3_500)?.nom)
    }

    @Test
    fun `etapes du duel a l'ecran`() {
        val pret = DuelRound(1, listOf("a", "b"), listOf(1, 1))
        val face = pret.copy(startAt = 1_000, panAt = 25_000)
        assertEquals(EtapeDuel.ATTENTE, etapeDuel(null, 2, false))
        assertEquals("une seule équipe", EtapeDuel.ATTENTE, etapeDuel(pret, 1, false))
        assertEquals(EtapeDuel.PRET, etapeDuel(pret, 2, false))
        assertEquals(EtapeDuel.FACE, etapeDuel(face, 2, false))
        assertEquals(EtapeDuel.PAN, etapeDuel(face, 2, true))
        assertEquals(EtapeDuel.GAGNE, etapeDuel(face.copy(result = DuelResult("a", "b", null, 310, 100, 26_000)), 2, true))
        assertEquals(EtapeDuel.TROP_TOT, etapeDuel(face.copy(result = DuelResult("b", "a", "a", null, 100, 9_000)), 2, false))
        assertEquals(EtapeDuel.PERSONNE, etapeDuel(face.copy(result = DuelResult(null, null, null, null, 0, 35_000)), 2, true))
    }

    @Test
    fun `videos du Game Show selon l'etape et le cote`() {
        assertNull(videoDuel(EtapeDuel.ATTENTE, null, null))
        assertEquals("annonce" to true, videoDuel(EtapeDuel.PRET, null, null))
        assertEquals("plan_yeux" to false, videoDuel(EtapeDuel.FACE, PlanDuel(0, "plan_yeux"), null))
        assertEquals("gagne_droite" to false, videoDuel(EtapeDuel.GAGNE, null, 1))
        assertEquals("troptot_gauche" to false, videoDuel(EtapeDuel.TROP_TOT, null, 0))
    }

    @Test
    fun `temps de reaction affiche`() {
        assertEquals("0,31 s", tempsDuel(312))
        assertEquals("1,05 s", tempsDuel(1_050))
        assertEquals("0,00 s", tempsDuel(0))
    }

    @Test
    fun `affiches WANTED, le portrait du robot a la couleur de l'equipe`() {
        val palette = com.littlemissparty.quiz.tv.TEAM_COLORS.map { it.removePrefix("#").toLong(16).toInt() or 0xFF000000.toInt() }
        assertEquals(
            listOf("rose", "orange", "vert", "jaune", "bleu", "violet", "rouge", "turquoise"),
            palette.map { portraitDuel(androidx.compose.ui.graphics.Color(it)) },
        )
        // Une couleur choisie à la main tombe sur le portrait le plus proche.
        assertEquals("rose", portraitDuel(androidx.compose.ui.graphics.Color(0xFFFF3CAC)))
        assertEquals("rouge", portraitDuel(androidx.compose.ui.graphics.Color(0xFFE00000)))
        // Chaque portrait livré par le design est dans l'appli.
        PORTRAITS_DUEL.forEach { (nom, _) ->
            assertTrue("portrait $nom", java.io.File("src/main/res/drawable-nodpi/gs_duel_portrait_$nom.webp").isFile)
        }
    }
    /** Cedric, 1/11 au soir : la pastille « LE DUEL DES ROBOTS 2 / 9 » en haut à gauche « n'a absolument rien à faire là ». */
    @Test
    fun `plus de pastille du numero de duel en haut a gauche`() {
        val code = java.io.File("src/main/java/com/littlemissparty/quiz/tv/DuelScreens.kt").readText()
        org.junit.Assert.assertTrue(code.contains("pastille = \"\","))
        org.junit.Assert.assertFalse(code.contains("\"🤠 LE DUEL DES ROBOTS \" +"))
        val western = java.io.File("src/main/java/com/littlemissparty/quiz/tv/habillage/DuelWestern.kt").readText()
        org.junit.Assert.assertTrue(western.contains("if (textes.pastille.isNotBlank()) Pastille("))
    }
}
