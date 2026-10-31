package com.littlemissparty.quiz.tv.test

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.firebase.auth.FirebaseAuth
import com.littlemissparty.quiz.tv.MainActivity
import java.io.File
import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneId
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Préchargement des prestations du jour (cedric, 30/10) : une box acceptée, au robot qui dort, copie seule les photos
 * et les musiques de la prestation prévue aujourd'hui dans la Régie PC, sans que personne ne scanne quoi que ce soit.
 * Celles d'une prestation d'un autre jour ne sont pas copiées.
 */
@RunWith(AndroidJUnit4::class)
class PrechargementBoxTest : TestTv() {
    private var appli: ActivityScenario<MainActivity>? = null

    @After
    fun ranger() {
        appli?.close()
        Proprietaire.envoyer("DELETE", "boxes")
        Proprietaire.envoyer("DELETE", "library")
    }

    private fun empreinte(data: String) = MessageDigest.getInstance("SHA-256").digest(data.toByteArray()).take(8).joinToString("") { "%02x".format(it) }

    @Test
    fun laBoxAccepteeCopieSeuleLaPrestationDuJourDesLAccueil() {
        val photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        val autreSon = "data:audio/mpeg;base64,AAAAAAAA"
        val idSon = empreinte(EXTRAIT_MP3)
        val idPhoto = empreinte(photo)
        val idAutre = empreinte(autreSon)
        val dossier = Boite.contexte.filesDir
        val fichiers = listOf(File(dossier, "extraits/$idSon.mp3"), File(dossier, "photos/$idPhoto"), File(dossier, "extraits/$idAutre.mp3"))
        fichiers.forEach { it.delete() }

        val paris = ZoneId.of("Europe/Paris")
        val aujourdhui = LocalDate.now(paris).toString()
        val demain = LocalDate.now(paris).plusDays(1).toString()
        // Ce que la Régie PC a enregistré : un quiz avec sa photo, un blind test avec son extrait, et la prestation
        // d'une autre fête, demain.
        Proprietaire.envoyer("PUT", "library/sounds/$idSon", "\"$EXTRAIT_MP3\"")
        Proprietaire.envoyer("PUT", "library/sounds/$idAutre", "\"$autreSon\"")
        Proprietaire.envoyer("PUT", "library/images/$idPhoto", "\"$photo\"")
        Proprietaire.envoyer("PUT", "library/quizzes/q-jour", """{"title":"Animaux","questions":[{"text":"Quel animal ?","imageId":"$idPhoto"}]}""")
        Proprietaire.envoyer(
            "PUT", "library/shows",
            """{"lea":{"date":"$aujourdhui","status":"publiee","childName":"Léa","rounds":[{"type":"quiz","quizId":"q-jour"},{"type":"blind","tracks":["$idSon"]}]},
               "tom":{"date":"$demain","status":"publiee","childName":"Tom","rounds":[{"type":"blind","tracks":["$idAutre"]}]}}""",
        )

        // Box acceptée dans la Régie PC (verrou en place, comme chez Sarah).
        Proprietaire.envoyer("PUT", "boxes", """{"lockOn":true,"allowed":{"tv-du-salon":{"name":"TV du salon","at":1}}}""")
        appli = Boite.lancer()
        ecran.voit("Box en attente d'activation", 30_000)
        val uid = attendreQue("connexion de la box", 30_000) { FirebaseAuth.getInstance().currentUser?.uid }
        attendreQue("demande d'activation", 30_000) { Proprietaire.lire("boxes/requests/$uid/code").takeIf { it.trim() != "null" } }
        Proprietaire.envoyer("PUT", "boxes/allowed/$uid", """{"name":"Mi Box","at":2}""")
        Proprietaire.envoyer("DELETE", "boxes/requests/$uid")
        ecran.voit("Scannez pour jouer", 30_000)

        // Personne ne scanne : la box copie seule la photo et la musique de la fête du jour.
        attendreQue("photo de la prestation du jour copiée", 60_000) { fichiers[1].takeIf { it.isFile && it.length() > 0 } }
        attendreQue("musique de la prestation du jour copiée", 60_000) { fichiers[0].takeIf { it.isFile && it.length() > 0 } }
        assertFalse("la prestation de demain n'est pas copiée", fichiers[2].exists())
        ecran.voit("Scannez pour jouer")
    }
}
