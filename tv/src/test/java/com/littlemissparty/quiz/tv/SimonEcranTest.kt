package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.engine.SIMON_CHIFFRES_MS
import com.littlemissparty.quiz.engine.SIMON_PAS_MS
import com.littlemissparty.quiz.engine.SIMON_REGARDEZ_MS
import com.littlemissparty.quiz.engine.SIMON_VERIF_FIN_MS
import com.littlemissparty.quiz.engine.SIMON_VERIF_PAS_MS
import com.littlemissparty.quiz.engine.SimonAnswer
import com.littlemissparty.quiz.engine.SimonRound
import com.littlemissparty.quiz.engine.SimonVerdict
import com.littlemissparty.quiz.engine.reponseMs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 🔴 Le Simon du Prof à la TV : ce que montre l'écran à chaque instant d'une suite. */
class SimonEcranTest {
    private val suite = listOf("rouge", "vert", "bleu", "4", "jaune", "7", "rose", "2")
    private val t0 = 1_000_000L

    private fun tour(n: Int, startAt: Long? = t0, chiffresVus: Boolean = false, verdict: SimonVerdict? = null) =
        SimonRound(1, suite, listOf("A", "B"), suite = n, startAt = startAt, verdict = verdict, chiffresVus = chiffresVus)

    @Test
    fun `une suite - regardez bien, chaque boule a son tour, puis le chrono, puis l'attente du jugement`() {
        val r = tour(3)
        assertEquals(EtapeSimon.REGARDEZ, vueSimon(r, t0, 10).etape)
        val montre = t0 + SIMON_REGARDEZ_MS
        for (i in 0 until 3) {
            val v = vueSimon(r, montre + i * SIMON_PAS_MS + 10, 10)
            assertEquals(EtapeSimon.MONTRE, v.etape)
            assertEquals(i, v.boule)
            assertTrue(v.allumee)
            // Un petit noir avant la boule suivante.
            assertFalse(vueSimon(r, montre + i * SIMON_PAS_MS + SIMON_ALLUME_MS + 10, 10).allumee)
        }
        val reponse = montre + 3 * SIMON_PAS_MS
        val joue = vueSimon(r, reponse, 10)
        assertEquals(EtapeSimon.JOUE, joue.etape)
        assertEquals(10, joue.reste)
        assertEquals(1, vueSimon(r, reponse + reponseMs(3, 10) - 1, 10).reste)
        assertEquals(EtapeSimon.TEMPS, vueSimon(r, reponse + reponseMs(3, 10), 10).etape)
    }

    @Test
    fun `premiere suite a chiffres - l'annonce d'abord, une seule fois dans le jeu`() {
        assertEquals(EtapeSimon.CHIFFRES, vueSimon(tour(4), t0 + 100, 10).etape)
        assertEquals(EtapeSimon.REGARDEZ, vueSimon(tour(4), t0 + SIMON_CHIFFRES_MS, 10).etape)
        assertEquals(EtapeSimon.REGARDEZ, vueSimon(tour(4, chiffresVus = true), t0 + 100, 10).etape)
    }

    @Test
    fun `apres le jugement - verification colonne par colonne, puis le bandeau, pas lancee - prets`() {
        val v = SimonVerdict(3, mapOf("A" to SimonAnswer(suite.take(3), 2_000)), listOf("B"), emptyList(), 0, false, t0)
        val r = tour(3, verdict = v)
        assertEquals(VueSimon(EtapeSimon.VERIF, colonne = 0), vueSimon(r, t0, 10))
        assertEquals(2, vueSimon(r, t0 + 2 * SIMON_VERIF_PAS_MS + 1, 10).colonne)
        // Toutes les colonnes vues : le résultat reste affiché un moment avant le bandeau (comme sur les tablettes).
        assertEquals(3, vueSimon(r, t0 + 3 * SIMON_VERIF_PAS_MS + 1, 10).colonne)
        assertEquals(EtapeSimon.BILAN, vueSimon(r, t0 + 3 * SIMON_VERIF_PAS_MS + SIMON_VERIF_FIN_MS, 10).etape)
        // Box redémarrée longtemps après : directement le bandeau ; horloge en retard : la vérification commence.
        assertEquals(EtapeSimon.BILAN, vueSimon(r, t0 + 600_000, 10).etape)
        assertEquals(0, vueSimon(r, t0 - 5_000, 10).colonne)
        assertEquals(EtapeSimon.PRET, vueSimon(tour(1, startAt = null), t0, 10).etape)
        assertEquals(EtapeSimon.ATTENTE, vueSimon(null, t0, 10).etape)
    }

    @Test
    fun `le robot prof montre la suite avec sa regle, leve les bras pour les chiffres, felicite la gagnante`() {
        fun v(winners: List<String> = emptyList(), bah: Boolean = false) = SimonVerdict(2, emptyMap(), emptyList(), winners, 0, bah, t0)
        assertEquals(PoseSimon.MONTRE, poseSimon(EtapeSimon.MONTRE, null))
        assertEquals(PoseSimon.CHIFFRES, poseSimon(EtapeSimon.CHIFFRES, null))
        assertEquals(PoseSimon.ATTEND, poseSimon(EtapeSimon.JOUE, null))
        assertEquals(PoseSimon.BAH_ALORS, poseSimon(EtapeSimon.BILAN, v(bah = true)))
        assertEquals(PoseSimon.FELICITE, poseSimon(EtapeSimon.BILAN, v(winners = listOf("A"))))
        // Une équipe éliminée : le prof reste sérieux, personne n'est félicité (cedric, 27/10).
        assertEquals(PoseSimon.ATTEND, poseSimon(EtapeSimon.BILAN, v()))
        assertEquals(PoseSimon.ATTEND, poseSimon(EtapeSimon.VERIF, v(winners = listOf("A"))))
    }

    @Test
    fun `premiere erreur - element faux ou manquant, rien si tout est juste`() {
        val bonne = suite.take(4)
        assertNull(erreurSimon(bonne, bonne))
        assertEquals(2, erreurSimon(listOf("rouge", "vert", "jaune", "4"), bonne))
        assertEquals(3, erreurSimon(suite.take(3), bonne))
        assertEquals(0, erreurSimon(emptyList(), bonne))
        assertEquals("6,1 s", secondesSimon(6_140))
        assertEquals("0,0 s", secondesSimon(0))
    }
}
