package com.littlemissparty.quiz.tv

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Menu Retour : « Terminer la partie et quitter » (cedric, 31/10 au soir), en dernier, branché sur la fin de partie. */
class TerminerEtQuitterTest {
    private fun source(f: String) = File("src/main/java/com/littlemissparty/quiz/tv/$f").readText()

    @Test
    fun `le bouton est le dernier du menu et termine la partie avant de fermer l'appli`() {
        val app = source("QuizTvApp.kt")
        val nouvelle = app.indexOf("TvButton(\"Terminer et lancer une nouvelle partie\"")
        val quitter = app.indexOf("TvButton(\"Terminer la partie et quitter\", onTerminerEtQuitter")
        assertTrue(nouvelle > 0 && quitter > nouvelle)
        assertTrue(source("MainActivity.kt").contains("terminerEtQuitter = { viewModel.terminerEtQuitter(::finish) }"))
        val vm = source("GameViewModel.kt")
        val f = vm.substring(vm.indexOf("fun terminerEtQuitter("), vm.indexOf("fun terminerEtQuitter(") + 900)
        assertTrue("la box oublie la partie", f.contains("activeCode = null"))
        assertTrue("terminée sans suite", f.contains("quitter(connect(), code, null).await()"))
        assertTrue("l'appli se ferme même hors ligne", f.contains("finally {") && f.contains("ensuite()"))
    }
}
