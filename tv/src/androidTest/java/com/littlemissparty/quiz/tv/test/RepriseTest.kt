package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.engine.Scoring
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** L'appli se ferme ou plante en pleine partie : au redémarrage, rien n'est perdu. */
@RunWith(AndroidJUnit4::class)
class RepriseTest : TestTv() {
    private val regies = mutableListOf<RegieSimulee>()

    /** Le mot de passe de la régie, posé ici aussi : la classe lancée seule n'a personne d'autre pour le faire. */
    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @After
    fun rangerRegies() = regies.forEach { it.close() }

    /**
     * 25/10 au soir : appli arrêtée en pleine fête, après que la régie a copié chansons et photos dans la partie.
     * La reprise relisait toute la partie, médias compris, et échouait à chaque essai (« La base Firebase ne répond
     * pas »). Ici, 8 extraits de près de 900 Ko : la fête reprend quand même, avec ses équipes et sa question.
     */
    @Test
    fun repriseDUneFeteAvecSesChansonsCopiees() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val lourd = "data:audio/mpeg;base64," + "A".repeat(890_000)
        repeat(8) { k -> regie.copierExtrait(code, "%016x".format(0xabc000L + k), lourd) }
        ecran.lancerLaFete()
        attendreQuestion(licornes, code, 0)

        relancerBoite()
        ecran.voit("Une partie est en cours", 30_000)
        ecran.voit("Licornes")
        ecran.ok("Reprendre la partie")
        ecran.voit("Quiz question 1 / ", 30_000)
        assertEquals(code, Boite.codeActif())
    }

    @Test
    fun repriseAvecOkApresFermeture() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.lancerLaFete()
        val q = attendreQuestion(licornes, code, 0)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")

        relancerBoite()
        ecran.voit("Une partie est en cours", 30_000)
        ecran.voit("Code $code")
        ecran.voit("Licornes")
        ecran.capture("proposition-reprise")
        ecran.ok("Reprendre la partie")

        // Même partie, même étape : la réponse donnée avant la fermeture compte toujours.
        ecran.voit("Quiz question 1 / ")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        assertEquals(code, Boite.codeActif())
        val gagne = attendreQue("points après reprise") {
            licornes.etat(code).child("awards/${licornes.uid}/points").value as? Number
        }.toLong()
        assertTrue("Points après reprise : $gagne", gagne >= Scoring.BASE)
    }

    @Test
    fun repriseAutomatiqueSansToucherLaTelecommande() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.lancerLaFete()
        attendreQuestion(licornes, code, 0)

        relancerBoite()
        ecran.voit("Reprise automatique", 30_000)
        ecran.capture("compte-a-rebours")
        ecran.voit("Quiz question 1 / ", 30_000)
        assertEquals("Aucune nouvelle partie ne doit être créée", code, Boite.codeActif())
    }
}
