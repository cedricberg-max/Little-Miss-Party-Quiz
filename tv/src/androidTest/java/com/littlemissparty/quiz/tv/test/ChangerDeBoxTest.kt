package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.littlemissparty.quiz.engine.Scoring
import com.littlemissparty.quiz.tv.GameViewModel
import java.util.UUID
import kotlinx.coroutines.tasks.await
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * « 📺 Changer de box » : la TV de la fête tombe en panne, la régie confie la partie au salon d'attente
 * d'une autre box. L'ancienne box le dit et ne pilote plus rien ; la box qui reçoit la fête la reprend
 * avec ses équipes et ses points, sans rien appliquer de ce qui avait été envoyé à la box en panne.
 */
@RunWith(AndroidJUnit4::class)
class ChangerDeBoxTest : TestTv() {
    private val fermer = mutableListOf<AutoCloseable>()

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @After
    fun ranger() = fermer.forEach { runCatching { it.close() } }

    private fun regie() = RegieSimulee().also { fermer += it }

    private fun boxDeSecours() = BoxSimulee().also { fermer += it; it.ouvrirSalon() }

    /** La fête jusqu'à la révélation de la première question : une équipe, une bonne réponse, des points. */
    private fun premiereQuestion(code: String, licornes: PupitreSimule): Long {
        ecran.ok("Lancer la fête !")
        val q = attendreQuestion(licornes, code, 0)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        return attendreQue("points de la première question") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } }
    }

    @Test
    fun laFeteContinueSurUneAutreBoxPuisRevientSurCelleCi() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val avant = premiereQuestion(code, licornes)
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))

        // La régie confie la fête au salon d'une autre box : cette TV le voit aussitôt et ne pilote plus rien.
        val secours = boxDeSecours()
        assertTrue("Changement vers la box de secours refusé", regie.changerDeBox(code, secours.code))
        ecran.voit("Cette fête continue sur une autre box", 30_000)
        ecran.voit("Code $code")
        ecran.capture("ancienne-box")
        assertNull("L'ancienne box oublie la partie", Boite.codeActif())

        // La box de secours (simulée) ne répond jamais : ce « Suivant » reste sans réponse.
        val perdue = regie.envoyer(code, "next") ?: throw AssertionError("« Suivant » refusé par le serveur")

        // « Nouvelle partie » sur cette TV : un salon neuf, la fête n'est pas touchée.
        ecran.ok("Nouvelle partie")
        val salon = attendreQue("nouveau salon", 30_000) { Boite.codeActif()?.takeIf { it != code } }
        ecran.voit("Scannez pour jouer", 30_000)
        assertEquals("reveal", licornes.etat(code).child("phase").value)

        // Cette TV redevient la box de la fête, depuis son salon (sa copie locale de la partie est ancienne).
        assertTrue("Changement vers cette TV refusé", regie.changerDeBox(code, salon))
        ecran.voit("Voir les scores", 30_000)
        ecran.capture("fete-reprise")
        assertEquals(code, Boite.codeActif())
        assertEquals(FirebaseAuth.getInstance().currentUser?.uid, Boite.controle.lire("games/$code/hostUid"))
        attendreQue("salon terminé") { Boite.controle.etat(salon).takeIf { it.child("phase").value == "ended" } }
        // Le « Suivant » envoyé à la box muette n'est jamais appliqué : la fête reprend à la révélation.
        assertEquals("refused", regie.verdict(code, perdue))
        assertEquals("too_old", regie.raison(code, perdue))
        assertEquals(avant, points(licornes, code, licornes.uid))

        // La régie pilote toujours la même partie, et la fête continue avec ses points.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit(titreClassement())
        ecran.voit("Licornes")
        ecran.ok("Question suivante")
        val q2 = attendreQuestion(licornes, code, 1)
        assertTrue(licornes.repondre(code, q2.id, q2.correct))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        val apres = attendreQue("points de la deuxième question") {
            points(licornes, code, licornes.uid).takeIf { it >= avant + Scoring.BASE }
        }
        assertTrue("Points après le changement de box : $apres (avant $avant)", apres > avant)
    }

    @Test
    fun boxEteintePendantLeChangementAnnonceLaFeteAilleursAuRedemarrage() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        premiereQuestion(code, licornes)
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))

        // La TV s'éteint ; la régie confie la fête à une autre box ; la TV redémarre.
        fermerBoite()
        val secours = boxDeSecours()
        assertTrue("Changement vers la box de secours refusé", regie.changerDeBox(code, secours.code))
        relancerBoite()
        // Jamais « Connexion impossible », jamais la partie relancée : l'écran dit où est la fête.
        ecran.voit("Cette fête continue sur une autre box", 60_000)
        ecran.capture("ancienne-box-redemarree")
        assertNull("L'ancienne box oublie la partie", Boite.codeActif())
        assertEquals(secours.uid, Boite.controle.lire("games/$code/hostUid"))

        ecran.ok("Nouvelle partie")
        val salon = attendreQue("nouveau salon", 30_000) { Boite.codeActif()?.takeIf { it != code } }
        assertNotEquals(code, salon)
        ecran.voit("Scannez pour jouer", 30_000)
        assertEquals(secours.uid, Boite.controle.lire("games/$code/hostUid"))
    }
}

/**
 * Une autre box (simulée) : sa propre connexion anonyme et son salon d'attente vide, comme une box de secours
 * qui vient de démarrer. Elle ne traite jamais rien ensuite : une box muette.
 */
class BoxSimulee : AutoCloseable {
    private val app = FirebaseApp.initializeApp(
        Boite.contexte, FirebaseApp.getInstance().options, "box-${UUID.randomUUID()}",
    )
    private val auth = FirebaseAuth.getInstance(app)
    private val base = FirebaseDatabase.getInstance(app, GameViewModel.databaseUrl())
    val uid: String
    val code: String = (1..5).map { "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".random() }.joinToString("")

    init {
        Emulateur.brancher(auth, base)
        uid = connexionAnonyme(auth)
    }

    /** Comme une box qui démarre : un salon d'attente vide, dont le code s'affiche sur sa TV. */
    fun ouvrirSalon() {
        bloquer {
            base.getReference("games/$code").setValue(
                mapOf(
                    "hostUid" to uid,
                    "createdAt" to ServerValue.TIMESTAMP,
                    "quizId" to "demo",
                    "state" to mapOf("phase" to "lobby", "round" to 1, "buzzOpen" to true),
                    // Appli à jour : elle sait reprendre la fête d'une autre box (sinon la régie refuse de la lui confier).
                    "public" to mapOf("title" to "Quiz", "changeBox" to true),
                ),
            ).await()
        }
    }

    override fun close() {
        runCatching { base.goOffline() }
    }
}
