package com.littlemissparty.quiz.tv

import android.util.Base64
import android.util.Log
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.Query
import com.google.firebase.database.ValueEventListener
import com.littlemissparty.quiz.engine.MediaAPrecharger
import com.littlemissparty.quiz.engine.Prechargement
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Préchargement des prestations du jour (cedric, 30/10, choix B) : tant que le robot dort à l'accueil et qu'aucune
 * prestation n'est chargée, la box lit dans la Régie PC (library/shows) les prestations prévues aujourd'hui (deux ou
 * trois : toutes) et copie d'avance leurs photos et leurs musiques dans son cache, une à une, dans l'ordre du
 * conducteur. Sarah n'a rien à faire. Au lancement, la partie trouve ces fichiers sur la box et ne les retélécharge pas.
 *
 * Les décisions (quelles prestations, quels éléments) sont dans [Prechargement], testées sans Android. Rien ne bloque
 * jamais : une lecture refusée (box pas encore acceptée, règles d'avant), un média absent ou Internet coupé, et la
 * box attend le passage suivant. Les fichiers neufs ne sont jamais effacés par le ménage avant 48 h.
 */
class Prechargeur(private val medias: MediasBox) {
    private var travail: Job? = null

    /** À l'accueil, sans prestation chargée : un passage tout de suite, puis toutes les 30 minutes (minuit compris). */
    fun accueil(scope: CoroutineScope, db: FirebaseDatabase) {
        if (travail?.isActive == true) return
        travail = scope.launch(Dispatchers.IO) {
            while (isActive) {
                try {
                    passage(db, LocalDate.now(PARIS).toString())
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Préchargement interrompu, nouvel essai au prochain passage", e)
                }
                delay(Prechargement.INTERVALLE_MS)
            }
        }
    }

    /** Une prestation est chargée, ou la fête a commencé : la box s'arrête et laisse le réseau à la partie. */
    fun arreter() {
        travail?.cancel()
        travail = null
    }

    private suspend fun passage(db: FirebaseDatabase, jour: String) {
        val shows = db.getReference("library/shows").orderByChild("date").equalTo(jour).lire(LECTURE_MS)?.value as? Map<*, *>
        val prestations = Prechargement.prestationsDuJour(shows, jour)
        if (prestations.isEmpty()) return
        val lus = mutableMapOf<String, Any?>()
        suspend fun element(chemin: String): Any? = if (chemin in lus) lus[chemin] else db.getReference(chemin).lire(LECTURE_MS)?.value.also { lus[chemin] = it }

        var copies = 0
        var deja = 0
        var manquants = 0
        val vus = mutableSetOf<String>()
        for (id in prestations) {
            // Jeu après jeu, dans l'ordre du conducteur : le début de la fête est prêt le premier.
            for (jeu in Prechargement.jeux(shows?.get(id) as? Map<*, *>)) {
                val r = Prechargement.references(mapOf("rounds" to listOf(jeu)))
                val listes = mutableListOf(r.medias)
                r.quiz.forEach { listes += Prechargement.medias(element("library/quizzes/$it")) }
                r.paquetsMimes.forEach { listes += Prechargement.medias(element("library/mimes/$it")) }
                r.playlists.forEach { listes += Prechargement.medias(element("library/playlists/$it")) }
                r.chansons.forEach { listes += Prechargement.medias(element("library/songs/$it")) }
                r.contenus.forEach { (type, choisis) ->
                    listes += Prechargement.imagesChoisies(element("library/contents/$type/images") as? Map<*, *>, choisis)
                }
                for (m in Prechargement.fusionner(listes)) {
                    if (!vus.add(m.id)) continue
                    when (copier(db, m)) {
                        Copie.FAITE -> copies++
                        Copie.DEJA -> deja++
                        Copie.ABSENTE -> manquants++
                    }
                }
                for (chanson in r.chansonsEntieres) {
                    if (!vus.add("e:$chanson")) continue
                    when (copierChanson(db, chanson)) {
                        Copie.FAITE -> copies++
                        Copie.DEJA -> deja++
                        Copie.ABSENTE -> manquants++
                    }
                }
            }
        }
        Log.i(TAG, "Préchargement du $jour : ${prestations.size} prestation(s), $copies copié(s), $deja déjà là, $manquants absent(s)")
    }

    private enum class Copie { FAITE, DEJA, ABSENTE }

    /** Un son (library/sounds) ou une photo (library/images) ; type inconnu : le son d'abord, puis la photo. */
    private suspend fun copier(db: FirebaseDatabase, m: MediaAPrecharger): Copie {
        val son = medias.extrait(m.id)
        val photo = medias.photo(m.id)
        if ((m.son != false && son.present()) || (m.son != true && photo.present())) return Copie.DEJA
        if (m.son != false && copierFichier(db, "library/sounds/${m.id}", m.id, son)) return Copie.FAITE
        if (m.son != true && copierFichier(db, "library/images/${m.id}", m.id, photo)) return Copie.FAITE
        return Copie.ABSENTE
    }

    /** Adresse data: lue dans la bibliothèque, vérifiée par son empreinte (l'identifiant), puis rangée sur la box. */
    private suspend fun copierFichier(db: FirebaseDatabase, chemin: String, id: String, cible: File): Boolean {
        val data = db.getReference(chemin).lire(TELECHARGEMENT_MS)?.getValue(String::class.java) ?: return false
        if (!Extraits.empreinteOk(id, data)) return false
        val octets = Base64.decode(data.substringAfter("base64,", ""), Base64.DEFAULT)
        if (octets.isEmpty()) return false
        return withContext(Dispatchers.IO) {
            cible.parentFile?.mkdirs()
            val part = File(cible.parentFile, "${cible.name}.part")
            part.writeBytes(octets)
            part.renameTo(cible).also { if (!it) part.delete() }
        }
    }

    /**
     * Statues : une chanson entière (library/entieres/<chanson>, en parts), rangée sous le même nom que celui que la
     * partie lui donnera ([cleChanson]) : la partie la trouve déjà là.
     */
    private suspend fun copierChanson(db: FirebaseDatabase, songId: String): Copie {
        val noeud = db.getReference("library/entieres/$songId")
        val n = (noeud.child("n").lire(LECTURE_MS)?.value as? Number)?.toInt()?.takeIf { it in 1..24 } ?: return Copie.ABSENTE
        val length = (noeud.child("length").lire(LECTURE_MS)?.value as? Number)?.toLong() ?: 0L
        val kbps = (noeud.child("kbps").lire(LECTURE_MS)?.value as? Number)?.toLong() ?: 0L
        val fichier = medias.extrait(cleChanson(songId, n, length, kbps))
        if (fichier.present()) return Copie.DEJA
        val part = File(medias.extraits, "${fichier.name}.part")
        withContext(Dispatchers.IO) { medias.extraits.mkdirs(); part.delete() }
        // Parts décodées au fil de l'eau (base64 recollé sur 4 caractères) : jamais toute la chanson en mémoire.
        var reste = ""
        for (i in 0 until n) {
            val data = noeud.child("p/$i").lire(TELECHARGEMENT_MS)?.getValue(String::class.java)
                ?: return Copie.ABSENTE.also { withContext(Dispatchers.IO) { part.delete() } }
            val tout = reste + data
            val utile = tout.length - tout.length % 4
            val octets = Base64.decode(tout.substring(0, utile), Base64.DEFAULT)
            reste = tout.substring(utile)
            withContext(Dispatchers.IO) { part.appendBytes(octets) }
        }
        return withContext(Dispatchers.IO) {
            if (reste.isNotEmpty() || part.length() == 0L || !part.renameTo(fichier)) { part.delete(); Copie.ABSENTE } else Copie.FAITE
        }
    }

    private fun File.present() = isFile && length() > 0

    companion object {
        private const val TAG = "Prechargement"
        /** Les dates des prestations sont celles de la Régie PC, en France. */
        private val PARIS: ZoneId = ZoneId.of("Europe/Paris")
        private const val LECTURE_MS = 20_000L
        /** Un extrait ou une part de chanson (moins d'1 Mo) : laissé longtemps à un wifi faible. */
        private const val TELECHARGEMENT_MS = 120_000L

        /** Nom d'une chanson entière dans le cache : sa taille et son débit y sont, une chanson redéposée est recopiée. */
        fun cleChanson(songId: String, n: Int, length: Long, kbps: Long) = "e_${songId}_${n}_${length}_$kbps"
    }
}

/**
 * Lecture unique, à la façon de la box : écoute une fois (avec la persistance locale, `get()` peut ne jamais se
 * terminer), null au-delà de [timeoutMs]. Une lecture refusée par les règles lève une erreur.
 */
private suspend fun Query.lire(timeoutMs: Long): DataSnapshot? = withTimeoutOrNull(timeoutMs) {
    suspendCancellableCoroutine { cont ->
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (cont.isActive) cont.resume(snapshot)
            }

            override fun onCancelled(error: DatabaseError) {
                if (cont.isActive) cont.resumeWithException(error.toException())
            }
        }
        addListenerForSingleValueEvent(listener)
        cont.invokeOnCancellation { removeEventListener(listener) }
    }
}
