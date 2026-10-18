package com.littlemissparty.quiz.tv

import android.content.Context
import android.os.Build
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import java.io.File

/**
 * Rapports de plantage sans service tiers : la trace est écrite sur la box au moment du plantage,
 * puis envoyée dans `reports/` au démarrage suivant. Personne ne peut les relire depuis l'appli ;
 * le workflow GitHub « Rapports » les extrait pour le développement.
 */
object CrashReporter {
    private const val FILE = "crash.txt"

    fun install(context: Context) {
        val file = File(context.filesDir, FILE)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { file.writeText(error.stackTraceToString().take(19_000)) }
            previous?.uncaughtException(thread, error)
        }
    }

    /** Envoie le rapport en attente ; il n'est effacé de la box qu'une fois reçu par le serveur. */
    fun upload(context: Context, db: FirebaseDatabase) {
        val file = File(context.filesDir, FILE)
        if (!file.exists()) return
        val text = runCatching { file.readText() }.getOrNull() ?: return
        report(db, "crash", text).addOnSuccessListener { file.delete() }
    }

    fun report(db: FirebaseDatabase, kind: String, text: String) =
        db.getReference("reports").push().setValue(
            mapOf(
                "kind" to kind,
                "text" to text.take(19_000),
                "version" to BuildConfig.VERSION_NAME,
                "device" to "${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})",
                "at" to ServerValue.TIMESTAMP,
            )
        )
}
