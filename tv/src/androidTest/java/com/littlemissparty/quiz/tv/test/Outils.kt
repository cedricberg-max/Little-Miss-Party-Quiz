package com.littlemissparty.quiz.tv.test

import android.content.Context
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import com.littlemissparty.quiz.engine.Quiz
import com.littlemissparty.quiz.engine.QuizJson
import com.littlemissparty.quiz.tv.GameViewModel
import com.littlemissparty.quiz.tv.MainActivity
import com.littlemissparty.quiz.tv.habillage.Look
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
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

/** Attend une opération Firebase ; en cas de délai dépassé, l'erreur montre la ligne du test qui attendait. */
fun <T> bloquer(ms: Long = 20_000, bloc: suspend () -> T): T {
    val appel = Throwable("Appel en attente")
    return try {
        runBlocking { withTimeout(ms) { bloc() } }
    } catch (e: TimeoutCancellationException) {
        throw AssertionError("Firebase n'a pas répondu en ${ms / 1000} s", appel)
    }
}

/**
 * Connexion anonyme d'un client simulé (pupitre, régie, autre box). L'émulateur d'authentification ferme parfois une
 * connexion gardée ouverte au moment où on la réutilise (« unexpected end of stream », essai du 23 octobre, dix
 * connexions en quelques secondes) : on recommence, comme un vrai pupitre qui se recharge. Toute autre erreur échoue.
 */
fun connexionAnonyme(auth: FirebaseAuth): String {
    repeat(2) { essai ->
        try {
            return bloquer { auth.signInAnonymously().await().user!!.uid }
        } catch (e: FirebaseException) {
            if (e !is FirebaseNetworkException && e.message?.contains("end of stream") != true) throw e
            Log.w(TAG, "Connexion anonyme coupée par l'émulateur (essai ${essai + 1}), on recommence : ${e.message}")
            Thread.sleep(500)
        }
    }
    return bloquer { auth.signInAnonymously().await().user!!.uid }
}

/** Lecture ponctuelle par écouteur : `get()` peut rester bloqué quand la connexion s'est mise en veille. */
suspend fun DatabaseReference.lireUneFois(): DataSnapshot = suspendCancellableCoroutine { suite ->
    val ecouteur = object : ValueEventListener {
        override fun onDataChange(snapshot: DataSnapshot) {
            if (suite.isActive) suite.resume(snapshot)
        }

        override fun onCancelled(error: DatabaseError) {
            if (suite.isActive) suite.resumeWithException(error.toException())
        }
    }
    addListenerForSingleValueEvent(ecouteur)
    suite.invokeOnCancellation { removeEventListener(ecouteur) }
}

/** Titre de l'écran des scores : « TABLEAU DES SCORES » en Game Show (le design par défaut), « Classement » en Classique. */
fun titreClassement() = if (Look.gs) "TABLEAU DES SCORES" else "Classement"

/** La box : l'appli TV elle-même, dans le même processus que les tests. */
object Boite {
    val contexte: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
    val base: FirebaseDatabase get() = FirebaseDatabase.getInstance(GameViewModel.databaseUrl())
    private val prefs get() = contexte.getSharedPreferences("partie", Context.MODE_PRIVATE)

    /** Repart d'une box neuve : aucune partie à reprendre. */
    fun oublierPartie() = prefs.edit().clear().commit()

    private val design get() = contexte.getSharedPreferences("lmp_design", Context.MODE_PRIVATE)

    /** Design choisi dans le menu Retour (« gs » ou « classique ») ; null = celui de la box par défaut (The Game Show). */
    fun choisirDesign(cle: String?) = design.edit().apply { if (cle == null) clear() else putString("design-v2", cle) }.commit()

    fun codeActif(): String? = prefs.getString("active_game", null)

    fun lancer(): ActivityScenario<MainActivity> = ActivityScenario.launch(MainActivity::class.java)

