package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.engine.Scoring
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** La régie sur le téléphone de l'animatrice : connexion par mot de passe commun et pilotage de la TV. */
@RunWith(AndroidJUnit4::class)
class RegieTest : TestTv() {

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @Test
    fun connexionParMotDePassePuisPartiePiloteeDuTelephone() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue("Le bon mot de passe doit relier la régie", regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        ecran.voit("Régie reliée")
        assertTrue("La régie lit le conducteur (bonnes réponses)", regie.lireConducteur(code))
        ecran.capture("regie-reliee")

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Question 1 / ")
        val q = attendreQuestion(licornes, code, 0)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Voir les scores")
        val avant = points(licornes, code, licornes.uid)
        assertTrue(avant >= Scoring.BASE)

        // Correction de score depuis la régie.
        assertEquals("applied", regie.commande(code, "adjust", mapOf("team" to licornes.uid, "delta" to 50)))
        attendreQue("correction publiée") { points(licornes, code, licornes.uid).takeIf { it == avant + 50 } }
        ecran.capture("apres-correction")
    }

    @Test
    fun mauvaisMotDePasseRefuse() {
        val code = lancerBoite()
        pupitre("licornes").rejoindre(code, "Licornes", VERT)
        val regie = regie()
        assertFalse("Un mauvais mot de passe ne doit pas relier la régie", regie.connecter(code, "pas-le-bon-mot"))
        assertNull("Une régie non reliée ne peut pas envoyer de commande", regie.envoyer(code, "next"))
        assertFalse("Une régie non reliée ne lit pas les bonnes réponses", regie.lireConducteur(code))
        assertFalse(ecran.affiche("Régie reliée"))
        ecran.voit("Lancer le quiz")
    }

    @Test
    fun doubleCommandeNAvanceQuUneSeuleFois() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))

        // Double appui sur « Suivant » : deux commandes avec la même étape affichée.
        val etape = regie.etape(code)
        val premiere = regie.envoyer(code, "next", etape)!!
        val seconde = regie.envoyer(code, "next", etape)!!
        assertEquals("applied", regie.verdict(code, premiere))
        assertEquals("stale", regie.verdict(code, seconde))

        attendreQuestion(licornes, code, 0)
        Thread.sleep(1_000)
        assertEquals("La question doit rester ouverte", "question", licornes.etat(code).child("phase").value)
        ecran.voit("Arrêter le chrono")
    }

    @Test
    fun jeuAjouteEnPleineQuestionSansToucherALaPartie() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        assertEquals("applied", regie.commande(code, "next"))
        val q = attendreQuestion(licornes, code, 0)

        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val version = regie.programme(code)["rev"] as String
        val ajout = mapOf(
            "id" to "a1q1", "text" to "Question ajoutée pendant la partie ?", "choices" to listOf("Oui", "Non"),
            "correct" to 0, "duration" to 20, "kind" to "classic", "double" to false, "round" to "Bonus",
        )
        // La question en cours ne peut pas disparaître du programme.
        assertEquals("current_round", regie.modifierProgramme(code, version, avant.drop(1)))
        assertEquals("applied", regie.modifierProgramme(code, version, avant + ajout))
        ecran.voit("Question 1 / ${avant.size + 1}")
        // Préparé sur l'ancienne version (deuxième téléphone en retard) : refusé, rien ne bouge.
        assertEquals("stale", regie.modifierProgramme(code, version, avant))

        assertEquals("question", licornes.etat(code).child("phase").value)
        assertEquals(q.id, licornes.etat(code).child("qid").value)
        assertEquals((avant.size + 1).toLong(), licornes.etat(code).child("total").value)
        assertTrue("La partie continue normalement", licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.capture("jeu-ajoute")
    }

    @Test
    fun mimesPilotesDepuisLaRegie() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))

        // Manche de mimes placée en tête du programme depuis le salon d'attente.
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val mimes = mapOf(
            "id" to "a1m", "text" to "Animaux", "kind" to "mime", "duration" to 60, "round" to "Animaux",
            "cards" to listOf(mapOf("word" to "Chat", "image" to "🐱"), mapOf("word" to "Lion", "image" to "🦁")),
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(mimes) + avant))

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Les Mimes !")
        assertEquals("applied", regie.commande(code, "mime_start", mapOf("team" to licornes.uid)))
        ecran.voit("Au tour de Licornes")
        ecran.voit("Chat")
        ecran.capture("mimes-tour")

        assertEquals("applied", regie.commande(code, "mime_found"))
        ecran.voit("Lion")
        assertEquals("applied", regie.commande(code, "mime_stop"))
        ecran.voit("Bravo Licornes")

        // Entre deux tours, « Suivant » termine la manche : le mime trouvé compte au classement.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Après les mimes")
        assertEquals(Scoring.MIME.toLong(), points(licornes, code, licornes.uid))
        ecran.capture("mimes-classement")
    }

    /** Le scénario du premier vrai test de cedric : un quiz, puis les mimes, puis le classement et le jeu suivant. */
    @Test
    fun quizPuisMimesPuisJeuSuivantPuisRejouer() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val mimes = mapOf(
            "id" to "a1m", "text" to "Animaux", "kind" to "mime", "duration" to 60, "round" to "Animaux",
            "cards" to listOf(mapOf("word" to "Chat", "image" to "🐱")),
        )
        val programme = listOf(demo[0] + ("round" to "Quiz"), mimes, demo[1] + ("round" to "Finale"))
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, programme))

        // Quiz : une question jouée jusqu'au classement.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Question 1 / 3")
        attendreQue("question 1 ouverte") { licornes.etat(code).takeIf { it.child("qid").value == demo[0]["id"] } }
        assertTrue(licornes.repondre(code, demo[0]["id"] as String, (demo[0]["correct"] as Number).toInt()))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Classement")
        val apresQuiz = points(licornes, code, licornes.uid)
        assertTrue("La bonne réponse rapporte des points", apresQuiz >= Scoring.BASE)

        // Fin du quiz : « suivant » enchaîne sur les mimes, sans rien bloquer.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Les Mimes !")
        assertEquals("applied", regie.commande(code, "mime_start", mapOf("team" to licornes.uid)))
        ecran.voit("Chat")
        assertEquals("applied", regie.commande(code, "mime_found"))
        ecran.voit("Bravo Licornes")
        // Toutes les équipes sont passées : la TV propose le classement.
        ecran.voit("Voir le classement")
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Après les mimes")
        assertEquals(apresQuiz + Scoring.MIME, points(licornes, code, licornes.uid))

        // Jeu suivant : la finale s'ouvre avec les mêmes équipes et les mêmes scores.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Question 3 / 3")
        assertEquals(apresQuiz + Scoring.MIME, points(licornes, code, licornes.uid))
        ecran.capture("quiz-mimes-finale")

        // Secours : rejouer le quiz retire ses points (pas de double compte), les mimes restent.
        assertEquals("applied", regie.commande(code, "goto", mapOf("index" to 0, "qid" to demo[0]["id"] as String)))
        ecran.voit("Question 1 / 3")
        attendreQue("points du quiz retirés") { points(licornes, code, licornes.uid).takeIf { it == Scoring.MIME.toLong() } }
        assertTrue("La tablette peut répondre de nouveau", licornes.repondre(code, demo[0]["id"] as String, (demo[0]["correct"] as Number).toInt()))
        ecran.voit("Toutes les équipes ont répondu")
    }

    private val regies = mutableListOf<RegieSimulee>()

    private fun regie() = RegieSimulee().also { regies += it }

    @org.junit.After
    fun rangerRegies() = regies.forEach { it.close() }
}
