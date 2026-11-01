package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.Ambiance
import com.littlemissparty.quiz.tv.habillage.DirecteurSonore
import com.littlemissparty.quiz.tv.habillage.Ecran
import com.littlemissparty.quiz.tv.habillage.Instant
import com.littlemissparty.quiz.tv.habillage.Lit
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.Ordre
import com.littlemissparty.quiz.tv.habillage.Son
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import com.littlemissparty.quiz.engine.ChronoBuzz

/** ⏱️ Le Chrono de Buzzy à la TV : textes du chrono et des écarts, bornes de la règle, ordre de la révélation. */
class ChronoEcranTest {
    /** cedric, 31/10 : chaque buzz de réponse joue le mot Daft Punk de l'équipe, dans tous les jeux (ici sous le drap). */
    @Test
    fun `chaque buzz sous le drap joue le mot de son equipe`() {
        val equipes = listOf("a", "b", "c")
        val buzz = listOf(ChronoBuzz("c", 30_100, 1), ChronoBuzz("a", 30_400, 2), ChronoBuzz("z", 31_000, 3))
        assertEquals(listOf(Son.equipe(2), Son.equipe(0), Son.CHRONO_BUZZ), sonsNouveauxBuzz(buzz, 0, equipes))
        // Deux buzz arrivés d'un coup : les deux mots ; ceux déjà entendus ne repassent pas.
        assertEquals(listOf(Son.equipe(0), Son.CHRONO_BUZZ), sonsNouveauxBuzz(buzz, 1, equipes))
        assertEquals(emptyList<Son>(), sonsNouveauxBuzz(buzz, 3, equipes))
    }


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
    fun `la plus loin d'abord, la plus proche en dernier`() {
        assertEquals(listOf("vert", "orange", "rose"), ordreRevelation(mapOf("orange" to -500L, "vert" to 1_200L, "rose" to 300L)))
    }

    @Test
    fun `sons de la revelation cales sur les images, le ralenti pour la plus proche, puis gagne, pile ou personne`() {
        val sons = sonsRevelation(mapOf("orange" to -500L, "vert" to 1_200L, "rose" to 300L), listOf("rose"))
        assertEquals(listOf(Son.CHRONO_REGLE, Son.CHRONO_DRAPEAU), sons.take(2).map { it.son })
        assertEquals(REV_DRAPEAU_MS, sons[1].instant)
        assertEquals(
            listOf(Son.WHOOSH, Son.CHRONO_PASTILLE, Son.WHOOSH, Son.CHRONO_PASTILLE, Son.WHOOSH, Son.CHRONO_RALENTI),
            sons.drop(2).take(6).map { it.son },
        )
        assertEquals("dans l'ordre du temps", sons.map { it.instant }.sorted(), sons.map { it.instant })
        val pastilles = sons.filter { it.son == Son.CHRONO_PASTILLE }
        assertTrue("chaque pastille un peu plus aigue", pastilles[1].vitesse > pastilles[0].vitesse)
        assertEquals(arriveeLigne(0, 3) + 300, pastilles[0].instant)
        val ralenti = sons.single { it.son == Son.CHRONO_RALENTI }
        assertEquals(arriveeLigne(2, 3) + 300, ralenti.instant)
        assertEquals(SonChrono(finRevelation(3), Son.CHRONO_GAGNE, volume = 1f), sons.last())
        assertTrue("la gagnante finit de glisser avant la fanfare", ralenti.instant < sons.last().instant)
        assertEquals(Son.CHRONO_PILE, sonsRevelation(mapOf("orange" to 4L), listOf("orange")).last().son)
        assertEquals(Son.CHRONO_PERSONNE, sonsRevelation(emptyMap(), emptyList()).last().son)
    }

    @Test
    fun `les lignes des equipes tiennent toujours dans l ecran, plus serrees a 8`() {
        for (n in 1..8) {
            val g = geoResultats(n)
            assertTrue("$n équipes : la dernière ligne tient (${g.y0 + (n - 1) * g.h})", g.y0 + (n - 1) * g.h + g.h / 2 <= 1080f)
            assertTrue("$n équipes : sous la ligne repère", g.y0 > g.yRepere + 60f)
            assertTrue(g.police in 20f..44f)
        }
        assertEquals(130f, geoResultats(2).h, 0.01f)
        assertTrue(geoResultats(8).h < geoResultats(4).h)
        assertTrue("plus rapide à 8", finRevelation(8) < 8 * 1_100L + REV_PREMIERE_MS)
    }

