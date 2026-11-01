package com.littlemissparty.quiz.tv.test

import android.app.Application
import androidx.test.runner.AndroidJUnitRunner
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.Logger
import com.littlemissparty.quiz.tv.GameViewModel

/**
 * Lance les tests avec l'appli branchée sur l'émulateur Firebase de l'ordinateur hôte,
 * avant l'ouverture du premier écran : un test ne parle jamais à la vraie base.
 */
class LmpTestRunner : AndroidJUnitRunner() {
    override fun callApplicationOnCreate(app: Application) {
        super.callApplicationOnCreate(app)
        // Réglages des mises à jour (sources inconnues…) jamais accordés sur l'émulateur : pas de fenêtre au lancement.
        com.littlemissparty.quiz.tv.ReglagesMiseAJour.proposerAuLancement = false
        // L'appli de test doit déjà viser l'émulateur (workflow : -PlmpDatabaseUrl). Avec la vraie adresse,
        // useEmulator ne vaut que pour la première connexion : Firebase la range ensuite sous l'adresse de
        // l'émulateur, et la suivante (appli relancée, nouvelle partie) partirait vers la vraie base.
        check(GameViewModel.databaseUrl().startsWith("http://${Emulateur.HOTE}:${Emulateur.PORT_BASE}")) {
            "L'appli de test ne vise pas l'émulateur Firebase : ${GameViewModel.databaseUrl()}"
        }
        val db = FirebaseDatabase.getInstance(GameViewModel.databaseUrl())
        // Journal détaillé de Firebase dans le logcat, repris dans le journal du workflow.
        db.setLogLevel(Logger.Level.DEBUG)
        Emulateur.brancher(FirebaseAuth.getInstance(), db)
        // Comme sur la box : copie locale activée (l'appli le fait aussi, son appel devient sans effet).
        db.setPersistenceEnabled(true)
    }
}

object Emulateur {
    /** L'ordinateur hôte vu depuis l'émulateur Android. */
    const val HOTE = "10.0.2.2"
    const val PORT_BASE = 9000
    const val PORT_AUTH = 9099

    /** Partie fictive écrite par le workflow dans l'émulateur Firebase : absente de la vraie base. */
    const val MARQUEUR = "CIEMU"
    const val VALEUR_MARQUEUR = "emulateur-ci"

    fun brancher(auth: FirebaseAuth, db: FirebaseDatabase) {
        auth.useEmulator(HOTE, PORT_AUTH)
        db.useEmulator(HOTE, PORT_BASE)
    }
}
