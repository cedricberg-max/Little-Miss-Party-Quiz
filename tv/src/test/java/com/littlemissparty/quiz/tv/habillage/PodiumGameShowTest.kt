package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Podium du Game Show, version A « suspense » : les compteurs ne trahissent jamais le gagnant avant le solo, ne
 * dépassent jamais un vrai score, et les tubes tiennent à l'écran de 1 à 8 équipes.
 */
class PodiumGameShowTest {

    private val scores = listOf(900, 770, 640, 510)
    private val revelation = Tempo.PODIUM_REVELATION.toFloat()

    @Test
    fun `jusqu'a la montee finale, le premier et le deuxieme restent au meme niveau`() {
        for (s in listOf(scores, listOf(900, 899), listOf(1_000, 10, 5), listOf(300), listOf(500, 0, 0), listOf(640, 900, 900, 120))) {
            val meilleur = s.max()
            // Le deuxième score qui a marqué (personne d'autre : le gagnant est seul face à des tubes vides).
            val deuxieme = s.filter { it in 1 until meilleur }.maxOrNull() ?: meilleur
            for (ms in 0 until MONTEE_DEBUT.toInt() step 50) {
                val m = ms.toFloat()
                assertEquals("$s à $ms ms", valeurSuspense(m, deuxieme, s), valeurSuspense(m, meilleur, s))
                assertEquals("$s à $ms ms", remplissage(m, deuxieme, s), remplissage(m, meilleur, s), 1e-6f)
            }
            // Tenu au plafond : en dessous du vrai score du gagnant (et du deuxième quand il y en a un).
            assertTrue(valeurSuspense(MONTEE_DEBUT, meilleur, s) < meilleur)
            if (deuxieme < meilleur) assertTrue(valeurSuspense(MONTEE_DEBUT, deuxieme, s) < deuxieme)
        }
    }

    @Test
    fun `apres la montee finale, chacun est a son vrai score et le gagnant remplit son tube`() {
        for (s in listOf(scores, listOf(900, 899), listOf(1_000, 10, 5), listOf(300), listOf(500, 0, 0), listOf(640, 900, 900, 120))) {
            val meilleur = s.max()
            for (p in s) {
                assertEquals("$s : $p", p, valeurSuspense(MONTEE_FIN, p, s))
                assertEquals("$s : $p", maxOf(0.03f, p.toFloat() / meilleur), remplissage(MONTEE_FIN, p, s), 1e-6f)
            }
            // Le tube du gagnant (des deux ex aequo) est plein, et lui seul brille ; tout est fini avant la descente.
            s.forEach { p ->
                assertEquals(maxOf(0.03f, p.toFloat() / meilleur), remplissage(DESCENTE_DEBUT, p, s), 1e-6f)
                if (p == meilleur) assertEquals(1f, remplissage(DESCENTE_DEBUT, p, s), 0f)
                assertEquals(p == meilleur, tubePlein(DESCENTE_DEBUT, p, s) > 0f)
                assertEquals(0f, tubePlein(MONTEE_FIN - 1f, p, s), 0f)
            }
        }
        // Personne n'a marqué : rien ne brille, les tubes gardent leur fond de liquide.
        assertEquals(0f, tubePlein(DESCENTE_DEBUT, 0, listOf(0, 0)), 0f)
        assertEquals(0.03f, remplissage(DESCENTE_DEBUT, 0, listOf(0, 0)), 0f)
        assertTrue(JAUGES_FIN <= MONTEE_DEBUT && MONTEE_FIN + 400f <= DESCENTE_DEBUT)
    }

    @Test
    fun `aucun compteur ne depasse son vrai score, aucun ne redescend`() {
        val s = listOf(900, 770, 640, 510, 693, 120, 0, -40)
        val avant = IntArray(s.size)
        for (ms in 0..20_000 step 40) s.forEachIndexed { i, p ->
            val v = valeurSuspense(ms.toFloat(), p, s)
            assertTrue("$p à $ms ms : $v", v <= p.coerceAtLeast(0))
            assertTrue("$p à $ms ms recule", v >= avant[i])
            avant[i] = v
        }
        // Sous le plafond (90 % de 770 = 693), chacun finit exactement sur son score dès la fin de la montée.
        for (p in listOf(640, 510, 693, 120, 0)) assertEquals(p, valeurSuspense(JAUGES_FIN, p, s))
        assertEquals(0, valeurSuspense(JAUGES_DEBUT, 900, s))
    }

