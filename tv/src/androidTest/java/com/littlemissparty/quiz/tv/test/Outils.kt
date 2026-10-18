package com.littlemissparty.quiz.tv.test

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.littlemissparty.quiz.engine.Quiz
import com.littlemissparty.quiz.engine.QuizJson
import com.littlemissparty.quiz.tv.GameViewModel
import com.littlemissparty.quiz.tv.MainActivity
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout

const val TAG = "TestsTV"

/** Répète [test] jusqu'à obtenir une valeur non nulle, ou échoue au bout de [ms]. */
fun <T : Any> attendreQue(quoi: String, ms: Long = 20_000, test: () -> T?): T {
    val fin = SystemClock.uptimeMillis() + ms
    while (true) {
        runCatching(test).getOrNull()?.let { return it }
        if (SystemClock.uptimeMillis() > fin) throw AssertionError("Délai dépassé : $quoi")
        Thread.sleep(200)
    }
}

fun <T> bloquer(ms: Long = 20_000, bloc: suspend () -> T): T = runBlocking { withTimeout(ms) { bloc() } }

/** La box : l'appli TV elle-même, dans le même processus que les tests. */
object Boite {
    val contexte: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
    val base: FirebaseDatabase get() = FirebaseDatabase.getInstance(GameViewModel.databaseUrl())
    private val prefs get() = contexte.getSharedPreferences("partie", Context.MODE_PRIVATE)

    /** Repart d'une box neuve : aucune partie à reprendre. */
    fun oublierPartie() = prefs.edit().clear().commit()

    fun codeActif(): String? = prefs.getString("active_game", null)

    fun lancer(): ActivityScenario<MainActivity> = ActivityScenario.launch(MainActivity::class.java)

    /** État public de la partie tel que la box l'a publié (copie locale si la box est hors ligne). */
    fun etat(code: String): DataSnapshot = bloquer { base.getReference("games/$code/state").get().await() }

    fun quizDemo(): Quiz = QuizJson.parse(contexte.assets.open("quizzes/demo.json").bufferedReader().use { it.readText() })

    /** Refuse de continuer si l'appli n'est pas sur l'émulateur Firebase. */
    fun verifierEmulateur() {
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser == null) bloquer { auth.signInAnonymously().await() }
        val valeur = bloquer { base.getReference("games/${Emulateur.MARQUEUR}/hostUid").get().await() }.value
        if (valeur != Emulateur.VALEUR_MARQUEUR) {
            throw AssertionError("La base n'est pas l'émulateur Firebase : tests arrêtés pour ne pas toucher la vraie base")
        }
    }
}

/** L'écran de la TV et la télécommande, pilotés comme par l'animatrice. */
class Ecran(private val nomTest: () -> String) {
    val device: UiDevice = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private var numero = 0

    init {
        // Le fond animé ne s'arrête jamais : on n'attend pas que l'écran soit « immobile ».
        Configurator.getInstance()
            .setWaitForIdleTimeout(100)
            .setWaitForSelectorTimeout(0)
            .setActionAcknowledgmentTimeout(300)
        device.executeShellCommand("mkdir -p $DOSSIER_CAPTURES")
    }

    fun voit(texte: String, ms: Long = 20_000): UiObject2 =
        device.wait(Until.findObject(By.textContains(texte)), ms)
            ?: run {
                capture("introuvable")
                throw AssertionError("« $texte » n'apparaît pas à l'écran")
            }

    fun neVoitPas(texte: String, ms: Long = 10_000) {
        if (device.wait(Until.gone(By.textContains(texte)), ms) != true) {
            capture("encore-visible")
            throw AssertionError("« $texte » est encore à l'écran")
        }
    }

    fun affiche(texte: String): Boolean = device.hasObject(By.textContains(texte))

    fun aLeFocus(texte: String): Boolean = device.hasObject(By.textContains(texte).focused(true))

    /** Attend que le bouton portant ce texte ait le focus de la télécommande. */
    fun focusSur(texte: String, ms: Long = 8_000) {
        if (device.wait(Until.hasObject(By.textContains(texte).focused(true)), ms) != true) {
            capture("focus")
            throw AssertionError("Le bouton « $texte » n'a pas le focus de la télécommande")
        }
    }

    /** Appuie sur OK quand le bouton attendu est à l'écran et sélectionné. */
    fun ok(surBouton: String) {
        voit(surBouton)
        focusSur(surBouton)
        device.pressDPadCenter()
    }

    fun touche(code: Int) = device.pressKeyCode(code)

    fun capture(nom: String) {
        val fichier = "$DOSSIER_CAPTURES/${nomTest()}-%02d-$nom.png".format(++numero)
        Log.i(TAG, "Capture $fichier")
        device.executeShellCommand("screencap -p $fichier")
    }

    companion object {
        /** Récupéré par le workflow après les tests (adb pull). */
        const val DOSSIER_CAPTURES = "/data/local/tmp/lmp-captures"
    }
}

/**
 * Un pupitre d'équipe simulé : sa propre connexion anonyme à Firebase, et les mêmes écritures
 * que la page web des pupitres, soumises aux mêmes règles de sécurité.
 */
class PupitreSimule(etiquette: String) : AutoCloseable {
    private val app = FirebaseApp.initializeApp(
        Boite.contexte, FirebaseApp.getInstance().options, "pupitre-$etiquette-${UUID.randomUUID()}",
    )
    private val auth = FirebaseAuth.getInstance(app)
    private val base = FirebaseDatabase.getInstance(app, GameViewModel.databaseUrl())
    val uid: String

    init {
        Emulateur.brancher(auth, base)
        uid = bloquer { auth.signInAnonymously().await().user!!.uid }
    }

    fun rejoindre(code: String, nom: String, couleur: String) {
        bloquer {
            base.getReference("games/$code/teams/$uid")
                .setValue(mapOf("name" to nom, "color" to couleur, "joinedAt" to ServerValue.TIMESTAMP)).await()
        }
        signalerPresence(code)
    }

    /** Comme la page web : « hors ligne » écrit par le serveur dès que la connexion tombe. */
    private fun signalerPresence(code: String) {
        val presence = base.getReference("games/$code/presence/$uid")
        bloquer {
            presence.onDisconnect().setValue(mapOf("online" to false, "at" to ServerValue.TIMESTAMP)).await()
            presence.setValue(mapOf("online" to true, "at" to ServerValue.TIMESTAMP)).await()
        }
    }

    /** Envoie une réponse ; renvoie false si le serveur la refuse. */
    fun repondre(code: String, qid: String, choix: Int): Boolean = runCatching {
        bloquer {
            base.getReference("games/$code/answers/$qid/$uid")
                .setValue(mapOf("choice" to choix, "at" to ServerValue.TIMESTAMP)).await()
        }
    }.onFailure { Log.i(TAG, "Réponse refusée : ${it.message}") }.isSuccess

    /** État de la partie lu sur le serveur. */
    fun etat(code: String): DataSnapshot = bloquer { base.getReference("games/$code/state").get().await() }

    fun equipes(code: String): DataSnapshot = bloquer { base.getReference("games/$code/teams").get().await() }

    fun couperReseau() = base.goOffline()

    fun retablirReseau(code: String) {
        base.goOnline()
        signalerPresence(code)
    }

    override fun close() {
        runCatching { base.goOffline() }
        runCatching { app.delete() }
    }
}
