package com.littlemissparty.quiz.tv.test

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.ChildEventListener
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import com.littlemissparty.quiz.engine.PAUSE_NETWORK
import com.littlemissparty.quiz.engine.PAUSE_REGIE
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.RESUME_COUNTDOWN_MS
import com.littlemissparty.quiz.engine.Scoring
import com.littlemissparty.quiz.tv.GameViewModel
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.tasks.await
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Trois anniversaires le même jour, sur trois box : la vraie appli TV tient la fête de Léa, et le test joue en même
 * temps les deux autres box (fêtes de Tom et d'Inès), chacune avec son compte, ses tablettes et sa régie.
 * La TV de Léa ne doit jamais réagir qu'à sa propre partie : ni aux équipes, ni aux commandes, ni aux points des
 * autres fêtes, même pendant une coupure d'Internet ou un redémarrage de la box.
 */
@RunWith(AndroidJUnit4::class)
class TroisFetesTest : TestTv() {
    private val fetes = mutableListOf<FeteVoisine>()
    private val regies = mutableListOf<RegieSimulee>()

    private fun fete(etiquette: String) = FeteVoisine(etiquette, quiz.questions).also { fetes += it }

    private fun regie() = RegieSimulee().also { regies += it }

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @After
    fun rangerLesAutresFetes() {
        regies.forEach { runCatching { it.close() } }
        fetes.forEach { runCatching { it.close() } }
    }

    @Test
    fun troisFetesEnMemeTempsPuisInternetCoupeSurLaBoxDeLea() {
        val code = lancerBoite()
        val licornes = pupitre("lea-licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("lea-dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val tom = fete("tom")
        val ines = fete("ines")
        // Chez Tom aussi une équipe « Licornes », de la même couleur : chaque fête n'a que les siennes.
        val licornesTom = pupitre("tom-licornes").also { it.rejoindre(tom.code, "Licornes", VERT) }
        val sirenes = pupitre("tom-sirenes").also { it.rejoindre(tom.code, "Sirènes", ROSE) }
        val cometes = pupitre("ines-cometes").also { it.rejoindre(ines.code, "Comètes", VERT) }
        val pirates = pupitre("ines-pirates").also { it.rejoindre(ines.code, "Pirates", ROSE) }
        ecran.voit("Dragons")
        ecran.voit("2 équipe(s) dans la partie")

        // Les régies de Tom et d'Inès se relient au même moment : la TV de Léa n'en voit aucune.
        val regieLea = regie()
        val regieTom = regie()
        val regieInes = regie()
        assertEquals(
            listOf(true, true),
            enMemeTemps(
                { regieTom.connecter(tom.code, RegieSimulee.MOT_DE_PASSE) },
                { regieInes.connecter(ines.code, RegieSimulee.MOT_DE_PASSE) },
            ),
        )
        Thread.sleep(1_000)
        ecran.voit("Régie non reliée", 2_000)
        assertTrue(regieLea.connecter(code, RegieSimulee.MOT_DE_PASSE))
        ecran.voit("Régie reliée")

        // Tom et Inès lancent leur fête pendant que Léa attend encore ses invités au salon.
        val etapeLea = regieLea.etape(code)
        assertEquals("applied", regieTom.commande(tom.code, "next"))
        assertEquals("applied", regieInes.commande(ines.code, "next"))
        val q = attendreQuestion(licornesTom, tom.code, 0)
        val bonusTom = regieTom.envoyer(tom.code, "adjust", extra = mapOf("team" to licornesTom.uid, "delta" to 300))!!
        // Une équipe de Léa visée depuis la régie de Tom : la box de Tom ne la connaît pas, elle refuse.
        val intrus = regieTom.envoyer(tom.code, "adjust", extra = mapOf("team" to licornes.uid, "delta" to 300))!!
        assertTrue(licornesTom.repondre(tom.code, q.id, q.correct))
        assertTrue(sirenes.repondre(tom.code, q.id, mauvaiseReponse(q)))
        assertTrue(cometes.repondre(ines.code, q.id, q.correct))
        // La régie de Tom ne peut ni commander la TV de Léa, ni lire ses bonnes réponses.
        assertNull("Commande de la régie de Tom acceptée chez Léa", regieTom.envoyer(code, "next"))
        assertFalse(regieTom.lireConducteur(code))
        jamaisSurLaTv(4_000, "+300 POINTS", "BONUS !", "Sirènes", "Comètes", "Pirates", "Quiz · question")
        assertEquals("applied", regieTom.verdict(tom.code, bonusTom))
        assertEquals("refused", regieTom.verdict(tom.code, intrus))
        assertEquals(300L, points(licornesTom, tom.code, licornesTom.uid))
        assertEquals("question", cometes.etat(ines.code).child("phase").value)
        // La TV de Léa n'a pas bougé : toujours au salon, même étape, aucun point, seulement ses deux équipes.
        assertEquals("lobby", licornes.etat(code).child("phase").value)
        assertEquals(etapeLea, regieLea.etape(code))
        assertEquals(0L, points(licornes, code, licornes.uid))
        ecran.voit("Lancer la fête !")
        ecran.voit("2 équipe(s) dans la partie")

        // Léa donne un bonus aux Dragons puis lance sa fête : sa TV n'obéit qu'à sa régie.
        val bonusLea = regieLea.envoyer(code, "adjust", extra = mapOf("team" to dragons.uid, "delta" to 100))!!
        ecran.apercoit("+100 POINTS")
        assertEquals("applied", regieLea.verdict(code, bonusLea))
        assertEquals("applied", regieLea.commande(code, "next"))
        ecran.voit("Quiz · question 1 / ")
        attendreQuestion(licornes, code, 0)
        // Inès met sa fête en pause au même moment : la question de Léa continue.
        assertEquals("applied", regieInes.commande(ines.code, "pause"))
        assertEquals(false, licornes.etat(code).child("paused").value)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        // Même question au même moment chez Tom : ses tablettes ne répondent pas chez Léa, ni celles de Léa chez Tom.
        assertFalse(licornesTom.repondre(code, q.id, q.correct))
        assertFalse(dragons.repondre(tom.code, q.id, q.correct))

        // Internet coupé sur la box de Léa en pleine question ; Tom et Inès continuent leur fête.
        Boite.base.goOffline()
        try {
            ecran.voit("Hors connexion")
            ecran.voit("on attend le retour d'Internet")
            ecran.capture("lea-sans-internet")
            assertEquals("applied", regieTom.commande(tom.code, "next"))
            assertEquals("applied", regieTom.commande(tom.code, "next"))
            assertEquals("applied", regieInes.commande(ines.code, "resume"))
            Thread.sleep(3_500)
            assertTrue(pirates.repondre(ines.code, q.id, mauvaiseReponse(q)))
            assertEquals("applied", regieInes.commande(ines.code, "close"))
            ecran.voit("on attend le retour d'Internet")
            jamaisSurLaTv(1_000, "Sirènes", "Comètes", "Pirates")
        } finally {
            Boite.base.goOnline()
        }

        // Retour d'Internet : la partie de Léa, figée sur la même question, avec ses équipes et ses points.
        ecran.neVoitPas("Hors connexion", 30_000)
        val figee = attendreQue("pause de la box de Léa publiée au retour d'Internet") {
            licornes.etat(code).takeIf { it.child("paused").value == true && it.child("pauseReason").value == PAUSE_NETWORK }
        }
        assertEquals("question", figee.child("phase").value)
        assertEquals(q.id, figee.child("qid").value)
        assertEquals(100L, points(licornes, code, dragons.uid))
        assertEquals(setOf(licornes.uid, dragons.uid), licornes.equipes(code).children.mapNotNull { it.key }.toSet())
        ecran.voit("Régie reliée")
        // Pendant la coupure, Tom a révélé sa réponse et Inès a fermé sa question, sans rien de Léa.
        assertEquals("reveal", licornesTom.etat(tom.code).child("phase").value)
        assertEquals(400L, points(licornesTom, tom.code, licornesTom.uid))
        assertEquals(0L, points(sirenes, tom.code, sirenes.uid))
        assertEquals(setOf(licornesTom.uid, sirenes.uid), licornesTom.equipes(tom.code).children.mapNotNull { it.key }.toSet())
        assertEquals("closed", cometes.etat(ines.code).child("phase").value)

        // Léa relance depuis sa régie : même question, et ses équipes répondent normalement.
        assertEquals("applied", regieLea.commande(code, "resume"))
        attendreQue("reprise publiée") { licornes.etat(code).takeIf { it.child("paused").value == false } }
        Thread.sleep(3_500)
        assertTrue("Réponse refusée après le retour d'Internet", dragons.repondre(code, q.id, mauvaiseReponse(q)))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regieLea.commande(code, "next"))
        ecran.voit("Voir les scores")
        assertTrue(points(licornes, code, licornes.uid) >= Scoring.BASE)
        assertEquals(100L, points(licornes, code, dragons.uid))
        // La révélation chez Léa ne change rien chez Tom ni chez Inès.
        assertEquals(400L, points(licornesTom, tom.code, licornesTom.uid))
        assertEquals(0L, points(cometes, ines.code, cometes.uid))
        ecran.capture("trois-fetes-apres-coupure")
    }

    @Test
    fun boxDeLeaRelanceeEnPleineFeteRetrouveSaPartieEtJamaisUneAutre() {
        val code = lancerBoite()
        val licornes = pupitre("lea-licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("lea-dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val tom = fete("tom")
        val ines = fete("ines")
        val licornesTom = pupitre("tom-licornes").also { it.rejoindre(tom.code, "Licornes", VERT) }
        pupitre("tom-sirenes").rejoindre(tom.code, "Sirènes", ROSE)
        val cometes = pupitre("ines-cometes").also { it.rejoindre(ines.code, "Comètes", VERT) }
        pupitre("ines-pirates").rejoindre(ines.code, "Pirates", ROSE)
        val regieTom = regie()
        val regieInes = regie()
        assertEquals(
            listOf(true, true),
            enMemeTemps(
                { regieTom.connecter(tom.code, RegieSimulee.MOT_DE_PASSE) },
                { regieInes.connecter(ines.code, RegieSimulee.MOT_DE_PASSE) },
            ),
        )
        ecran.voit("Dragons")

        // Les trois fêtes à la même question au même moment ; Léa joue à la télécommande.
        ecran.ok("Lancer la fête !")
        assertEquals("applied", regieTom.commande(tom.code, "next"))
        assertEquals("applied", regieInes.commande(ines.code, "next"))
        val q = attendreQuestion(licornes, code, 0)
        assertTrue(licornesTom.repondre(tom.code, q.id, q.correct))
        assertTrue(cometes.repondre(ines.code, q.id, q.correct))
        assertTrue(licornes.repondre(code, q.id, q.correct))
        assertTrue(dragons.repondre(code, q.id, mauvaiseReponse(q)))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        val pointsLicornes = attendreQue("points des Licornes de Léa publiés") {
            points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE }
        }

        // La box de Léa redémarre en pleine fête (appli fermée, coupure de courant) ; Tom et Inès continuent.
        relancerBoite()
        assertEquals("applied", regieTom.commande(tom.code, "next"))
        assertEquals("applied", regieInes.commande(ines.code, "adjust", mapOf("team" to cometes.uid, "delta" to 50)))
        ecran.voit("Une partie est en cours", 30_000)
        ecran.voit("Code $code")
        ecran.voit("Dragons")
        val offre = ecran.textes()
        ecran.capture("reprise-chez-lea")
        ecran.ok("Reprendre la partie")
        assertTrue("Équipes de Léa absentes de la reprise : $offre", "Licornes" in offre)
        listOf("Sirènes", "Comètes", "Pirates", tom.code, ines.code).forEach {
            assertFalse("« $it » d'une autre fête proposé à la reprise chez Léa : $offre", it in offre)
        }

        // La partie de Léa, à la même étape, avec ses équipes et ses points.
        ecran.voit("Voir les scores")
        assertEquals(code, Boite.codeActif())
        assertEquals(pointsLicornes, points(licornes, code, licornes.uid))
        assertEquals(0L, points(licornes, code, dragons.uid))
        ecran.ok("Voir les scores")
        ecran.voit("Classement")
        ecran.voit("Licornes")
        ecran.voit("Dragons")
        jamaisSurLaTv(1_000, "Sirènes", "Comètes", "Pirates")
        ecran.capture("classement-lea-apres-reprise")

        // Les autres fêtes n'ont rien perdu, et la box de Léa ne leur a rien pris.
        assertEquals(tom.uid, Boite.controle.lire("games/${tom.code}/hostUid"))
        assertEquals(ines.uid, Boite.controle.lire("games/${ines.code}/hostUid"))
        assertEquals("closed", licornesTom.etat(tom.code).child("phase").value)
        assertEquals(50L, points(cometes, ines.code, cometes.uid))
        assertEquals("applied", regieTom.commande(tom.code, "next"))
        assertEquals(100L, points(licornesTom, tom.code, licornesTom.uid))
        ecran.voit("Classement")
    }

    /**
     * La mémoire de la box désigne la partie d'une autre fête (identifiant de la box perdu, sauvegarde restaurée…) :
     * la box n'a pas le droit de la lire, elle ne la propose pas et en crée une nouvelle ; l'autre fête continue.
     */
    @Test
    fun boxQuiSeSouvientDUneAutreFeteNeLaRejointJamais() {
        val tom = fete("tom")
        val licornesTom = pupitre("tom-licornes").also { it.rejoindre(tom.code, "Licornes", VERT) }
        val regieTom = regie()
        assertTrue(regieTom.connecter(tom.code, RegieSimulee.MOT_DE_PASSE))
        assertEquals("applied", regieTom.commande(tom.code, "next"))
        val etapeTom = regieTom.etape(tom.code)

        Boite.contexte.getSharedPreferences("partie", Context.MODE_PRIVATE).edit().putString("active_game", tom.code).commit()
        Boite.lancer()
        ecran.voit("Scannez pour jouer", 30_000)
        assertFalse("La box de Léa propose de reprendre la fête de Tom", ecran.affiche("Une partie est en cours"))
        val code = attendreQue("nouvelle partie de la box de Léa", 30_000) { Boite.codeActif()?.takeIf { it != tom.code } }
        assertEquals(FirebaseAuth.getInstance().currentUser?.uid, Boite.controle.lire("games/$code/hostUid"))
        ecran.voit("En attente des équipes")
        assertFalse(ecran.affiche("Licornes"))

        // La fête de Tom n'a pas bougé : même box, même étape, toujours en cours, et sa régie la pilote encore.
        assertEquals(tom.uid, Boite.controle.lire("games/${tom.code}/hostUid"))
        assertEquals(etapeTom, regieTom.etape(tom.code))
        assertEquals("question", licornesTom.etat(tom.code).child("phase").value)
        assertEquals("applied", regieTom.commande(tom.code, "next"))
        assertEquals("closed", licornesTom.etat(tom.code).child("phase").value)
    }

    /** Plusieurs téléphones au même moment, chacun sur son fil, comme des animatrices dans des salons différents. */
    private fun <T> enMemeTemps(vararg gestes: () -> T): List<T> {
        val fils = Executors.newFixedThreadPool(gestes.size)
        try {
            val suites = gestes.map { geste -> fils.submit(Callable<T> { geste() }) }
            return suites.map { it.get(90, TimeUnit.SECONDS) }
        } finally {
            fils.shutdownNow()
        }
    }

    /**
     * Pendant [ms], aucun de ces [textes] sur la TV de Léa : l'arbre Compose est relu toutes les 100 ms, pour ne pas
     * manquer une annonce BONUS de 2 s qui viendrait d'une autre fête.
     */
    private fun jamaisSurLaTv(ms: Long, vararg textes: String) {
        val fin = SystemClock.uptimeMillis() + ms
        while (SystemClock.uptimeMillis() < fin) {
            val visibles = runCatching { ecran.elements() }.getOrDefault(emptyList()).filter { it.visible }.map { it.texte }
            textes.firstOrNull { t -> visibles.any { t in it } }?.let { t ->
                ecran.capture("autre-fete")
                throw AssertionError("« $t » d'une autre fête est apparu sur la TV de Léa : ${visibles.joinToString(" | ")}")
            }
            Thread.sleep(100)
        }
    }
}

/**
 * Une autre fête au même moment, sur une autre box : sa propre connexion anonyme (comme une deuxième Mi Box dans un
 * autre salon), sa partie, ses équipes et sa régie. Elle tient sa partie comme l'appli TV, en plus simple : numéro
 * d'étape vérifié, refus en pause, pause et reprise avec décompte, corrections de score réservées à ses équipes,
 * points comptés à la révélation, et son état public publié pour ses tablettes, sous les mêmes règles Firebase.
 */
class FeteVoisine(etiquette: String, private val questions: List<Question>) : AutoCloseable {
    private val app = FirebaseApp.initializeApp(
        Boite.contexte, FirebaseApp.getInstance().options, "fete-$etiquette-${UUID.randomUUID()}",
    )
    private val auth = FirebaseAuth.getInstance(app)
    private val base = FirebaseDatabase.getInstance(app, GameViewModel.databaseUrl())

    // La partie tenue en mémoire, comme sur la box : modifiée seulement sur le fil des écouteurs Firebase.
    private var phase = "lobby"
    private var seq = 0
    private var index = -1
    private var enPause = false
    private var deadline: Long? = null
    private var resteMs: Long? = null
    private var resumeAt: Long? = null
    private val scores = mutableMapOf<String, Int>()
    private var equipes = emptySet<String>()
    private var reponses: DataSnapshot? = null
    private val traitees = mutableSetOf<String>()
    @Volatile private var decalage = 0L
    @Volatile private var fermee = false

    val uid: String
    val code: String
    private val partie: DatabaseReference

    init {
        Emulateur.brancher(auth, base)
        uid = bloquer { auth.signInAnonymously().await().user!!.uid }
        code = creerPartie()
        partie = base.getReference("games/$code")
        ecouter()
        Log.i(TAG, "Fête $etiquette : partie $code ouverte par la box $uid")
    }

    /** Comme la box : un code libre, puis la partie écrite à son nom (refusée par les règles si le code est pris). */
    private fun creerPartie(): String {
        repeat(8) {
            val essai = (1..5).map { CARACTERES.random() }.joinToString("")
            val ref = base.getReference("games/$essai")
            if (!bloquer { ref.child("hostUid").lireUneFois() }.exists()) {
                bloquer {
                    ref.setValue(mapOf("hostUid" to uid, "createdAt" to ServerValue.TIMESTAMP, "state" to etatPublic())).await()
                }
                return essai
            }
        }
        throw AssertionError("Aucun code de partie libre pour la fête voisine")
    }

    private fun ecouter() {
        base.getReference(".info/serverTimeOffset").addValueEventListener(lecteur { decalage = (it.value as? Number)?.toLong() ?: 0L })
        partie.child("teams").addValueEventListener(lecteur { s -> equipes = s.children.mapNotNull { it.key }.toSet() })
        partie.child("answers").addValueEventListener(lecteur { reponses = it })
        partie.child("commands").addChildEventListener(object : ChildEventListener {
            override fun onChildAdded(snapshot: DataSnapshot, previousChildName: String?) = appliquer(snapshot)
            override fun onChildChanged(snapshot: DataSnapshot, previousChildName: String?) = Unit
            override fun onChildRemoved(snapshot: DataSnapshot) = Unit
            override fun onChildMoved(snapshot: DataSnapshot, previousChildName: String?) = Unit
            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Fête $code : commandes illisibles (${error.message})")
            }
        })
    }

    private fun lecteur(suite: (DataSnapshot) -> Unit) = object : ValueEventListener {
        override fun onDataChange(snapshot: DataSnapshot) = suite(snapshot)
        override fun onCancelled(error: DatabaseError) {
            Log.e(TAG, "Fête $code : lecture refusée (${error.message})")
        }
    }

    /** Une commande de sa régie, traitée comme sur la box : une seule fois, et toujours un verdict. */
    private fun appliquer(commande: DataSnapshot) {
        val id = commande.key ?: return
        if (fermee || !traitees.add(id)) return
        val type = commande.child("type").getValue(String::class.java)
        val attendue = (commande.child("expectSeq").value as? Number)?.toInt()
        val maintenant = System.currentTimeMillis() + decalage
        val gardee = type == "next" || type == "close" || type == "end"
        val refus: String? = when {
            gardee && attendue != seq -> "stale"
            gardee && enPause && type != "end" -> "paused"
            type == "next" -> suivant(maintenant)
            type == "close" -> if (phase == "question") fermer() else "not_now"
            type == "pause" -> if (phase == "question" && !enPause) suspendre(maintenant) else "not_now"
            type == "resume" -> if (enPause) reprendre(maintenant) else "not_now"
            type == "adjust" -> corriger(
                commande.child("team").getValue(String::class.java),
                (commande.child("delta").value as? Number)?.toInt() ?: 0,
            )
            type == "end" -> terminer()
            else -> "unsupported"
        }
        val statut = when (refus) {
            null -> "applied"
            "stale" -> "stale"
            else -> "refused"
        }
        if (refus == null) seq++
        val maj = mutableMapOf<String, Any?>(
            "commandStatus/$id" to sansVides(
                mapOf("status" to statut, "reason" to refus, "seq" to (if (refus == null) seq else null), "at" to ServerValue.TIMESTAMP),
            ),
        )
        if (refus == null) maj["state"] = etatPublic()
        partie.updateChildren(maj).addOnFailureListener { Log.e(TAG, "Fête $code : verdict non écrit", it) }
    }

    private fun suivant(maintenant: Long): String? {
        when (phase) {
            "lobby" -> {
                if (equipes.isEmpty()) return "no_teams"
                ouvrir(0, maintenant)
            }
            "question" -> fermer()
            "closed" -> reveler()
            "reveal" -> phase = "scores"
            "scores" -> {
                if (index + 1 < questions.size) ouvrir(index + 1, maintenant) else terminer()
            }
            else -> return "not_now"
        }
        return null
    }

    private fun ouvrir(i: Int, maintenant: Long) {
        index = i
        phase = "question"
        enPause = false
        resteMs = null
        resumeAt = null
        deadline = maintenant + DUREE_MS
    }

    private fun fermer(): String? {
        phase = "closed"
        deadline = null
        return null
    }

    /** Points comptés seulement pour ses propres équipes, d'après les réponses reçues dans sa partie. */
    private fun reveler(): String? {
        val q = questions[index]
        reponses?.child(q.id)?.children?.forEach { r ->
            val equipe = r.key ?: return@forEach
            if (equipe in equipes && (r.child("choice").value as? Number)?.toInt() == q.correct) {
                scores[equipe] = (scores[equipe] ?: 0) + Scoring.BASE
            }
        }
        phase = "reveal"
        return null
    }

    private fun suspendre(maintenant: Long): String? {
        resteMs = ((deadline ?: maintenant) - maintenant).coerceAtLeast(0L)
        deadline = null
        resumeAt = null
        enPause = true
        return null
    }

    /** Reprise avec le décompte 3, 2, 1 : les réponses ne sont permises qu'à sa fin (resumeAt). */
    private fun reprendre(maintenant: Long): String? {
        val depart = maintenant + RESUME_COUNTDOWN_MS
        resumeAt = depart
        deadline = depart + (resteMs ?: DUREE_MS)
        resteMs = null
        enPause = false
        return null
    }

    private fun corriger(equipe: String?, delta: Int): String? {
        if (equipe == null || equipe !in equipes) return "unknown_team"
        if (delta == 0) return "bad_delta"
        scores[equipe] = (scores[equipe] ?: 0) + delta
        return null
    }

    private fun terminer(): String? {
        phase = "ended"
        deadline = null
        return null
    }

    /** Ce que lisent ses tablettes et sa régie : mêmes champs que l'état publié par la box. */
    private fun etatPublic(): Map<String, Any?> {
        val etat = mutableMapOf<String, Any?>(
            "phase" to phase, "seq" to seq, "total" to questions.size, "scores" to scores.toMap(), "round" to 1,
            "buzzOpen" to (phase == "lobby"), "paused" to enPause, "pauseReason" to (if (enPause) PAUSE_REGIE else null),
            "resumeAt" to resumeAt,
        )
        val q = questions.getOrNull(index)
        if (q != null && phase != "ended") {
            etat["index"] = index
            etat["qid"] = q.id
            etat["kind"] = q.kind.code
            etat["text"] = q.text
            etat["choices"] = q.choices
            etat["durationMs"] = DUREE_MS
            etat["deadline"] = deadline
            etat["remainingMs"] = resteMs
            if (phase == "reveal" || phase == "scores") etat["correct"] = q.correct
        }
        return sansVides(etat)
    }

    private fun sansVides(m: Map<String, Any?>): Map<String, Any?> = m.filterValues { it != null }

    // L'appli Firebase de la fête n'est pas supprimée : seulement déconnectée, comme les pupitres simulés.
    override fun close() {
        fermee = true
        runCatching { base.goOffline() }
    }

    companion object {
        const val CARACTERES = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

        /** Chrono long : la question d'une fête voisine reste ouverte pendant toute la scène. */
        const val DUREE_MS = 600_000L
    }
}
