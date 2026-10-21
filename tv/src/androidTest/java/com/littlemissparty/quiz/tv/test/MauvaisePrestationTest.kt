package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.firebase.auth.FirebaseAuth
import com.littlemissparty.quiz.engine.Scoring
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Mauvaise prestation lancée (cedric, 21/10) : tant qu'aucun point n'a été donné, la régie la remplace par la bonne,
 * même après l'ouverture de la première question. La TV repart du salon d'attente avec le prénom du bon enfant,
 * les équipes restent. Après un point, la box refuse et rien ne bouge.
 */
@RunWith(AndroidJUnit4::class)
class MauvaisePrestationTest : TestTv() {
    private val regies = mutableListOf<RegieSimulee>()

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @After
    fun ranger() = regies.forEach { runCatching { it.close() } }

    private fun regie() = RegieSimulee().also { regies += it }

    private fun question(id: String, texte: String, choix: List<String>, bonne: Int, jeu: String) = mapOf(
        "id" to id, "text" to texte, "choices" to choix, "correct" to bonne,
        "duration" to 30, "kind" to "classic", "double" to false, "round" to jeu,
    )

    /** La prestation lancée par erreur. */
    private val lea = listOf(
        question("p1", "Quel animal miaule ?", listOf("Le chat", "Le chien"), 0, "Quiz des animaux"),
        question("p2", "Quel animal aboie ?", listOf("Le chat", "Le chien"), 1, "Quiz des animaux"),
    )

    /** La bonne prestation (mêmes identifiants de questions : deux prestations tirées du même modèle). */
    private val chloe = listOf(
        question("p1", "Quelle planète est rouge ?", listOf("Mars", "Vénus"), 0, "Quiz de l'espace"),
        question("p2", "Combien de pattes a une araignée ?", listOf("Six", "Huit"), 1, "Quiz de l'espace"),
    )

    /** Présentation du premier jeu, puis sa première question ouverte (commandes de la régie). */
    private fun premiereQuestion(regie: RegieSimulee, code: String, lecteur: PupitreSimule, texte: String) {
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Lancer l'épreuve")
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit(texte)
        attendreQue("première question ouverte") {
            lecteur.etat(code).takeIf { it.child("phase").value == "question" && it.child("qid").value == "p1" }
        }
    }

    @Test
    fun premiereQuestionSansPointLaBonnePrestationRepartDuSalonPuisLaFeteContinue() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        // La box annonce qu'elle est en ligne : la régie d'une autre TV le lit (« En cours sur une autre box »).
        attendreQue("présence de la box") { Boite.controle.lire("games/$code/hostOnline/online").takeIf { it == true } }
        assertEquals(FirebaseAuth.getInstance().currentUser?.uid, Boite.controle.lire("games/$code/hostOnline/uid"))

        assertEquals("applied", regie.chargerPrestation(code, "L'anniversaire de Léa", lea, prenom = "Léa", prestation = "lea"))
        ecran.voit("Joyeux anniversaire Léa !")
        assertEquals(code, regie.lancement("lea"))
        assertEquals("lea", Boite.controle.lire("games/$code/public/prestation"))
        premiereQuestion(regie, code, licornes, "Quel animal miaule ?")
        assertNull("aucun point donné", licornes.etat(code).child("scored").value)
        assertEquals(true, (regie.programme(code)["programReset"]))

        // Mauvaise prestation : celle de Chloé la remplace, la TV repart du salon avec la même équipe.
        assertEquals("applied", regie.chargerPrestation(code, "L'anniversaire de Chloé", chloe, prenom = "Chloé", prestation = "chloe"))
        ecran.voit("Joyeux anniversaire Chloé !")
        ecran.voit("Licornes")
        ecran.neVoitPas("Quel animal miaule ?")
        ecran.capture("salon-bonne-prestation")
        assertEquals("lobby", licornes.etat(code).child("phase").value)
        assertEquals(0L, points(licornes, code, licornes.uid))
        assertTrue("l'équipe reste inscrite", licornes.equipes(code).hasChild(licornes.uid))
        assertEquals("L'anniversaire de Chloé", regie.programme(code)["title"])
        assertEquals("Chloé", Boite.controle.lire("games/$code/public/childName"))
        assertEquals("chloe", Boite.controle.lire("games/$code/public/prestation"))
        assertEquals(code, regie.lancement("chloe"))
        assertNull("la prestation de Léa est libérée", regie.lancement("lea"))

        // La fête démarre ensuite normalement sur la bonne prestation, avec des points.
        premiereQuestion(regie, code, licornes, "Quelle planète est rouge ?")
        assertTrue(licornes.repondre(code, "p1", 0))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("points de la bonne réponse") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } }
        assertEquals(true, licornes.etat(code).child("scored").value)
        ecran.capture("fete-bonne-prestation")
    }

    @Test
    fun apresUnPointLaBoxRefuseUneAutrePrestationEtRienNeBouge() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        assertEquals("applied", regie.chargerPrestation(code, "L'anniversaire de Léa", lea, prenom = "Léa", prestation = "lea"))
        premiereQuestion(regie, code, licornes, "Quel animal miaule ?")
        assertTrue(licornes.repondre(code, "p1", 0))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        assertEquals("applied", regie.commande(code, "next"))
        val gagnes = attendreQue("points de la bonne réponse") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } }
        val avant = licornes.etat(code)
        assertEquals(true, avant.child("scored").value)

        // Un point a été donné : la box refuse, la fête de Léa continue telle quelle.
        assertEquals("points", regie.chargerPrestation(code, "L'anniversaire de Chloé", chloe, prenom = "Chloé", prestation = "chloe"))
        val apres = licornes.etat(code)
        assertEquals(avant.child("phase").value, apres.child("phase").value)
        assertEquals(avant.child("qid").value, apres.child("qid").value)
        assertEquals(avant.child("seq").value, apres.child("seq").value)
        assertEquals(gagnes, points(licornes, code, licornes.uid))
        assertEquals("L'anniversaire de Léa", regie.programme(code)["title"])
        assertEquals("Léa", Boite.controle.lire("games/$code/public/childName"))
        assertEquals("lea", Boite.controle.lire("games/$code/public/prestation"))
        // Comme la page web après le refus : la prestation de Léa reste lancée ici, celle de Chloé est libre.
        assertEquals(code, regie.lancement("lea"))
        assertNull(regie.lancement("chloe"))
        ecran.neVoitPas("Joyeux anniversaire Chloé !", 3_000)
        ecran.capture("refus-apres-un-point")
    }
}
