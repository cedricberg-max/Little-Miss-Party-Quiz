package com.littlemissparty.quiz.tv

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Le téléchargement d'une mise à jour, sans rien d'Android (testé sur un faux serveur qui coupe et rame) : il reprend
 * toujours un fichier partiel là où il s'est arrêté (« Range »), recommence au début si le serveur ne sait pas
 * reprendre, et vérifie la taille avant de rendre le fichier complet.
 *
 * Cedric, 1/11 au soir : « je veux et j'exige que les mises à jour soient acceptées […] imagine ça fait ça chez les
 * clients ». La règle : tant que des octets arrivent, on n'abandonne jamais ([PatienceTelechargement]).
 */
internal object TelechargementApk {
    /** Taille des lectures, et pas de la progression à l'écran (le Wi-Fi faible voit la barre bouger dès 64 Ko). */
    const val BLOC = 64 * 1024

    /**
     * Télécharge [source] dans [cible] ([taille] octets), en reprenant [cible].part s'il existe. [ouvrir] crée la
     * connexion ; [progres] reçoit le total reçu ; [actif] lève une exception pour arrêter (annulation). Une coupure
     * lève une exception : la partie reçue reste dans le .part pour l'essai suivant ([dejaRecu] dit si ça a avancé).
     */
    fun reprendre(
        source: URL,
        cible: File,
        taille: Long,
        ouvrir: (URL) -> HttpURLConnection,
        progres: (Long) -> Unit = {},
        actif: () -> Unit = {},
    ) {
        if (cible.exists() && cible.length() == taille) return
        cible.delete()
        val part = File(cible.parentFile, "${cible.name}.part")
        var deja = if (part.exists() && part.length() <= taille) part.length() else 0L.also { part.delete() }
        val conn = ouvrir(source).apply { if (deja > 0) setRequestProperty("Range", "bytes=$deja-") }
        try {
            when (conn.responseCode) {
                206 -> Unit
                // Le serveur renvoie tout le fichier : on repart du début (jamais la fin collée au début).
                200 -> deja = 0
                // Le fichier est déjà entier (reprise demandée à la toute fin).
                416 -> if (part.length() == taille) deja = taille else error("HTTP 416")
                else -> error("HTTP ${conn.responseCode}")
            }
            if (deja < taille) FileOutputStream(part, deja > 0).use { out ->
                conn.inputStream.use { entree ->
                    val buf = ByteArray(BLOC)
                    var montre = 0L
                    while (true) {
                        actif()
                        val n = entree.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        deja += n
                        check(deja <= taille) { "Fichier plus gros qu'annoncé" }
                        if (deja - montre >= BLOC || deja == taille) {
                            montre = deja
                            progres(deja)
                        }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        check(part.length() == taille) { "Téléchargement incomplet" }
        check(part.renameTo(cible)) { "Fichier impossible à enregistrer" }
    }

    /**
     * Octets déjà reçus pour [cible] ([cible] entier ou sa partie .part), pour reprendre et pour l'écran.
     */
    fun dejaRecu(cible: File): Long = cible.takeIf { it.exists() }?.length() ?: File(cible.parentFile, "${cible.name}.part").length()
}

/**
 * Quand renoncer : jamais tant que le fichier avance. Un essai qui a fait avancer le fichier remet le compteur à zéro ;
 * on ne s'arrête qu'après [ESSAIS_SANS_AVANCER] essais d'affilée sans un seul octet (box vraiment sans Internet), et
 * même là, « Réessayer » reprend là où on en était.
 */
internal object PatienceTelechargement {
    const val ESSAIS_SANS_AVANCER = 12

    /** Pause avant le nouvel essai n° [essai] (essais sans avancer d'affilée) : 3 s, 6 s, 9 s… jusqu'à 30 s. */
    fun pause(essai: Int): Long = (3_000L * essai).coerceIn(3_000L, 30_000L)

    /** Le compteur d'essais sans avancer après un essai qui a coupé, selon que des octets sont arrivés ou non. */
    fun apresCoupure(essaisSansAvancer: Int, aAvance: Boolean): Int = if (aAvance) 0 else essaisSansAvancer + 1

    fun renoncer(essaisSansAvancer: Int): Boolean = essaisSansAvancer >= ESSAIS_SANS_AVANCER
}