    /** État public de la partie tel que la box l'a publié (copie locale si la box est hors ligne). */
    fun etat(code: String): DataSnapshot = bloquer { base.getReference("games/$code/state").lireUneFois() }

    fun quizDemo(): Quiz = QuizJson.parse(contexte.assets.open("quizzes/demo.json").bufferedReader().use { it.readText() })

    /**
     * Refuse de continuer si l'émulateur Firebase n'est pas joignable. La vérification passe par une
     * connexion à part : la box doit faire elle-même sa première connexion, comme sur la vraie Mi Box.
     */
    fun verifierEmulateur() {
        attendreHote()
        if (controle.lire("games/${Emulateur.MARQUEUR}/hostUid") != Emulateur.VALEUR_MARQUEUR) {
            throw AssertionError("Émulateur Firebase introuvable : tests arrêtés pour ne pas toucher la vraie base")
        }
    }

    /**
     * Juste après le démarrage de l'émulateur Android, l'ordinateur hôte (10.0.2.2) peut refuser les connexions quelques
     * secondes (CI du 22/10 : les 9 premiers tests refusés, les 38 suivants verts) : on attend que l'émulateur Firebase
     * réponde, 60 s au plus, avant la première connexion.
     */
    private fun attendreHote() {
        val fin = SystemClock.elapsedRealtime() + 60_000
        for (port in listOf(Emulateur.PORT_AUTH, Emulateur.PORT_BASE)) {
            while (runCatching { Socket().use { it.connect(InetSocketAddress(Emulateur.HOTE, port), 1_000) } }.isFailure) {
                if (SystemClock.elapsedRealtime() > fin) throw AssertionError("Émulateur Firebase injoignable sur ${Emulateur.HOTE}:$port")
                SystemClock.sleep(500)
            }
        }
    }

    /** Connexion de contrôle, ouverte une fois pour toute la série. */
    val controle by lazy { PupitreSimule("controle") }
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

    fun voit(texte: String, ms: Long = 20_000) {
        if (!attendre(ms) { affiche(texte) }) {
            capture("introuvable")
            runCatching { Log.e(TAG, "« $texte » introuvable, plan de l'écran :\n${plan()}") }
            throw AssertionError("« $texte » n'apparaît pas à l'écran")
        }
    }

    /**
     * Texte qui ne reste que 2 s (annonce BONUS / MALUS) : lu seulement dans l'arbre Compose, sans passer par
     * UiAutomator (lent pendant une animation), relu toutes les 50 ms pour ne pas le manquer.
     */
    fun apercoit(texte: String, ms: Long = 5_000) {
        val fin = SystemClock.uptimeMillis() + ms
        while (!runCatching { elements().any { texte in it.texte } }.getOrDefault(false)) {
            if (SystemClock.uptimeMillis() > fin) {
                capture("introuvable")
                runCatching { Log.e(TAG, "« $texte » jamais aperçu, plan de l'écran :\n${plan()}") }
                throw AssertionError("« $texte » n'est jamais apparu à l'écran")
            }
            Thread.sleep(50)
        }
    }

    fun neVoitPas(texte: String, ms: Long = 10_000) {
        if (!attendre(ms) { !affiche(texte) }) {
            capture("encore-visible")
            throw AssertionError("« $texte » est encore à l'écran")
        }
    }

    fun affiche(texte: String): Boolean =
        device.hasObject(By.textContains(texte)) || elements().any { it.visible && texte in it.texte }

    fun aLeFocus(texte: String): Boolean =
        device.hasObject(By.textContains(texte).focused(true)) || elements().any { it.visible && it.focus && texte in it.texte }

    /** Le texte est entièrement à l'écran : ni coupé par un bord, ni masqué par une zone qui défile. */
    fun entierementVisible(texte: String, ms: Long = 5_000) {
        if (!attendre(ms) { elements().any { it.entier && texte in it.texte } }) {
            capture("coupe")
            runCatching { Log.e(TAG, "« $texte » coupé ou hors écran, plan de l'écran :\n${plan()}") }
            throw AssertionError("« $texte » n'est pas entièrement visible")
        }
    }

