package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Petits textes sur le décor : le halo noir doux du Chrono (cedric, 31/10), jamais un cadre. */
class HaloDecorTest {

    @Test
    fun `le halo est celui de la consigne du Chrono`() {
        assertEquals(Color.Black, HALO_DECOR.color)
        assertEquals(Offset.Zero, HALO_DECOR.offset)
        assertEquals(22f, HALO_DECOR.blurRadius)
        val chrono = File("src/main/java/com/littlemissparty/quiz/tv/ChronoScreens.kt").readText()
        assertTrue("shadow = Shadow(Color.Black, Offset.Zero, 22f)" in chrono)
    }

    @Test
    fun `ecran « Une partie est en cours », chaque texte a le halo, sans fond derriere`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/QuizTvApp.kt").readText()
        val bloc = src.substringAfter("private fun ResumeOffer(").substringBefore("/** Box de secours")
        val textes = Regex("""\bText\(""").findAll(bloc).count()
        assertEquals(4, textes)
        assertEquals(textes, Regex("""style = halo""").findAll(bloc).count())
        assertTrue("val halo = LocalTextStyle.current.copy(shadow = HALO_DECOR)" in bloc)
        assertTrue(".background(" !in bloc)
    }

    @Test
    fun `Coffres, la ligne du bas a le halo noir doux, plus la lueur cyan qui se perdait dans les reflets`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/CoffresScreens.kt").readText()
        val bloc = src.substringAfter("val bas = when {").substringBefore("maxLines = 1")
        assertTrue("shadow = HALO_DECOR" in bloc)
        assertTrue("Shadow(GS.Cyan" !in bloc)
    }

    @Test
    fun `Mimes, « trouve » sous le compteur a le halo noir doux`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        val bloc = src.substringAfter("if (found > 1) \"trouvés\" else \"trouvé\"").substringBefore(")\n")
        assertTrue(bloc, "shadow = HALO_DECOR" in bloc)
    }

    @Test
    fun `Pictionary, « Au tour de » avec le halo noir doux, le nom de l'equipe en neon qui se detache (point 33, 1-11)`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/habillage/Pictionary.kt").readText()
        val bloc = src.substringAfter("fun IntroPictionary(").substringBefore("Spacer(Modifier.height(30.dp))\n            Box(")
        val auTour = bloc.substringAfter("\"Au tour de\"").substringBefore("NomNeonPictionary(")
        assertTrue(auTour, "shadow = HALO_DECOR" in auTour && "FontWeight.Bold" in auTour)
        assertTrue(bloc, "NomNeonPictionary(equipe, couleur" in bloc)
        // Le néon d'avant (cedric préfère), mais détaché : halo noir doux dessous, lueur pleine de la couleur dessus.
        val neon = src.substringAfter("internal fun NomNeonPictionary(").substringBefore("\n}\n")
        assertTrue(neon, "shadow = HALO_DECOR" in neon)
        assertTrue(neon, "Shadow(couleur, Offset.Zero, NEON_NOM_LUEUR)" in neon)
        assertTrue(neon, "Shadow(couleur, Offset.Zero, NEON_NOM_LUEUR_LARGE)" in neon)
        // Couleur pure de l'équipe partout (plus de cœur éclairci, qui la délavait), lueurs pleines, plus fortes qu'avant.
        assertTrue(neon, "lerp(" !in neon && "alpha" !in neon)
        assertTrue(NEON_NOM_LUEUR_LARGE > 26f && NEON_NOM_LUEUR in 8f..26f)
        assertTrue("jamais de cadre", "background(" !in neon && "border(" !in neon)
    }

    @Test
    fun `pastille d'une equipe qui a repondu, sa couleur forte sur la nuit et le halo sur le nom (choix B, 1-11)`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/GameShowQuiz.kt").readText()
        val bloc = src.substringAfter("internal fun TeamStatusGs(").substringBefore("\n}\n")
        assertTrue(bloc, "Modifier.background(GS.Nuit.copy(alpha = 0.55f)).background(color.copy(alpha = 0.55f))" in bloc)
        assertTrue("plus la pastille transparente", "color.copy(alpha = 0.26f)" !in bloc)
        assertTrue("val halo = if (allumee) TextStyle(shadow = HALO_DECOR) else TextStyle.Default" in bloc)
        // Le nom (une ligne et deux lignes) et le statut.
        assertEquals(3, Regex("style = halo").findAll(bloc).count())
    }
}
