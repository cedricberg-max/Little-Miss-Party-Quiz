package com.littlemissparty.quiz.tv

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Cedric, 1/11 au soir : les points gagnés pendant un jeu doivent tous monter dans les jauges de son bilan. */
class JaugesBilanJeuTest {
    @Test
    fun `tableau des scores de fin de jeu, les jauges montent de tout le jeu`() {
        val vm = File("src/main/java/com/littlemissparty/quiz/tv/GameViewModel.kt").readText()
        assertTrue(vm.contains("s.phase == Phase.SCORES -> g.gameGains()"))
    }

    @Test
    fun `bilan du blind test, les jauges partent de zero`() {
        val ecrans = File("src/main/java/com/littlemissparty/quiz/tv/GameScreens.kt").readText()
        assertTrue(ecrans.contains("lignes, lignes.associate { (t, p) -> t.uid to p })"))
    }
}
