package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.allumageNeon
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mimes entre deux tours : le masque plus gros (cedric, 27/10 au soir), jamais au détriment des textes dessous. */
class MasqueMimesTest {

    @Test
    fun `debut de tour un element a la fois, bandeau puis TOP DEPART puis la carte`() {
        val t = com.littlemissparty.quiz.tv.habillage.Tempo
        org.junit.Assert.assertTrue(t.MIMES_ANNONCE >= 1_500L)
        org.junit.Assert.assertEquals(t.MIMES_ANNONCE + t.MIMES_TOP_TAMPON, t.MIMES_CARTE)
        val code = java.io.File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        org.junit.Assert.assertTrue(code.contains("actif = team != null && etape >= DebutTourMimes.TOP)"))
        org.junit.Assert.assertTrue(code.contains("carteVisible = etape >= DebutTourMimes.CARTE"))
        // Le tampon dure exactement son étape : il est fini quand la carte surgit.
        org.junit.Assert.assertEquals(1_200L, t.MIMES_TOP_TAMPON)
        val bandeau = java.io.File("src/main/java/com/littlemissparty/quiz/tv/habillage/Transitions.kt").readText()
        org.junit.Assert.assertTrue(bandeau.contains("val duree = if (m.picto) BANDEAU_MS else Tempo.MIMES_ANNONCE"))
    }

    @Test
    fun `TEMPS ECOULE dans la couleur de l'equipe qui vient de jouer`() {
        org.junit.Assert.assertEquals(com.littlemissparty.quiz.tv.habillage.Neon.Halo, couleurTempsEcoule(emptyList(), "partie"))
        val code = java.io.File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        org.junit.Assert.assertTrue(code.contains("couleur = couleurTempsEcoule(state.teams, m.last?.team)"))
    }

    @Test
    fun `le chrono du tour part avec la premiere carte, plein pendant le bandeau et TOP DEPART`() {
        val t = com.littlemissparty.quiz.tv.habillage.Tempo
        // Le moteur et l'écran sont d'accord : la carte surgit pile quand le chrono part.
        assertEquals(com.littlemissparty.quiz.engine.MIME_DEPART_MS, t.MIMES_CARTE)
        val lancement = 1_000_000L
        val fin = lancement + com.littlemissparty.quiz.engine.MIME_DEPART_MS + 60_000
        assertEquals(60_000L, restantMimes(fin, lancement, 0, 60_000))
        assertEquals(60_000L, restantMimes(fin, lancement + 2_000, 0, 60_000))
        assertEquals(50_000L, restantMimes(fin, lancement + com.littlemissparty.quiz.engine.MIME_DEPART_MS + 10_000, 0, 60_000))
        assertEquals(0L, restantMimes(fin, fin + 5_000, 0, 60_000))
        // Jamais une image à « 0 » au début du tour : la valeur de départ vient de l'échéance.
        val code = java.io.File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        assertTrue(code.contains("mutableLongStateOf(state.deadline?.let { restantMimes("))
    }

    @Test
    fun `apres un tour, Prochaine equipe attend que le tampon TEMPS ECOULE soit parti (plus de textes melanges)`() {
        val t = com.littlemissparty.quiz.tv.habillage.Tempo
        // Le tampon dure 1,2 s (Tampon, dureeMs par défaut) : la consigne arrive après lui, et après le bravo.
        assertTrue(delaiConsigneMimes(t.MIME_BILAN) > 1_200L)
        assertTrue(delaiConsigneMimes(t.MIME_BILAN) > t.MIME_BILAN + t.TEMPS)
        val code = java.io.File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        assertTrue(code.contains("if (last != null) Modifier.apparition(delaiConsigneMimes(bilan), m.turns.size) else Modifier"))
    }

