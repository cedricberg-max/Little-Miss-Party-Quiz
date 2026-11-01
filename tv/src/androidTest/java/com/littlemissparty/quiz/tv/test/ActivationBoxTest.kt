package com.littlemissparty.quiz.tv.test

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.firebase.auth.FirebaseAuth
import com.littlemissparty.quiz.tv.GameViewModel
import com.littlemissparty.quiz.tv.MainActivity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL

/**
 * Verrou des box : une box jamais acceptée dans la Régie PC n'affiche que son code d'activation,
 * ne crée aucune partie, et s'ouvre toute seule dès que la Régie PC l'accepte.
 */
@RunWith(AndroidJUnit4::class)
class ActivationBoxTest : TestTv() {
    private var appli: ActivityScenario<MainActivity>? = null

    /** Le verrou ne doit pas gêner les autres tests : on efface toute la rubrique des box. */
    @After
    fun retirerVerrou() {
        appli?.close()
        Proprietaire.envoyer("DELETE", "boxes")
    }

    /** Une autre box déjà acceptée : le verrou est en place, comme chez Sarah. */
    private fun verrouEnPlace() {
        Proprietaire.envoyer("PUT", "boxes", """{"lockOn":true,"allowed":{"tv-du-salon":{"name":"TV du salon","at":1}}}""")
    }

    private fun boxEnAttente(): Pair<String, String> {
        appli = Boite.lancer()
        ecran.voit("Box en attente d'activation", 30_000)
        val uid = attendreQue("connexion de la box", 30_000) { FirebaseAuth.getInstance().currentUser?.uid }
        val code = attendreQue("demande d'activation dans Firebase", 30_000) {
            Proprietaire.lire("boxes/requests/$uid/code").trim('"').takeIf { it.matches(Regex("[A-Z2-9]{4}")) }
        }
        ecran.voit(code)
        ecran.voit("acceptez la box", 30_000)
        assertNull("Une box non acceptée ne crée aucune partie", Boite.codeActif())
        return uid to code
    }

    @Test
    fun boxInconnueAttendLaRegiePcPuisSOuvre() {
        verrouEnPlace()
        val (uid, _) = boxEnAttente()
        ecran.capture("box-en-attente")
        // Ce que fait la Régie PC en cliquant « Accepter » : la box autorisée, sa demande effacée.
        Proprietaire.envoyer("PUT", "boxes/allowed/$uid", """{"name":"Mi Box","at":2}""")
        Proprietaire.envoyer("DELETE", "boxes/requests/$uid")
        ecran.voit("Scannez pour jouer", 30_000)
        attendreQue("partie créée après l'activation", 30_000) { Boite.codeActif() }
        ecran.neVoitPas("Box en attente d'activation")
    }

    /**
     * Sans verrou (aucune box encore acceptée), la box qui reprend sa partie au démarrage envoie quand même
     * sa demande : sinon la première box, qui reprend toujours sa partie, n'apparaît jamais dans la Régie PC.
     */
    @Test
    fun boxQuiRepriseSaPartieEnvoieSaDemande() {
        val code = lancerBoite()
        val uid = attendreQue("connexion de la box", 30_000) { FirebaseAuth.getInstance().currentUser?.uid }
        attendreQue("demande à la création de la partie", 30_000) {
            Proprietaire.lire("boxes/requests/$uid/code").takeIf { it.trim() != "null" }
        }
        // La demande a disparu (comme sur la TCL de cedric, jamais envoyée) : la reprise doit la renvoyer.
        Proprietaire.envoyer("DELETE", "boxes/requests/$uid")
        relancerBoite()
        // Salon pas encore commencé : la box y revient d'elle-même, sans écran « Reprendre » (cedric, 31/10 : plus
        // jamais une partie vide proposée au démarrage).
        attendreQue("demande renvoyée à la reprise", 30_000) {
            Proprietaire.lire("boxes/requests/$uid/code").trim('"').takeIf { it.matches(Regex("[A-Z2-9]{4}")) }
        }
        ecran.voit("Scannez pour jouer", 30_000)
        ecran.neVoitPas("Reprendre la partie")
        assertEquals("La reprise ne crée aucune nouvelle partie", code, Boite.codeActif())
    }

    @Test
    fun boxRefuseePuisRedemandee() {
        verrouEnPlace()
        val (uid, code) = boxEnAttente()
        // « Refuser » dans la Régie PC : la demande est effacée, la box reste bloquée.
        Proprietaire.envoyer("DELETE", "boxes/requests/$uid")
        ecran.voit("refusée", 30_000)
        ecran.capture("box-refusee")
        ecran.ok("Redemander l'activation")
        attendreQue("nouvelle demande", 30_000) { Proprietaire.lire("boxes/requests/$uid/code").takeIf { "\"$code\"" == it.trim() } }
        ecran.voit("acceptez la box", 30_000)
        assertNull(Boite.codeActif())
    }
}

/** Écritures et lectures directes dans l'émulateur Firebase, sans règles (accès « owner »), comme la Régie PC. */
object Proprietaire {
    private fun url(chemin: String) =
        URL("http://${Emulateur.HOTE}:${Emulateur.PORT_BASE}/$chemin.json?${URL(GameViewModel.databaseUrl()).query}")

    fun envoyer(methode: String, chemin: String, corps: String? = null) {
        val cnx = url(chemin).openConnection() as HttpURLConnection
        try {
            cnx.requestMethod = methode
            cnx.setRequestProperty("Authorization", "Bearer owner")
            if (corps != null) {
                cnx.doOutput = true
                cnx.outputStream.use { it.write(corps.toByteArray()) }
            }
            check(cnx.responseCode == 200) { "$methode $chemin refusé par l'émulateur (${cnx.responseCode})" }
        } finally {
            cnx.disconnect()
        }
    }

    fun lire(chemin: String): String {
        val cnx = url(chemin).openConnection() as HttpURLConnection
        try {
            cnx.setRequestProperty("Authorization", "Bearer owner")
            return cnx.inputStream.bufferedReader().use { it.readText() }
        } finally {
            cnx.disconnect()
        }
    }
}
