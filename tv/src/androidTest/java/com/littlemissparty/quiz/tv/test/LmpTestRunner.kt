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