    @Test
    fun `plus de pastille MIMES en haut a gauche dans le Game Show, le Classique la garde`() {
        org.junit.Assert.assertFalse(badgeMimesVisible(gs = true))
        org.junit.Assert.assertTrue(badgeMimesVisible(gs = false))
        val code = java.io.File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        // Les deux en-têtes (entre deux tours et pendant un tour) passent par la même règle.
        org.junit.Assert.assertEquals(2, Regex("if \\(badgeMimesVisible\\(Look.gs\\)\\) \\{\\s+BadgeMimes\\(\\)").findAll(code).count())
    }

    @Test
    fun `le masque grandit avec la place, plafonne a 220 et laisse toujours la place des textes`() {
        assertEquals(220f, tailleMasqueMimes(600f))
        val moyen = tailleMasqueMimes(420f)
        assertTrue("plus gros qu'avant", moyen > 132f)
        assertTrue("laisse la place des textes", moyen <= 420f - 250f)
        // 8 équipes sur deux rangées (cedric, 30/10 : règle coupée) : le masque rapetisse, puis disparaît.
        assertEquals(100f, tailleMasqueMimes(350f))
        assertEquals(0f, tailleMasqueMimes(300f))
        assertEquals(0f, tailleMasqueMimes(200f))
    }

    @Test
    fun `le nom a cote de la pastille MIMES n est jamais le meme mot`() {
        for (t in listOf("Mimes", "mimes", " MIMES ", "Les Mimes", "Mime", null, "")) assertNull(t, sousTitreMimes(t))
        assertEquals("Animaux de la ferme", sousTitreMimes("Animaux de la ferme"))
        assertEquals("Équipe orange", sousTitreMimes("Équipe orange"))
    }

    @Test
    fun `titre en enseigne de neon qui clignote en s'allumant, et regle qui respire sur les cotes (choix D, 1-11)`() {
        val src = java.io.File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        assertTrue(src.contains("TitreMimesNeon(Modifier.apparition(0, Unit))"))
        assertTrue(src.contains("modifier = Modifier.padding(horizontal = MARGE_REGLE_MIMES.dp)"))
        assertTrue(MARGE_REGLE_MIMES >= 60f)
        // La phrase la plus longue (705 dp mesurés en Rajdhani gras 24) tient sur une ligne entre les marges.
        assertTrue(960f - 2 * 40f - 2 * MARGE_REGLE_MIMES >= 720f)
        val neon = java.io.File("src/main/java/com/littlemissparty/quiz/tv/habillage/TitreMimesNeon.kt").readText()
        assertTrue(neon.contains("text = AnnotatedString(\"Les Mimes !\")"))
        assertTrue(neon.contains("\"les\"") && neon.contains("\"MIMES !\""))
    }

    @Test
    fun `enseigne des mimes, eteinte puis allumee puis eteinte au debut de chaque cycle, allumee ensuite`() {
        val a: (Float) -> Float = ::allumageNeon
        assertEquals(0.25f, a(0f), 0f)
        assertEquals(1f, a(0.2f), 0f)
        assertEquals(0.3f, a(0.35f), 0f)
        assertEquals(1f, a(1.5f), 0f)
        assertEquals(0.25f, a(3.05f), 0f)
        assertEquals(1f, a(-0.4f + 3f * 0.5f), 0f)
    }

    @Test
    fun `bilan d un tour en jaune Game Show, et pastille collee a la bulle de son equipe (1-11 au soir)`() {
        val src = java.io.File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        assertEquals(com.littlemissparty.quiz.tv.habillage.GS.Jaune, COULEUR_BILAN_MIMES)
        assertTrue(src.contains("color = if (Look.gs) COULEUR_BILAN_MIMES else Neon.Or"))
        // La bulle remplit la place de l'équipe : la pastille posée sur son coin ne flotte plus contre l'équipe voisine.
        val puce = src.substringAfter("private fun MimeTeamChip(").substringBefore("private fun remainingTeams")
        assertTrue(puce.contains("Box(modifier) {"))
        assertTrue(puce.substringAfter("Box(modifier) {").substringBefore(".then(").contains(".fillMaxWidth()"))
    }
}