    /** Attend que le bouton portant ce texte ait le focus de la télécommande. */
    fun focusSur(texte: String, ms: Long = 8_000) {
        if (!attendre(ms) { aLeFocus(texte) }) {
            capture("focus")
            runCatching { Log.e(TAG, "Pas de focus sur « $texte », plan de l'écran :\n${plan()}") }
            throw AssertionError("Le bouton « $texte » n'a pas le focus de la télécommande")
        }
    }

    private fun attendre(ms: Long, test: () -> Boolean): Boolean {
        val fin = SystemClock.uptimeMillis() + ms
        while (true) {
            if (runCatching(test).getOrDefault(false)) return true
            if (SystemClock.uptimeMillis() > fin) return false
            Thread.sleep(250)
        }
    }

    /**
     * Un texte de l'interface Compose, lu dans l'arbre sémantique de l'appli ; [centreX] : milieu de sa boîte dans la
     * fenêtre, de largeur [largeurFenetre] (pixels).
     */
    data class Element(
        val texte: String, val focus: Boolean, val visible: Boolean, val entier: Boolean = false,
        val centreX: Float = -1f, val largeurFenetre: Int = 0,
    )

    /**
     * Les boutons Compose ne donnent pas leur texte à UiAutomator (il n'y voit qu'une vue vide) :
     * on lit l'arbre sémantique de chaque fenêtre de l'appli, comme les tests Compose, mais sans
     * attendre un écran immobile, car le fond animé ne s'arrête jamais.
     */
    fun elements(): List<Element> {
        val liste = mutableListOf<Element>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            fenetres().flatMap(::racinesCompose).forEach { racine ->
                parcourir(racine.semanticsOwner.rootSemanticsNode, racine.view.rootView, liste)
            }
        }
        return liste
    }

    /** Toutes les fenêtres de l'appli, fenêtres de dialogue comprises (même méthode qu'Espresso). */
    private fun fenetres(): List<View> = runCatching {
        val wmg = Class.forName("android.view.WindowManagerGlobal")
        val instance = wmg.getMethod("getInstance").invoke(null)
        val vues = wmg.getDeclaredField("mViews").apply { isAccessible = true }.get(instance)
        @Suppress("UNCHECKED_CAST")
        (vues as List<View>).toList()
    }.getOrElse {
        ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).map { it.window.decorView }
    }

    private fun racinesCompose(v: View): List<ViewRootForTest> = when (v) {
        is ViewRootForTest -> listOf(v)
        is ViewGroup -> (0 until v.childCount).flatMap { racinesCompose(v.getChildAt(it)) }
        else -> emptyList()
    }

    private fun parcourir(n: SemanticsNode, fenetre: View, liste: MutableList<Element>) {
        val textes = n.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } +
            n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
        if (textes.isNotEmpty()) {
            val b = n.boundsInWindow
            val visible = b.width > 0 && b.height > 0 && b.bottom > 0 && b.right > 0 &&
                b.top < fenetre.height && b.left < fenetre.width
            // boundsInWindow est rognée par les parents : plus petite que le texte, il est coupé.
            val entier = visible && b.top >= 0 && b.left >= 0 && b.bottom <= fenetre.height && b.right <= fenetre.width &&
                b.height >= n.size.height - 1 && b.width >= n.size.width - 1
            liste += Element(textes.joinToString(" "), n.config.getOrNull(SemanticsProperties.Focused) == true, visible, entier, b.center.x, fenetre.width)
        }
        n.children.forEach { parcourir(it, fenetre, liste) }
    }

    /** Appuie sur OK quand le bouton attendu est à l'écran et sélectionné. */
    fun ok(surBouton: String) {
        voit(surBouton)
        focusSur(surBouton)
        device.pressDPadCenter()
    }

    fun touche(code: Int) = device.pressKeyCode(code)

    /** Textes visibles à l'écran, écrits dans le journal quand un test échoue. */
    fun textes(): String = (
        device.findObjects(By.textStartsWith("")).mapNotNull { runCatching { it.text }.getOrNull() } +
            runCatching { elements().filter { it.visible }.map { it.texte } }.getOrDefault(emptyList())
        ).filter { it.isNotBlank() }.distinct().joinToString(" | ")

    /** Taille de l'écran et position de chaque élément, pour voir ce qui sort de l'écran. */
    fun plan(): String {
        val m = Boite.contexte.resources.displayMetrics
        val xml = ByteArrayOutputStream().also { device.dumpWindowHierarchy(it) }.toString()
        val noeuds = Regex("""<node [^>]*>""").findAll(xml).mapNotNull { n ->
            val attr = { a: String -> Regex("""\s$a="([^"]*)"""").find(n.value)?.groupValues?.get(1).orEmpty() }
            val texte = attr("text").ifBlank { attr("content-desc") }
            if (texte.isBlank() && attr("focusable") != "true") null
            else "${attr("bounds")} ${attr("class").substringAfterLast('.')} « $texte »" +
                (if (attr("focused") == "true") " [focus]" else "")
        }
        val compose = runCatching { elements() }.getOrDefault(emptyList()).joinToString("\n") {
            "Compose « ${it.texte} »" + (if (it.focus) " [focus]" else "") + (if (it.visible) "" else " [hors écran]")
        }
        return "écran ${device.displayWidth}x${device.displayHeight} px, densité ${m.densityDpi} dpi\n" +
            noeuds.joinToString("\n") + "\n" + compose
    }

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

    @Volatile private var connecte = false

    init {
        Emulateur.brancher(auth, base)
        uid = connexionAnonyme(auth)
        base.getReference(".info/connected").addValueEventListener(object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                connecte = snapshot.getValue(Boolean::class.java) == true
                Log.i(TAG, "Pupitre $etiquette : ${if (connecte) "connecté" else "déconnecté"}")
            }

            override fun onCancelled(error: DatabaseError) = Unit
        })
    }

    fun rejoindre(code: String, nom: String, couleur: String) {
        bloquer {
            // Comme le pupitre : l'équipe et sa couleur réservée dans la même écriture.
            base.getReference("games/$code").updateChildren(
                mapOf(
                    "teams/$uid" to mapOf("name" to nom, "color" to couleur, "joinedAt" to ServerValue.TIMESTAMP),
                    "colors/${couleur.removePrefix("#").uppercase()}" to uid,
                ),
            ).await()
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

    /** « Reconnecter une tablette » : comme la page web, demande à reprendre l'équipe [equipe]. */
    fun demanderReprise(code: String, equipe: String, nom: String, couleur: String) {
        bloquer {
            base.getReference("games/$code/joinRequests/$uid").setValue(
                mapOf("name" to nom, "color" to couleur, "replace" to equipe, "at" to ServerValue.TIMESTAMP),
            ).await()
        }
    }

    /** Envoie une réponse ; renvoie false si le serveur la refuse. */
    fun repondre(code: String, qid: String, choix: Int): Boolean = runCatching {
        bloquer {
            base.getReference("games/$code/answers/$qid/$uid")
                .setValue(mapOf("choice" to choix, "at" to ServerValue.TIMESTAMP)).await()
        }
    }.onFailure { Log.i(TAG, "Réponse refusée : ${it.message}") }.isSuccess

    /** Image floue : buzze sous la clé de l'essai en cours ; renvoie false si le serveur refuse (buzzer fermé ou déjà pris). */
    fun buzzer(code: String): Boolean = runCatching {
        val cle = etat(code).child("round").value.toString()
        bloquer {
            base.getReference("games/$code/buzz/$cle")
                .setValue(mapOf("team" to uid, "at" to ServerValue.TIMESTAMP)).await()
        }
    }.onFailure { Log.i(TAG, "Buzz refusé : ${it.message}") }.isSuccess

    /** Pictionary : le dessinateur choisit l'un des 3 mots proposés ; renvoie false si le serveur refuse. */
    fun choisirMot(code: String, choix: Int): Boolean = runCatching {
        val cle = etat(code).child("mime/pickKey").value.toString()
        bloquer {
            base.getReference("games/$code/pictoChoice/$cle")
                .setValue(mapOf("i" to choix, "at" to ServerValue.TIMESTAMP)).await()
        }
    }.onFailure { Log.i(TAG, "Choix du mot refusé : ${it.message}") }.isSuccess

    /** Les coffres mystères : l'équipe qui joue ouvre le coffre [choix] ; renvoie false si le serveur refuse. */
    fun ouvrirCoffre(code: String, choix: Int): Boolean = runCatching {
        val cle = etat(code).child("chests/key").value.toString()
        bloquer {
            base.getReference("games/$code/chestChoice/$cle")
                .setValue(mapOf("i" to choix, "at" to ServerValue.TIMESTAMP)).await()
        }
    }.onFailure { Log.i(TAG, "Coffre refusé : ${it.message}") }.isSuccess

    /** Gonfleur fou : envoie [n] tapes au total pour cette équipe ; renvoie false si le serveur refuse. */
    fun gonfler(code: String, n: Int): Boolean = runCatching {
        val cle = etat(code).child("pump/key").value.toString()
        bloquer {
            base.getReference("games/$code/pumps/$cle/$uid")
                .setValue(mapOf("n" to n, "at" to ServerValue.TIMESTAMP)).await()
        }
    }.onFailure { Log.i(TAG, "Tapes refusées : ${it.message}") }.isSuccess

    /** « Ça va exploser ! » : la tablette de l'équipe qui tient la bombe l'envoie à [vers] ; false si le serveur refuse. */
    fun envoyerPatate(code: String, vers: String): Boolean = runCatching {
        val cle = etat(code).child("potato/key").value?.toString() ?: error("pas de bombe en jeu")
        bloquer {
            base.getReference("games/$code/potatoPass/$cle")
                .setValue(mapOf("to" to vers, "at" to ServerValue.TIMESTAMP)).await()
        }
    }.onFailure { Log.i(TAG, "Envoi de la bombe refusé : ${it.message}") }.isSuccess

    /** Pictionary : envoie un morceau de trait (« x,y x,y … » de 0 à 1000) ; renvoie false si le serveur refuse. */
    fun dessiner(code: String, points: String, couleur: String = "#F94144", epaisseur: Int = 3): Boolean = runCatching {
        val cle = etat(code).child("mime/drawKey").value.toString()
        bloquer {
            base.getReference("games/$code/drawing/$cle").push()
                .setValue(mapOf("c" to couleur, "w" to epaisseur, "p" to points)).await()
        }
    }.onFailure { Log.i(TAG, "Trait refusé : ${it.message}") }.isSuccess

    /** État de la partie lu sur le serveur. */
    fun etat(code: String): DataSnapshot = bloquer { base.getReference("games/$code/state").lireUneFois() }

    fun lire(chemin: String): Any? = bloquer { base.getReference(chemin).lireUneFois() }.value

    fun equipes(code: String): DataSnapshot = bloquer { base.getReference("games/$code/teams").lireUneFois() }

    fun couperReseau() = base.goOffline()

    /** Comme la page web quand le Wi-Fi revient : reconnexion, puis présence signalée de nouveau. */
    fun retablirReseau(code: String) {
        base.goOnline()
        attendreQue("reconnexion du pupitre", 30_000) { connecte.takeIf { it } }
        signalerPresence(code)
    }

    // L'appli Firebase du pupitre n'est pas supprimée : seulement déconnectée.
    override fun close() {
        runCatching { base.goOffline() }
    }
}