    @Test
    fun `plafond, personne n'a marque, une seule equipe, malus`() {
        assertEquals(693f, plafondSuspense(scores), 1e-3f)
        assertEquals(675f, plafondSuspense(listOf(900, 0, 0)), 1e-3f)
        assertEquals(225f, plafondSuspense(listOf(300)), 1e-3f)
        assertEquals(0f, plafondSuspense(listOf(0, 0)), 0f)
        assertEquals(0f, plafondSuspense(emptyList()), 0f)
        // Égalité en tête : le plafond vient du score juste en dessous ; les ex aequo restent ensemble.
        assertEquals(540f, plafondSuspense(listOf(800, 800, 600)), 1e-3f)
        // Tubes : toujours un fond de liquide, jamais plein avant la montée finale, jamais négatif.
        assertEquals(0.03f, remplissage(15_000f, 0, listOf(0, 0)), 0f)
        assertEquals(0.03f, remplissage(15_000f, -100, listOf(300, -100)), 0f)
        assertTrue(remplissage(MONTEE_DEBUT, 900, scores) < 1f)
        assertEquals(1f, remplissage(revelation, 900, scores), 0f)
    }

    @Test
    fun `les tubes s'enfoncent juste avant le solo, apres la montee`() {
        assertTrue(JAUGES_FIN < DESCENTE_DEBUT && DESCENTE_FIN < revelation)
        assertEquals(0f, descenteTubes(DESCENTE_DEBUT), 0f)
        assertEquals(1f, descenteTubes(DESCENTE_FIN), 0f)
        assertEquals(1f, descenteTubes(revelation), 0f)
        // Descente complète : le haut des compteurs passe sous la fente.
        assertTrue(TUBE_HAUT - 60f + 380f > FENTE_Y)
        assertTrue(TUBE_HAUT + TUBE_HAUTEUR < FENTE_Y)
    }

    @Test
    fun `de 1 a 8 equipes, les tubes et leurs noms tiennent a l'ecran sans se toucher ni cacher le robot`() {
        for (n in 1..8) {
            val p = dispositionTubes(n)
            assertEquals(n, p.size)
            val robot = 480f - 120f..480f + 120f
            p.forEach {
                assertTrue("$n : tube hors écran", it.centre - it.largeur / 2 >= 0f && it.centre + it.largeur / 2 <= 960f)
                assertTrue("$n : tube sur le robot", it.centre + it.largeur / 2 < robot.start || it.centre - it.largeur / 2 > robot.endInclusive)
                assertTrue("$n : nom hors écran", it.centre - it.placeNom / 2 >= 7.9f && it.centre + it.placeNom / 2 <= 952.1f)
                assertTrue(it.echelle in 0.5f..1.15f)
            }
            // Deux tubes voisins ne se touchent pas ; deux noms sur la même ligne non plus.
            val tries = p.sortedBy { it.centre }
            tries.zipWithNext { a, b -> assertTrue("$n : tubes collés", b.centre - a.centre >= (a.largeur + b.largeur) / 2 + 8f) }
            for (ligne in listOf(true, false)) {
                p.filter { it.decale == ligne }.sortedBy { it.centre }.zipWithNext { a, b ->
                    assertTrue("$n : noms qui se chevauchent", b.centre - a.centre >= (a.placeNom + b.placeNom) / 2 - 0.01f)
                }
            }
        }
        // Moitié (arrondie au-dessus) à gauche de l'arche, le reste à droite.
        assertEquals(4, dispositionTubes(7).count { it.centre < 480f })
        assertEquals(1, dispositionTubes(1).count { it.centre < 480f })
    }

