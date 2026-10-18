package com.littlemissparty.quiz.tv.test

import android.util.Log
import androidx.test.core.app.ActivityScenario
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.MainActivity
import org.junit.Before
import org.junit.Rule
import org.junit.rules.TestName
import org.junit.rules.TestWatcher
import org.junit.runner.Description

/** Base commune : box neuve, captures d'écran, pupitres rangés après chaque test. */
abstract class TestTv {
    @get:Rule
    val nom = TestName()

    protected val ecran = Ecran { "${javaClass.simpleName}.${nom.methodName}" }
    protected val quiz = Boite.quizDemo()
    private val pupitres = mutableListOf<PupitreSimule>()
    private var scenario: ActivityScenario<MainActivity>? = null

    @get:Rule
    val rangement = object : TestWatcher() {
        override fun failed(e: Throwable?, description: Description?) {
            runCatching { ecran.capture("echec") }
            runCatching { Log.e(TAG, "ÉCHEC ${description?.methodName} — écran : ${ecran.textes()}") }
            runCatching { Log.e(TAG, "Fils de l'appli :\n${Boite.piles()}") }
        }

        override fun finished(description: Description?) {
            val debut = System.currentTimeMillis()
            runCatching { scenario?.close() }
            pupitres.forEach { it.close() }
            Log.i(TAG, "Rangement de ${description?.methodName} en ${System.currentTimeMillis() - debut} ms")
        }
    }

    @Before
    fun preparer() {
        Boite.oublierPartie()
        val debut = System.currentTimeMillis()
        Boite.verifierEmulateur()
        Log.i(TAG, "Émulateur Firebase vérifié en ${System.currentTimeMillis() - debut} ms")
    }

    /** Démarre l'appli comme sur une box neuve et renvoie le code de la partie créée. */
    protected fun lancerBoite(): String {
        scenario = Boite.lancer()
        val code = attendreQue("création de la partie", 30_000) { Boite.codeActif() }
        ecran.voit("Scannez pour jouer", 30_000)
        // La partie doit exister dans l'émulateur Firebase, sinon la box parlerait à une autre base.
        check(Boite.controle.lire("games/$code/hostUid") != null) { "La partie $code n'est pas dans l'émulateur Firebase" }
        return code
    }

    /** Ferme l'appli (comme le bouton Quitter ou un plantage) puis la relance. */
    protected fun relancerBoite() {
        scenario?.close()
        scenario = Boite.lancer()
    }

    protected fun pupitre(etiquette: String) = PupitreSimule(etiquette).also { pupitres += it }

    protected fun mauvaiseReponse(q: Question) = (q.correct + 1) % q.choices.size

    /** Attend que le serveur ait reçu l'ouverture de la question [index]. */
    protected fun attendreQuestion(lecteur: PupitreSimule, code: String, index: Int): Question {
        val q = quiz.questions[index]
        attendreQue("question ${index + 1} ouverte sur le serveur") {
            lecteur.etat(code).takeIf { it.child("phase").value == "question" && it.child("qid").value == q.id }
        }
        return q
    }

    protected fun points(lecteur: PupitreSimule, code: String, uid: String): Long =
        (lecteur.etat(code).child("scores/$uid").value as? Number)?.toLong() ?: 0L

    companion object {
        const val VERT = "#7CFF3A"
        const val ROSE = "#FF2D8A"
    }
}
