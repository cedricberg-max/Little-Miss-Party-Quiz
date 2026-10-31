package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.Ambiance
import com.littlemissparty.quiz.tv.habillage.DirecteurSonore
import com.littlemissparty.quiz.tv.habillage.Ecran
import com.littlemissparty.quiz.tv.habillage.Instant
import com.littlemissparty.quiz.tv.habillage.Ordre
import com.littlemissparty.quiz.tv.habillage.Son
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** ⏱️ Le Chrono de Buzzy à la TV : textes du chrono et des écarts, bornes de la règle, ordre de la révélation. */
class ChronoEcranTest {

    @Test
    fun `chrono au centieme, ecarts signes, pile`() {
        assertEquals("00,00", texteChrono(-40))
        assertEquals("07,45", texteChrono(7_456))
        assertEquals("+1,24 s", texteEcart(1_240))
        assertEquals("−0,80 s", texteEcart(-800))
        assertEquals("PILE !", texteEcart(3))
        assertEquals("+12,05 s", texteEcart(12_050))
    }

    @Test
    fun `la regle montre la cible et toutes les equipes, jamais avant 0`() {
        assertEquals(24 to 36, bornesRegle(30, listOf(-500L, 1_200L)))
        val (bas, haut) = bornesRegle(10, listOf(-9_000L, 14_500L))
        assertEquals(0, bas)
        assertTrue(haut >= 26)
        assertEquals(24 to 36, bornesRegle(30, emptyList()))
    }

    @Test
    fun `la plus loin d'abord, la plus proche en dernier`() {
        assertEquals(listOf("vert", "orange", "rose"), ordreRevelation(mapOf("orange" to -500L, "vert" to 1_200L, "rose" to 300L)))
    }

    @Test
    fun `sons de la revelation cales sur les images, le ralenti pour la plus proche, puis gagne, pile ou personne`() {
        val sons = sonsRevelation(mapOf("orange" to -500L, "vert" to 1_200L, "rose" to 300L), listOf("rose"))
        assertEquals(Son.CHRONO_REGLE, sons.first().son)
        assertEquals(listOf(Son.CHRONO_PASTILLE, Son.CHRONO_PASTILLE, Son.CHRONO_RALENTI), sons.drop(2).take(3).map { it.son })
        assertTrue("chaque pastille un peu plus aigue", sons[3].vitesse > sons[2].vitesse)
        val ralenti = sons.single { it.son == Son.CHRONO_RALENTI }
        assertEquals(REGLE_MS + 2 * PASTILLE_PAS_MS, ralenti.instant)
        assertEquals(SonChrono(ralenti.instant + PASTILLE_RALENTI_MS, Son.CHRONO_GAGNE), sons.last())
        assertEquals(Son.CHRONO_PILE, sonsRevelation(mapOf("orange" to 4L), listOf("orange")).last().son)
        assertEquals(Son.CHRONO_PERSONNE, sonsRevelation(emptyMap(), emptyList()).last().son)
    }

    @Test
    fun `musique legere au tour pret, silence des le depart du chrono (aucun rythme pour aider a compter) et a la revelation`() {
        val d = DirecteurSonore()
        val q = Instant(Ecran.QUESTION, partie = "ABCD", index = 3, equipes = 3, chronoEtape = "ready", gameShow = true)
        d.observer(q.copy(ecran = Ecran.PRESENTATION, chronoEtape = ""))
        d.observer(q)
        assertEquals(Ambiance.SILENCE, d.observer(q.copy(chronoEtape = "run")).filterIsInstance<Ordre.Musique>().last().ambiance)
        d.observer(q.copy(chronoEtape = "result"))
        assertEquals(Ambiance.SUSPENSE, d.observer(q.copy(chronoEtape = "ready")).filterIsInstance<Ordre.Musique>().last().ambiance)
    }

    @Test
    fun `le gagnant s'accorde au pluriel, et sa ligne arrive avec le son gagne`() {
        assertEquals("LES PANDAS GAGNENT LE TOUR !", phraseGagnant("Les Pandas"))
        assertEquals("LES SIRÈNES BLEUES GAGNENT LE TOUR !", phraseGagnant("les Sirènes bleues"))
        assertEquals("ORANGE GAGNE LE TOUR !", phraseGagnant("Orange"))
        assertEquals("LESLIE GAGNE LE TOUR !", phraseGagnant("Leslie"))
        val ecarts = mapOf("orange" to -500L, "vert" to 1_200L, "rose" to 300L)
        val gagne = sonsRevelation(ecarts, listOf("rose")).last()
        val r = com.littlemissparty.quiz.engine.ChronoResult(ecarts = ecarts, winners = listOf("rose"), points = 100, at = 0L)
        assertEquals(gagne.instant, finRevelation(r))
    }

    @Test
    fun `le drap fantome tombe, couvre le cadran avant que les chiffres disparaissent, puis se pose`() {
        val (haut, _) = positionDrap(0f, 0L)
        assertTrue("il part de haut", haut < -900f)
        // Les chiffres s'effacent à DRAP_COUVRE_MS : le drap est alors presque posé (le cadran va de 253 à 719 px,
        // l'ourlet du drap est à 871 px une fois posé).
        val (couvre, _) = positionDrap(DRAP_COUVRE_MS.toFloat() / DRAP_CHUTE_MS, DRAP_COUVRE_MS)
        assertTrue("le drap couvre le cadran ($couvre)", couvre > -140f)
        val (pose, ecrase) = positionDrap(1f, DRAP_CHUTE_MS + 130L)
        assertEquals(0f, pose, 0.01f)
        assertTrue("il s'écrase un peu en arrivant", ecrase < 0.97f)
        val (_, calme) = positionDrap(1f, DRAP_CHUTE_MS + 5_000L)
        assertEquals(1f, calme, 0.01f)
    }
}