    @Test
    fun `la ligne du temps contient toutes les equipes`() {
        assertEquals(2, demiRegle(listOf(-500L, 1_200L)))
        assertEquals(3, demiRegle(listOf(2_680L)))
        assertEquals(15, demiRegle(listOf(-9_000L, 14_500L)))
        assertEquals(2, demiRegle(emptyList()))
        assertTrue(15 / pasGraduation(15) <= 6)
        assertEquals(1, pasGraduation(2))
    }

    @Test
    fun `Around the World doux au tour pret, silence au tic-tac, nappe sous le drap, boucle B a la revelation`() {
        val d = DirecteurSonore()
        val q = Instant(Ecran.QUESTION, partie = "ABCD", index = 3, equipes = 3, chronoEtape = "ready", gameShow = true)
        fun musique(i: Instant) = d.observer(i).filterIsInstance<Ordre.Musique>().last()
        d.observer(q.copy(ecran = Ecran.PRESENTATION, chronoEtape = ""))
        d.observer(q)
        assertEquals("« Prêts ? » : gs_bed_light (0:31,9), doux", 0.4f, Ambiance.CHRONO_PRET.volume(Lit.LEGER, gs = true), 0.001f)
        val tic = musique(q.copy(chronoEtape = "run"))
        assertEquals("on n'entend que le tic-tac", Ambiance.SILENCE, tic.ambiance)
        assertEquals(Tempo.FONDU_RELAIS, tic.fonduMs)
        val nappe = musique(q.copy(chronoEtape = "drap"))
        assertEquals(Ambiance.CHRONO_NAPPE, nappe.ambiance)
        assertEquals(Tempo.CHRONO_NAPPE_ENTREE, nappe.fonduMs)
        assertEquals("aucun rythme sous le drap", 0f, Ambiance.CHRONO_NAPPE.volume(Lit.LEGER, gs = true), 0f)
        val b = musique(q.copy(chronoEtape = "result"))
        assertEquals(Ambiance.CHRONO_REVELATION, b.ambiance)
        assertEquals(0.75f, Ambiance.CHRONO_REVELATION.volume(Lit.CHRONO_REVELATION, gs = true), 0.001f)
        assertEquals("tour suivant", Ambiance.CHRONO_PRET, musique(q.copy(chronoEtape = "ready")).ambiance)
    }

    @Test
    fun `le clip du lancer part pour que le drap se pose pile au moment tire par la box, les chiffres s'effacent juste avant`() {
        // Drap à 8 s : Buzzy part chercher le drap à 2,38 s (pendant que les chiffres défilent), le drap se pose à 8 s pile.
        assertEquals(8_000L - LANCER_POSE_MS, departLancer(8_000L))
        assertEquals(2_380L, departLancer(8_000L) + LANCER_PREFIXE_MS)
        assertEquals("à 2 s, le clip est dans ses boucles d'attente", LANCER_POSE_MS - 6_000L, tempsLancer(2_000L, 8_000L))
        assertEquals(LANCER_POSE_MS, tempsLancer(8_000L, 8_000L))
        assertTrue("les chiffres tournent encore pendant que Buzzy va chercher le drap", chiffresVisibles(7_000L, 8_000L))
        assertTrue("le drap couvre le cadran : plus de chiffres", !chiffresVisibles(7_800L, 8_000L))
        assertTrue("effacés avant que le drap ne se pose", LANCER_COUVRE_MS < LANCER_POSE_MS)
        // Buzzy n'est jamais figé (cedric, 1/11) : quel que soit le moment du drap, le clip (ses boucles d'attente) tourne déjà
        // quand le décompte commence, et le lancer lui-même ne part jamais avant « Lancer ».
        for (cache in listOf(3_600L, com.littlemissparty.quiz.engine.CHRONO_CACHE_MIN_MS, com.littlemissparty.quiz.engine.CHRONO_CACHE_MAX_MS)) {
            assertTrue("drap à $cache ms", departLancer(cache) <= -com.littlemissparty.quiz.engine.CHRONO_DECOMPTE_MS)
            assertTrue("drap à $cache ms", departLancer(cache) + LANCER_PREFIXE_MS > -com.littlemissparty.quiz.engine.CHRONO_DECOMPTE_MS)
        }
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