    @Test
    fun `le nom nerveux claque sur le solo et retombe a sa taille, sans grossir au-dela de 2,4`() {
        for (l in listOf(1, 6, 12, 30)) {
            val ev = evenementsNerveux(l)
            assertEquals(NV_D0, ev.t1, 0f)
            assertTrue(ev.tMot > ev.t1 - 0.01f && ev.tPts > ev.tMot)
            // Avant sa chute, une lettre n'est pas là ; à la fin, elle est à sa taille (au battement près).
            for (i in 0 until l) {
                assertEquals(null, etatLettre(NV_D0 + i * ev.pas - 0.001f, i, ev))
                var max = 0f
                var u = NV_D0 + i * ev.pas + 0.001f
                while (u < ev.tMot + 3f) {
                    etatLettre(u, i, ev)!!.also { max = maxOf(max, it.echelle) }
                    u += 0.01f
                }
                assertTrue("lettre $i de $l : $max", max <= 2.4f * 1.0f + 1e-3f)
                val fin = etatLettre(ev.tMot + 2.95f, i, ev)!!
                assertEquals(1f, fin.alpha, 0f)
                assertTrue(fin.echelle in 1f..1.09f)
            }
            // La secousse ne dure que le temps des deux impacts.
            assertEquals(0f, secousseNerveuse(ev.tMot + 0.5f, l).x, 0f)
            assertEquals(0f, secousseNerveuse(-1f, l).y, 0f)
        }
        // Le premier temps de chaque mesure est accentué.
        val ev = evenementsNerveux(10)
        assertTrue(poulsNerveux(8 * NV_BT + 0.001f, ev.tMot) > poulsNerveux(9 * NV_BT + 0.001f, ev.tMot))
        assertEquals(0f, poulsNerveux(ev.tMot - 0.01f, ev.tMot), 0f)
    }

    @Test
    fun `les clips du robot et les planches du tube sont dans l'appli`() {
        for (f in listOf(ROBOT_FETE, ROBOT_AU_REVOIR, ROBOT_ATTENTE, ROBOT_TAMBOUR)) assertTrue("$f manquant", File("src/main/res/raw/$f.mp4").isFile)
        for (f in listOf("haut", "corps", "bas", "liquide")) assertTrue("gs_jauge_$f manquant", File("src/main/res/drawable-nodpi/gs_jauge_$f.webp").isFile)
        // Le robot attend en boucle puis joue du tambour : le tambour (4 s) finit au moment où la fête commence.
        assertTrue(ROBOT_TAMBOUR_AVANT_MS - 300 in 3_900L..4_100L)
    }

    @Test
    fun `la fete en plan cinema est dans l'appli et sa boucle part apres les 8 temps d'arrivee`() {
        assertTrue(File("src/main/res/raw/gs_podium_fete.mp4").isFile)
        // 96 images à 25 i/s (8 temps de Digital Love) : une image clé y est posée pour une reprise sans saut.
        assertEquals(3_840, FETE_BOUCLE_DEBUT_MS)
    }

    @Test
    fun `nom du gagnant en neon plein, sans reflet sur le haut des lettres, filigrane A derriere le nom et les points`() {
        // Choix de cedric (30/10) d'après la maquette en 1080p : contour sombre fin (4 px → 2 dp de chaque côté du bord),
        // deux lueurs (écarts types 44 et 20 px), filigrane #06020E à 80 %, flou de 45 px, 90 px de plus que le texte.
        assertEquals(4f, NOM_CONTOUR_DP, 0f)
        assertTrue(NOM_LUEUR_LARGE_DP > NOM_LUEUR_SERREE_DP)
        assertEquals(0.8f, FILIGRANE_OPACITE, 0f)
        assertEquals(45f, FILIGRANE_MARGE_DP, 0f)
        assertEquals(22.5f, FILIGRANE_FLOU_DP * 0.57735f + 0.5f, 0.5f)
        assertEquals(42f, POINTS_SOUS_NOM_DP, 0f)
        // Plus aucun reflet fixe sur le haut des lettres, ni voile en dégradé : le corps du nom est une lettre pleine.
        val source = File("src/main/java/com/littlemissparty/quiz/tv/habillage/NomNerveux.kt").readText()
        val corps = source.substringAfter("// Corps, néon plein").substringBefore("// Flash blanc")
        assertTrue(corps.contains("drawText(l.mise, couleur, o"))
        assertTrue(!corps.contains("verticalGradient") && !corps.contains("Brush."))
        assertTrue(!source.contains("radialGradient(listOf(GS.Noir"))
    }
}
