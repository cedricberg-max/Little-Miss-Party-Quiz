package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.graphics.Color
import com.littlemissparty.quiz.tv.appelBombe
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Les onglets d'appel du Game Show (« BUZZEZ ! », « MÉMORISEZ ! », « TAPEZ ! »…), validés par cedric le 31/10 à 11:12 :
 * un onglet par jeu, branché à sa place, jamais coupé, sans contour jauges, sans blanc pur sur fond sombre.
 */
class PlaqueAppelTest {
    private fun source(chemin: String) = File("src/main/java/com/littlemissparty/quiz/tv/$chemin").readText()

    @Test
    fun `chaque jeu a son onglet, en Game Show seulement`() {
        val floue = source("ImageFloue.kt")
        assertTrue(floue.contains("Look.gs -> appelGs(q).let { (genre, ligne) -> PlaqueAppel(genre, \"BUZZEZ !\", ligne) }"))
        // Qui a disparu : la tête de Buzzy et « Regardez bien ! », sans « les objets » (choix de cedric, 1/11).
        assertTrue(floue.contains("PlaqueAppel(GenrePlaque.DISPARU, \"REGARDEZ BIEN !\", \"\")"))
        assertTrue(floue.contains("TeteBuzzyMemorise()"))
        assertFalse(floue.contains("OeilMemorise()"))
        assertFalse(floue.lowercase().contains("les objets"))
        listOf("DISPARU", "CHANTE", "QUISUIS", "BLIND", "FLOUE").forEach { assertTrue(it, floue.contains("GenrePlaque.$it to ")) }
        // Classique : les appels en texte restent.
        assertTrue(floue.contains("\"Regardez bien !\""))
        assertTrue(source("BlindTestEcrans.kt").contains("b != null && b.waiting && !b.played -> PlaqueAppel(GenrePlaque.BLIND, \"PRÊTS ?\", \"Écoutez bien…\""))
        assertTrue(source("habillage/BlindTestScenes.kt").contains("PlaqueAppel(GenrePlaque.BLIND, \"PRÊTS ?\", \"Écoutez bien…\""))
        assertTrue(source("habillage/BlindTestScenes.kt").contains("TitreBlindTest(px(76f)"))
        assertTrue(source("GonfleurScreens.kt").contains("PlaqueAppel(GenrePlaque.GONFLEUR, \"GONFLEZ LE BALLON !\", \"le premier ballon qui éclate gagne\")"))
        assertTrue(source("PatateScreens.kt").contains("PlaqueAppel(GenrePlaque.BOMBE, appel.first, appel.second)"))
        assertTrue(source("habillage/DuelWestern.kt").contains("PlaqueAppel(GenrePlaque.DUEL, \"LA MAIN AU-DESSUS DU BUZZER !\", \"les deux joueurs\""))
        assertTrue(source("habillage/QuiSuisGs.kt").contains("PlaqueAppel(GenrePlaque.QUISUIS, \"BUZZEZ !\""))
    }

    @Test
    fun `gonfleur fou - on gonfle au vrai buzzer, jamais un mot sur les tablettes`() {
        // cedric, 31/10 au soir : ni « Tapez vite sur la tablette ! » en haut, ni « sur vos tablettes » en bas.
        for (f in listOf("GonfleurScreens.kt", "habillage/Gonfleur.kt")) {
            val texte = Regex("\"[^\"]*\"").findAll(source(f)).map { it.value.lowercase() }
            assertTrue(f, texte.none { "tablette" in it || "tapez" in it || "tapé" in it })
        }
        assertTrue(source("GonfleurScreens.kt").contains("\"Gonflez le ballon ! Le premier ballon qui éclate gagne !\""))
    }

    @Test
    fun `la bombe - trois appels, le mot et la petite ligne`() {
        assertEquals("ATTENTION !" to "une nouvelle bombe arrive", appelBombe(annonce = true, secondes = 2L))
        assertEquals("VITE !" to "envoyez la bombe ! Elle explose dans 2…", appelBombe(annonce = false, secondes = 2L))
        assertEquals("VITE !" to "envoyez la bombe à une autre équipe sur votre tablette", appelBombe(annonce = false, secondes = null))
    }

    @Test
    fun `Statues - DANSEZ reste seul, plus d'onglet ni de petite ligne`() {
        val statues = source("habillage/StatuesGameShow.kt")
        assertFalse(statues.contains("LigneBuzz(\"BOUGEZ TANT QUE LA MUSIQUE JOUE\""))
        assertTrue(statues.contains("LettresQuiDansent(\"DANSEZ !\""))
    }

