package com.littlemissparty.quiz.tv

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Le mot « manche » est banni de la TV (règle permanente de cedric) : aucun texte de l'appli TV ne le montre. Seules
 * les clés internes (« manche|titre », « manche code index ») le gardent, jamais affichées. Trouvé le 31/10 sur la
 * porte de transition : « NOUVELLE MANCHE ».
 */
class MotMancheBanniTest {

    @Test
    fun `aucun texte de la TV ne contient le mot manche`() {
        val chaine = Regex("\"((?:[^\"\\\\]|\\\\.)*)\"")
        val mot = Regex("(?i)\\bmanches?\\b")
        val fautes = File("src/main/java").walkTopDown().filter { it.extension == "kt" }.flatMap { f ->
            f.readLines().withIndex().flatMap { (n, ligne) ->
                val code = ligne.substringBefore("//").trimStart()
                if (code.startsWith("*") || code.startsWith("/*")) emptyList()
                else chaine.findAll(code).map { it.groupValues[1] }
                    .filter { mot.containsMatchIn(it) && !it.startsWith("manche|") && !it.startsWith("manche ") && it != "manche" }
                    .map { "${f.name}:${n + 1} « $it »" }.toList()
            }
        }.toList()
        assertTrue("Mot « manche » à l'écran : $fautes", fautes.isEmpty())
    }
}
