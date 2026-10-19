package com.littlemissparty.quiz.tv.test

import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.littlemissparty.quiz.tv.GameViewModel
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.tasks.await

/**
 * Le téléphone de l'animatrice en mode régie : mêmes écritures que la page web
 * (mot de passe commun vérifié par les règles, commandes avec le numéro d'étape affiché).
 */
class RegieSimulee : AutoCloseable {
    private val app = FirebaseApp.initializeApp(
        Boite.contexte, FirebaseApp.getInstance().options, "regie-${UUID.randomUUID()}",
    )
    private val auth = FirebaseAuth.getInstance(app)
    private val base = FirebaseDatabase.getInstance(app, GameViewModel.databaseUrl())
    val uid: String

    init {
        Emulateur.brancher(auth, base)
        uid = bloquer { auth.signInAnonymously().await().user!!.uid }
    }

    /** Comme le bouton « Accès régie » : renvoie true si le serveur accepte le mot de passe. */
    fun connecter(code: String, motDePasse: String): Boolean {
        val sel = bloquer { base.getReference("settings/regie/salt").lireUneFois() }.value as String
        val empreinte = sha256("$sel:$motDePasse")
        val porte = base.getReference("regieGate/try")
        // Un seul essai toutes les 2 secondes pour tous les téléphones : on attend son tour.
        repeat(4) {
            Thread.sleep(2_200)
            val ouverte = runCatching {
                bloquer { porte.setValue(mapOf("uid" to uid, "at" to ServerValue.TIMESTAMP)).await() }
            }.isSuccess
            if (!ouverte) return@repeat
            val gateAt = bloquer { base.getReference("regieGate/try/at").lireUneFois() }.value
            bloquer {
                base.getReference("regieProof/$uid")
                    .setValue(mapOf("hash" to empreinte, "gateAt" to gateAt, "at" to ServerValue.TIMESTAMP)).await()
            }
            return runCatching {
                bloquer {
                    base.getReference("games/$code/regie/$uid")
                        .setValue(mapOf("pairedAt" to ServerValue.TIMESTAMP, "via" to "password")).await()
                }
            }.onFailure { Log.i(TAG, "Régie refusée : ${it.message}") }.isSuccess
        }
        throw AssertionError("La porte de la régie est restée occupée")
    }

    /** Numéro d'étape publié par la box, celui qu'affiche la régie. */
    fun etape(code: String): Int =
        (bloquer { base.getReference("games/$code/state/seq").lireUneFois() }.value as? Number)?.toInt() ?: 0

    /** Écrit une commande sans attendre la réponse de la box ; renvoie son identifiant, ou null si refusée. */
    fun envoyer(code: String, type: String, expectSeq: Int = etape(code), extra: Map<String, Any> = emptyMap()): String? {
        val ref = base.getReference("games/$code/commands").push()
        val donnees = mapOf("type" to type, "expectSeq" to expectSeq, "by" to uid, "at" to ServerValue.TIMESTAMP) + extra
        return runCatching { bloquer { ref.setValue(donnees).await() } }
            .onFailure { Log.i(TAG, "Commande refusée par le serveur : ${it.message}") }
            .map { ref.key!! }.getOrNull()
    }

    /** Verdict de la box pour une commande : applied, stale, refused… */
    fun verdict(code: String, id: String): String = attendreQue("verdict de la box pour $id") {
        bloquer { base.getReference("games/$code/commandStatus/$id/status").lireUneFois() }.value as? String
    }

    fun commande(code: String, type: String, extra: Map<String, Any> = emptyMap()): String {
        val id = envoyer(code, type, extra = extra) ?: throw AssertionError("Commande « $type » refusée par le serveur")
        return verdict(code, id)
    }

    fun lireConducteur(code: String): Boolean = runCatching {
        bloquer { base.getReference("games/$code/conducteur").lireUneFois() }.exists()
    }.getOrDefault(false)

    /** Programme en vigueur publié par la box (conducteur) : titre, version et questions. */
    @Suppress("UNCHECKED_CAST")
    fun programme(code: String): Map<String, Any?> =
        bloquer { base.getReference("games/$code/conducteur").lireUneFois() }.value as Map<String, Any?>

    /**
     * Comme « Ajouter un jeu » ou les flèches du conducteur : programme modifié préparé sur la version [base].
     * Renvoie le verdict de la box : "applied", ou la raison du refus (stale, current_round…).
     */
    fun modifierProgramme(code: String, base: String, questions: List<Map<String, Any?>>): String {
        val plan = programme(code)
        val ref = this.base.getReference("games/$code/show")
        val id = ref.push().key!!
        bloquer {
            ref.setValue(mapOf(
                "id" to id, "base" to base, "title" to plan["title"], "by" to uid, "at" to ServerValue.TIMESTAMP,
                "quiz" to mapOf("id" to plan["id"], "title" to plan["title"], "questions" to questions),
            )).await()
        }
        return attendreQue("verdict de la box pour le programme $id") {
            val statut = bloquer { this.base.getReference("games/$code/showStatus").lireUneFois() }
            if (statut.child("id").value != id) null
            else if (statut.child("status").value == "applied") "applied"
            else statut.child("reason").value as? String ?: "refused"
        }
    }

    /** Comme la régie au chargement d'une prestation : copie une photo de la bibliothèque dans la partie. */
    fun copierPhoto(code: String, id: String, dataUrl: String) {
        bloquer { base.getReference("games/$code/images/$id").setValue(dataUrl).await() }
    }

    /** Comme la régie : copie la photo d'une réponse en image, là où la box et les tablettes la lisent. */
    fun copierPhotoReponse(code: String, id: String, dataUrl: String) {
        bloquer { base.getReference("games/$code/choiceImages/$id").setValue(dataUrl).await() }
    }

    fun copierExtrait(code: String, id: String, dataUrl: String) {
        bloquer { base.getReference("games/$code/sounds/$id").setValue(dataUrl).await() }
    }

    /** Ce que la box dit d'un extrait : ok (en cache), loading, missing. */
    fun extraitPret(code: String, id: String): String? =
        bloquer { base.getReference("games/$code/media/$id").lireUneFois() }.value as? String

    override fun close() {
        runCatching { base.goOffline() }
    }

    companion object {
        const val MOT_DE_PASSE = "regie-test-2026"

        /** Enregistre le mot de passe commun comme le ferait Sarah dans l'admin (accès « owner » de l'émulateur). */
        fun definirMotDePasse(motDePasse: String = MOT_DE_PASSE) {
            val sel = "0123456789abcdef0123456789abcdef"
            val corps = """{"salt":"$sel","hash":"${sha256("$sel:$motDePasse")}","updatedAt":${System.currentTimeMillis()}}"""
            // Adresse de l'émulateur donnée à l'appli de test : http://10.0.2.2:9000?ns=<base>.
            val url = URL("http://${Emulateur.HOTE}:${Emulateur.PORT_BASE}/settings/regie.json?${URL(GameViewModel.databaseUrl()).query}")
            val cnx = url.openConnection() as HttpURLConnection
            try {
                cnx.requestMethod = "PUT"
                cnx.setRequestProperty("Authorization", "Bearer owner")
                cnx.doOutput = true
                cnx.outputStream.use { it.write(corps.toByteArray()) }
                check(cnx.responseCode == 200) { "Mot de passe de régie non enregistré (${cnx.responseCode})" }
            } finally {
                cnx.disconnect()
            }
        }

        fun sha256(texte: String): String =
            MessageDigest.getInstance("SHA-256").digest(texte.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
