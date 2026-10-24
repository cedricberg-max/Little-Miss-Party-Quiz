package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.engine.Scoring
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Une partie entière du quiz de démonstration, de l'accueil à la victoire, à la télécommande. */
@RunWith(AndroidJUnit4::class)
class PartieCompleteTest : TestTv() {

    @Test
    fun deuxEquipesDuSalonALaVictoire() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        ecran.voit("Licornes")
        ecran.voit("Dragons")
        ecran.voit("2 équipe(s) dans la partie")
        ecran.capture("salon")

        val total = quiz.questions.size
        var minimum = 0L
        ecran.lancerLaFete()
        quiz.questions.forEachIndexed { i, q ->
            ecran.voit("Quiz · question ${i + 1} / $total")
            attendreQuestion(licornes, code, i)
            // Les Licornes trouvent toujours, les Dragons se trompent toujours.
            assertTrue("Réponse des Licornes refusée (question ${i + 1})", licornes.repondre(code, q.id, q.correct))
            assertTrue("Réponse des Dragons refusée (question ${i + 1})", dragons.repondre(code, q.id, mauvaiseReponse(q)))

            // Toutes les équipes ont répondu : la question se ferme seule.
            ecran.voit("Toutes les équipes ont répondu")
            if (i == 0) ecran.capture("question-fermee")
            ecran.ok("Révéler la réponse")
            ecran.voit("Voir les scores")
            if (i == 0) ecran.capture("revelation", attente = Ecran.APRES_REVELATION)

            val factor = if (q.double) 2 else 1
            minimum += Scoring.BASE * factor
            val gagne = attendreQue("points de la question ${i + 1}") {
                licornes.etat(code).child("awards/${licornes.uid}/points").value as? Number
            }.toLong()
            assertTrue("Points des Licornes question ${i + 1} : $gagne", gagne.toInt() in (Scoring.BASE * factor)..((Scoring.BASE + Scoring.MAX_BONUS) * factor))
            assertEquals(0L, (licornes.etat(code).child("awards/${dragons.uid}/points").value as Number).toLong())

            ecran.ok("Voir les scores")
            ecran.voit(titreClassement())
            if (i == 0) ecran.capture("classement")
            ecran.ok(if (i == total - 1) "Résultats finaux" else "Question suivante")
        }

        ecran.voit("Bravo à toutes les équipes")
        ecran.voit("Victoire de Licornes")
        ecran.capture("victoire")
        val fin = attendreQue("fin de partie publiée") { licornes.etat(code).takeIf { it.child("phase").value == "ended" } }
        val scoreLicornes = (fin.child("scores/${licornes.uid}").value as Number).toLong()
        assertTrue("Score final des Licornes : $scoreLicornes (minimum $minimum)", scoreLicornes >= minimum)
        assertEquals(0L, (fin.child("scores/${dragons.uid}").value as Number).toLong())
    }
}
