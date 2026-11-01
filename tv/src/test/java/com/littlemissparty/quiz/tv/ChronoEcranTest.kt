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
        assertEquals(SonChrono(ralenti.instant + PASTILLE_RALENTI_MS, Son.CHRONO_GAGNE, volume = 1f), sons.last())
        assertTrue("les petits sons à 0,7 sous la boucle B", sons.dropLast(1).all { it.volume == CHRONO_SFX_VOLUME })
        assertEquals(Son.CHRONO_PILE, sonsRevelation(mapOf("orange" to 4L), listOf("orange")).last().son)
        assertEquals(Son.CHRONO_PERSONNE, sonsRevelation(emptyMap(), emptyList()).last().son)
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

    @Test
    fun `etiquettes sous la regle, jamais deux qui se touchent sur la meme rangee a 8 equipes`() {
        // Le cas des captures du 31/10 : Ninjas et Pirates du lac côte à côte sur la même rangée.
        val x = listOf(300f, 420f, 560f, 640f, 1180f, 1260f, 1400f, 1600f)
        val r = rangeesEtiquettes(x)
        for (i in x.indices) for (j in i + 1 until x.size) if (r[i] == r[j]) assertTrue("$i et $j se touchent", x[j] - x[i] >= ETIQUETTE_L)
        assertTrue(r.all { it in 0..3 })
        assertEquals(listOf(0, 1, 2, 3), rangeesEtiquettes(listOf(100f, 110f, 120f, 130f)))
        assertEquals(listOf(0, 0), rangeesEtiquettes(listOf(100f, 900f)))
    }

    @Test
    fun `huit equipes serrees, les etiquettes se decalent mais ne se touchent jamais`() {
        // Le cas des captures du 31/10 (8 h) : Panthères, Dragons dorés, Pirates du lac, Sirènes bleues à droite, serrées.
        val x = listOf(600f, 820f, 969f, 1025f, 1170f, 1206f, 1236f, 1330f)
        val noms = listOf("Les Fusées", "Les Comètes", "Les Ninjas", "Les Licornes roses", "Les Panthères", "Les Dragons dorés", "Les Pirates du lac", "Les Sirènes bleues")
        val l = noms.map { largeurEtiquette(it, "+2,68 s · +100") }
        val p = placesEtiquettes(x, l)
        for (i in x.indices) for (j in i + 1 until x.size) if (p[i].first == p[j].first) {
            assertTrue("$i et $j se touchent", p[j].second - l[j] / 2 >= p[i].second + l[i] / 2)
        }
        p.forEachIndexed { i, (_, cx) -> assertTrue("dans l'écran", cx - l[i] / 2 >= 0f && cx + l[i] / 2 <= 1920f) }
        // Sans voisine, l'étiquette reste juste sous sa pastille.
        assertEquals(600f, p[0].second, 0.01f)
    }

    @Test
    fun `la largeur estimee d une etiquette colle a la capture TV`() {
        // Capture du 31/10 (8 h 30) : « LES FUSÉES » occupe environ 260 px de la scène, « +0,35 s · +100 » environ 255 px.
        assertTrue(largeurEtiquette("Les Fusées", "") >= 262f)
        assertTrue(largeurEtiquette("", "+0,35 s · +100") >= 255f)
        // Un nom très long reste plafonné : le texte se réduit au lieu de déborder.
        assertEquals(ETIQUETTE_L, largeurEtiquette("Les Supers Licornes Arc-en-ciel", ""), 0.01f)
    }
}
