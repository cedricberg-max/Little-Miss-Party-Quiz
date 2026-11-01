package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.engine.SIMON_LONGUEUR_MAX
import com.littlemissparty.quiz.engine.SIMON_REGARDEZ_MS
import com.littlemissparty.quiz.engine.SIMON_VERIF_FIN_MS
import com.littlemissparty.quiz.engine.SIMON_VERIF_PAS_MS
import com.littlemissparty.quiz.engine.SimonAnswer
import com.littlemissparty.quiz.engine.SimonRound
import com.littlemissparty.quiz.engine.SimonVerdict
import com.littlemissparty.quiz.engine.reponseMs
import com.littlemissparty.quiz.engine.simonPasMs
import com.littlemissparty.quiz.tv.habillage.NotesSimon
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 🔴 Le Simon de Buzzy à la TV : ce que montre l'écran à chaque instant d'une suite. */
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
        val pas = simonPasMs(3)
        for (i in 0 until 3) {
            val v = vueSimon(r, montre + i * pas + 10, 10)
            assertEquals(EtapeSimon.MONTRE, v.etape)
            assertEquals(i, v.boule)
            assertTrue(v.allumee)
            // Un petit noir avant la boule suivante.
            assertFalse(vueSimon(r, montre + i * pas + simonAllumeMs(pas) + 10, 10).allumee)
        }
        val reponse = montre + 3 * pas
        val joue = vueSimon(r, reponse, 10)
        assertEquals(EtapeSimon.JOUE, joue.etape)
        assertEquals(10, joue.reste)
        assertEquals(1, vueSimon(r, reponse + reponseMs(3, 10) - 1, 10).reste)
        assertEquals(EtapeSimon.TEMPS, vueSimon(r, reponse + reponseMs(3, 10), 10).etape)
    }

    @Test
    fun `suite longue - les boules defilent plus vite, chacune allumee puis un petit noir`() {
        // cedric, 29/10 : plus la suite grandit, plus elle défile vite.
        for (n in listOf(1, 4, 8, 12)) {
            val r = tour(n.coerceAtMost(suite.size)).copy(sequence = List(n) { suite[it % suite.size] }, suite = n)
            val montre = t0 + SIMON_REGARDEZ_MS
            val pas = simonPasMs(n)
            for (i in 0 until n) {
                val v = vueSimon(r, montre + i * pas + 10, 10)
                assertEquals("suite de $n, boule $i", i, v.boule)
                assertTrue(v.allumee)
                assertFalse(vueSimon(r, montre + i * pas + simonAllumeMs(pas) + 10, 10).allumee)
            }
            assertEquals(EtapeSimon.JOUE, vueSimon(r, montre + n * pas, 10).etape)
            // Au moins 100 ms de noir entre deux boules, même au plus rapide.
            assertTrue(pas - simonAllumeMs(pas) >= 100)
        }
        assertTrue(simonPasMs(8) < simonPasMs(3))
    }

    @Test
    fun `la note de chaque boule dure le temps ou elle est allumee, jamais coupee a rien`() {
        for (n in 1..20) {
            val note = simonAllumeMs(simonPasMs(n)).toInt().coerceIn(NotesSimon.DUREE_MIN_MS, NotesSimon.DUREE_MS)
            assertTrue("suite de $n", note >= 250 && note <= simonPasMs(n))
        }
        assertEquals(NotesSimon.DUREE_MS, simonAllumeMs(simonPasMs(1)).toInt().coerceAtMost(NotesSimon.DUREE_MS))
    }

    @Test
    fun `plus de chiffres - la suite de 4 commence directement par regardez bien`() {
        // cedric, 29/10 : seulement des boules de couleur, plus d'annonce « Les chiffres débarquent ».
        assertEquals(EtapeSimon.REGARDEZ, vueSimon(tour(4), t0 + 100, 10).etape)
        assertEquals(EtapeSimon.REGARDEZ, vueSimon(tour(8), t0 + 100, 10).etape)
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

    @Test
    fun `jusqu'a la suite la plus longue, les boules tiennent dans la ligne`() {
        // cedric, 30/10 : « qu'est-ce qui se passe quand le nombre de boules dépasse la ligne ? » Elles rapetissent.
        for (largeur in listOf(1676f, 1400f)) for (h in listOf(100f, 72f)) for (n in 1..SIMON_LONGUEUR_MAX) {
            val t = tailleBouleSimon(n, h, largeur)
            assertTrue("suite de $n, ligne de $h dp, tableau de $largeur dp", n * t + (n - 1) * t * 0.2f <= placeBoulesSimon(largeur) + 0.5f)
            assertTrue("boules jamais minuscules", t >= 20f)
        }
        assertTrue(tailleBouleSimon(20, 100f, 1676f) < tailleBouleSimon(5, 100f, 1676f))
    }

    @Test
    fun `plus jamais de « joueur n° » a l'ecran, l'equipe joue (choix A de cedric, 31 octobre)`() {
        val src = java.io.File("src/main/java/com/littlemissparty/quiz/tv/SimonScreens.kt").readText()
        assertFalse(src.contains("\"joueur n°"))
        assertFalse(src.contains("joueur appelé prend"))
        assertTrue(src.contains("if (dehors) \"éliminés\" else \"encore en jeu\""))
    }

    @Test
    fun `duel des robots - jamais de « joueur n° » non plus, seulement le nom de l'equipe (cedric, 31 octobre au soir)`() {
        for (f in listOf("habillage/DuelWestern.kt", "habillage/DuelRobots.kt")) {
            val src = java.io.File("src/main/java/com/littlemissparty/quiz/tv/$f").readText()
            // Seulement les textes entre guillemets (les commentaires peuvent citer la règle).
            val textes = Regex("\"[^\"\n]*\"").findAll(src).map { it.value.lowercase() }
            assertFalse(f, textes.any { "joueur n°" in it })
        }
    }

    @Test
    fun `plaques des equipes, deux rangees au-dela de 4, le tableau leur laisse la place, l'etat jamais coupe`() {
        assertEquals(1, plaquesParRangee(1))
        assertEquals(4, plaquesParRangee(4))
        assertEquals(3, plaquesParRangee(5))
        assertEquals(4, plaquesParRangee(7))
        assertEquals(4, plaquesParRangee(8))
        assertEquals(190f, basTableauSimon(4))
        // Deux rangées de 92 dp, 12 dp entre elles, posées à 36 dp du bas : le tableau s'arrête au-dessus.
        assertTrue(basTableauSimon(8) >= 36f + 2 * 92f + 12f + 20f)
        val src = java.io.File("src/main/java/com/littlemissparty/quiz/tv/SimonScreens.kt").readText()
        val plaques = src.substringAfter("private fun Plaques(").substringBefore("internal fun plaquesParRangee")
        assertTrue("UneLigneQuiTient(echelleMin = 0.6f) {\n                            Text(p.etat" in plaques)
    }
}