    @Test
    fun `jamais coupe, pas de contour jauges, pas de blanc pur sur la petite ligne`() {
        val plaque = source("habillage/PlaqueAppel.kt")
        assertFalse("jamais de « … »", plaque.contains("TextOverflow.Ellipsis"))
        assertFalse("pas de contour jauges sur les onglets", plaque.contains("TexteJauge("))
        // Trop grand pour sa place : tout rapetisse d'un même facteur, la plaque comme le titre du Blind test.
        assertEquals(3, Regex("ajusteSaPlace\\(\\)").findAll(plaque).count())
        assertEquals(Color(0xFFECE8F6), BlancDoux)
        assertEquals(Color(0xFFBFF6FF), LigneBleuNuit)
        // Image floue et Chante le mot : fond et lettres exactement comme le Blind test (référence de cedric, 11:09).
        val fondBleuNuit = "listOf(Color(0xFF0C2A48), Color(0xFF051425))"
        assertEquals(3, Regex(Regex.escape(fondBleuNuit)).findAll(plaque).count())
        assertEquals(3, Regex("PoliceGsTitre, LigneBleuNuit, 24f").findAll(plaque).count())
        // Les autres plaques : petite ligne en blanc doux ou crème, jamais en blanc pur.
        assertFalse(plaque.contains("PoliceGsTitre, Color.White,"))
        assertFalse(plaque.contains("PoliceGsWestern, Color.White,"))
    }

    @Test
    fun `Qui a disparu - les cartes glissent vers la gauche, sur la grille des equipes`() {
        assertEquals(24f, com.littlemissparty.quiz.tv.DECALAGE_CARTES_DISPARU.value)
        assertTrue(source("Disparu.kt").contains("padding(start = if (Look.gs) 0.dp else 24.dp, end = if (Look.gs) DECALAGE_CARTES_DISPARU * 2 else 24.dp"))
    }

    @Test
    fun `Qui suis-je - l'enseigne 7 pour cent plus grande`() {
        assertEquals(1.07f, AGRANDI_ENSEIGNE)
        assertTrue(source("habillage/QuiSuisGs.kt").contains("fontSize = 46.sp * AGRANDI_ENSEIGNE"))
    }

    @Test
    fun `Gonfleur - la plaque s'ecrase, les lettres restent droites`() {
        val plaque = source("habillage/PlaqueAppel.kt")
        assertTrue(plaque.contains("GenrePlaque.GONFLEUR -> { scaleX = 1f + 0.03f * ecrase; scaleY = 1f - 0.06f * ecrase }"))
        assertTrue(plaque.contains("scaleX = 1f / (1f + 0.03f * ecrase); scaleY = 1f / (1f - 0.06f * ecrase)"))
    }

    @Test
    fun `Blind test - les onglets a la taille et a la place de la planche, plus dans la scene qui rapetisse`() {
        val intro = source("habillage/BlindTestScenes.kt")
        // Présentation : titre 76 px bord gauche x 400 centre y 222 ; info rose 24 px x 406 y 300 ; « PRÊTS ? » x 400 y 398.
        assertTrue(intro.contains("if (Look.gs) CalquePlanche(Modifier.matchParentSize())"))
        assertTrue(intro.contains("TitreBlindTest(px(76f), Modifier.planche(400f, 222f, ancreX = 0f)"))
        assertTrue(intro.contains("fontSize = pxSp(24f)"))
        assertTrue(intro.contains("Modifier.planche(406f, 300f, ancreX = 0f)"))
        assertTrue(intro.contains("Modifier.planche(400f, 398f, ancreX = 0f).apparition(1700, playlist), k = k)"))
        assertFalse("plus de titre rapetissé avec la scène", intro.contains("TitreBlindTest((76f * 0.75f * ECHELLE_SCENE_BLIND).dp"))
        // Écoute : « Morceau » x 950 y 226, points y 260 (26 px), l'onglet centré x 950 y 368, à la taille de la planche.
        val ecoute = source("BlindTestEcrans.kt")
        assertTrue(ecoute.contains("BlindPanelGs(state, Modifier.matchParentSize())"))
        assertTrue(ecoute.contains("Modifier.planche(950f, 226f)"))
        assertTrue(ecoute.contains("Modifier.planche(950f, 260f)"))
        assertTrue(ecoute.contains("val centre = Modifier.planche(950f, 368f)"))
        assertEquals(2, Regex("pxSp\\(26f\\)").findAll(ecoute).count())
        assertTrue(ecoute.contains("PlaqueAppel(GenrePlaque.BLIND, \"BUZZEZ !\", \"dès que vous reconnaissez\\nla chanson\", centre, k = k)"))
    }

    @Test
    fun `tete de Buzzy de Qui a disparu, les yeux balaient de gauche a droite et clignent comme l'oeil d'avant`() {
        assertEquals(-1f, regardMemorise(0.1f), 0f)
        assertEquals(0f, regardMemorise(0.4f), 1e-4f)
        assertEquals(1f, regardMemorise(0.6f), 0f)
        assertEquals(0f, regardMemorise(0.9f), 1e-4f)
        assertEquals(1f, paupiereMemorise(0.5f), 0f)
        assertEquals(0.08f, paupiereMemorise(0.92f), 1e-4f)
        assertEquals(1f, paupiereMemorise(0.97f), 0f)
        // Même hauteur que l'œil (84) : le panneau ne bouge pas, de 1 à 8 équipes.
        val src = source("habillage/PlaqueAppel.kt").substringAfter("fun TeteBuzzyMemorise(").substringBefore("\n}\n")
        assertTrue(src.contains(".size((112 * u).dp, (84 * u).dp)"))
    }
}
