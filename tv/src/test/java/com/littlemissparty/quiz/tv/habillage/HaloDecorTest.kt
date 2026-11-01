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
    fun `ecran « Une partie est en cours » : chaque texte a le halo, sans fond derriere`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/QuizTvApp.kt").readText()
        val bloc = src.substringAfter("private fun ResumeOffer(").substringBefore("/** Box de secours")
        val textes = Regex("""\bText\(""").findAll(bloc).count()
        assertEquals(4, textes)
        assertEquals(textes, Regex("""style = halo""").findAll(bloc).count())
        assertTrue("val halo = LocalTextStyle.current.copy(shadow = HALO_DECOR)" in bloc)
        assertTrue(".background(" !in bloc)
    }

    @Test
    fun `Coffres : la ligne du bas a le halo noir doux, plus la lueur cyan qui se perdait dans les reflets`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/CoffresScreens.kt").readText()
        val bloc = src.substringAfter("val bas = when {").substringBefore("maxLines = 1")
        assertTrue("shadow = HALO_DECOR" in bloc)
        assertTrue("Shadow(GS.Cyan" !in bloc)
    }

    @Test
    fun `Mimes : « trouve » sous le compteur a le halo noir doux`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        val bloc = src.substringAfter("if (found > 1) \"trouvés\" else \"trouvé\"").substringBefore(")\n")
        assertTrue(bloc, "shadow = HALO_DECOR" in bloc)
    }
}
