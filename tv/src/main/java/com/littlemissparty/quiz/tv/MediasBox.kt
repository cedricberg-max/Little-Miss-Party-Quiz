package com.littlemissparty.quiz.tv

import android.os.StatFs
import com.littlemissparty.quiz.engine.CacheMedias
import com.littlemissparty.quiz.engine.FichierMedia
import com.littlemissparty.quiz.engine.Phase
import java.io.File

/** Fichiers effacés du cache des médias et place libérée. */
data class Effacement(val fichiers: Int, val octets: Long) {
    operator fun plus(autre: Effacement) = Effacement(fichiers + autre.fichiers, octets + autre.octets)
}

/**
 * Médias gardés sur la box, tous retéléchargeables depuis la partie : extraits musicaux (filesDir/extraits/<id>.mp3)
 * et photos (filesDir/photos/<id>). Seuls ces deux dossiers sont touchés ici : jamais les réglages de la box
 * (préférences « partie »), la connexion Firebase ni sa copie locale. La date d'un fichier est sa dernière
 * utilisation par une fête (un fichier neuf est daté de son téléchargement) : le ménage part des plus anciens.
 * Fonctions bloquantes : à appeler hors du fil principal (Dispatchers.IO).
 */
class MediasBox(private val racine: File) {
    val extraits = File(racine, "extraits")
    val photos = File(racine, "photos")

    fun extrait(id: String) = File(extraits, "$id.mp3")
    fun photo(id: String) = File(photos, id)

    /** Une fête vient d'utiliser [f] : il devient le plus récent du cache, le dernier effacé. */
    fun toucher(f: File) {
        runCatching { f.setLastModified(System.currentTimeMillis()) }
    }

    /**
     * Ménage décidé par [CacheMedias.menage]. [sons] et [images] : identifiants des médias de la partie ouverte et des
     * téléchargements en cours, marqués comme utilisés maintenant et jamais effacés. Un fichier utilisé pendant le
     * ménage (sa date a changé depuis la lecture du dossier) est gardé.
     */
    fun ranger(sons: Set<String>, images: Set<String>): Effacement {
        sons.forEach { id -> extrait(id).takeIf { it.isFile }?.let { toucher(it) } }
        images.forEach { id -> photo(id).takeIf { it.isFile }?.let { toucher(it) } }
        val musiques = lister(extraits)
        val photosBox = lister(photos)
        // Place libre illisible : on s'en tient aux limites.
        val libre = runCatching { StatFs(racine.path).availableBytes }.getOrDefault(Long.MAX_VALUE)
        val plan = CacheMedias.menage(musiques, photosBox, proteges(sons, images), libre, System.currentTimeMillis())
        return effacer(extraits, plan.musiques, musiques) + effacer(photos, plan.photos, photosBox)
    }

    /**
     * « Vider le cache des médias » : tous les extraits et toutes les photos, sauf les téléchargements en cours
     * ([sonsEnCours], [imagesEnCours]), qui se terminent normalement.
     */
    fun vider(sonsEnCours: Set<String>, imagesEnCours: Set<String>): Effacement {
        val gardes = proteges(sonsEnCours, imagesEnCours)
        return listOf(extraits, photos).fold(Effacement(0, 0)) { total, dossier ->
            val tous = lister(dossier)
            total + effacer(dossier, tous.map { it.nom }.filter { it !in gardes }, tous)
        }
    }

    /** Noms de fichier des médias [sons] et [images], copie provisoire (téléchargement en cours) comprise. */
    private fun proteges(sons: Set<String>, images: Set<String>): Set<String> =
        sons.flatMap { listOf("$it.mp3", "$it.part") }.toSet() + images.flatMap { listOf(it, "$it.part") }

    private fun lister(dossier: File): List<FichierMedia> =
        dossier.listFiles()?.filter { it.isFile }?.map { FichierMedia(it.name, it.length(), it.lastModified()) }.orEmpty()

    /** Efface [noms] de [dossier], sauf un fichier utilisé depuis qu'il a été lu ([vus]). */
    private fun effacer(dossier: File, noms: List<String>, vus: List<FichierMedia>): Effacement {
        val dates = vus.associate { it.nom to it.utiliseA }
        var fichiers = 0
        var octets = 0L
        for (nom in noms) {
            val f = File(dossier, nom)
            if (!f.isFile || f.lastModified() != dates[nom]) continue
            val taille = f.length()
            if (f.delete()) {
                fichiers++
                octets += taille
            }
        }
        return Effacement(fichiers, octets)
    }
}

/** « Vider le cache des médias » (menu Retour) : où en est la dernière demande. */
sealed interface VidageCache {
    data object Pret : VidageCache
    data object EnCours : VidageCache
    data class Fait(val effacement: Effacement) : VidageCache
    data class Refuse(val raison: String) : VidageCache
    data object Echec : VidageCache
}

/**
 * Pourquoi le cache des médias ne peut pas être vidé maintenant, ou null si c'est possible : seulement quand aucune
 * musique ne peut jouer (salon d'attente, classement, fin de partie), et avec Internet pour que tout revienne.
 */
fun vidageImpossible(s: UiState.Playing): String? = when {
    s.intro || (s.phase != Phase.LOBBY && s.phase != Phase.SCORES && s.phase != Phase.ENDED) ->
        "Possible entre deux questions : au salon d'attente, au classement ou à la fin de la partie."
    !s.connected ->
        "La box n'a pas Internet : les musiques et les photos ne pourraient pas revenir. Réessayez quand la connexion est revenue."
    else -> null
}
