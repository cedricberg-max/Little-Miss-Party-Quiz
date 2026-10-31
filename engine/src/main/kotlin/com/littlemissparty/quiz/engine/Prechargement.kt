package com.littlemissparty.quiz.engine

/*
 * Préchargement des prestations du jour (cedric, 30/10, choix B) : pendant que le robot dort à l'accueil, la box regarde
 * seule dans la Régie PC (library/shows) les prestations prévues aujourd'hui et copie d'avance leurs photos et leurs
 * musiques dans son cache, sans aucun geste de Sarah. Au lancement, la partie les trouve déjà sur la box.
 *
 * Ici, seulement la décision, sur les données telles que Firebase les rend (Map, List, String, nombres) : quelles
 * prestations, et quels éléments de la bibliothèque lire ensuite, dans l'ordre du conducteur. Les tirages au 🎲 faits
 * au lancement (banque de photos, chansons tirées) ne sont pas connus d'avance : la partie les charge comme avant.
 */

/** Un média de la bibliothèque : [id] son empreinte, [son] vrai (library/sounds), faux (library/images), null : à essayer. */
data class MediaAPrecharger(val id: String, val son: Boolean?)

/**
 * Ce qu'une prestation désigne dans la bibliothèque, chaque liste sans doublon et dans l'ordre du conducteur :
 * quiz (library/quizzes), paquets de mimes (library/mimes), playlists (library/playlists), chansons (library/songs),
 * chansons entières des statues (library/entieres), images choisies des jeux intégrés (type → éléments choisis,
 * lues dans library/contents/<type>/images) et médias déjà écrits dans la prestation.
 */
data class ReferencesPrestation(
    val quiz: List<String>,
    val paquetsMimes: List<String>,
    val playlists: List<String>,
    val chansons: List<String>,
    val chansonsEntieres: List<String>,
    val contenus: List<Pair<String, List<String>>>,
    val medias: List<MediaAPrecharger>,
)

object Prechargement {
    /** La box regarde de nouveau toutes les 30 minutes tant qu'elle est à l'accueil (prestation ajoutée, minuit passé). */
    const val INTERVALLE_MS = 30L * 60 * 1000

    private val EMPREINTE = Regex("^[0-9a-f]{16}$")
    private val ID = Regex("^[-\\w]{1,40}$")

    /** Clés dont les empreintes sont des sons (« tracks » : extraits choisis un par un), et celles des photos. */
    private fun estSon(cle: String) =
        cle.contains("audio", ignoreCase = true) || cle.contains("refrain", ignoreCase = true) || cle == "tracks"
    private fun estPhoto(cle: String) = cle.contains("image", ignoreCase = true) || cle.contains("photo", ignoreCase = true)

    /**
     * Prestations prévues le [jour] (« 2026-12-02 ») : toutes celles de ce jour-là (deux ou trois : la box les charge
     * toutes, cedric 30/10), sauf les archivées, rangées par identifiant pour un ordre stable.
     */
    fun prestationsDuJour(shows: Map<*, *>?, jour: String): List<String> =
        shows.orEmpty().entries
            .filter { (_, s) -> s is Map<*, *> && s["date"] == jour && s["status"] != "archivee" }
            .map { it.key.toString() }
            .sorted()

    /** Les jeux d'une prestation dans l'ordre du conducteur (Firebase rend une liste, ou un objet à clés numériques). */
    fun jeux(show: Map<*, *>?): List<Map<*, *>> = enListe(show?.get("rounds")).filterIsInstance<Map<*, *>>()

    /** Tout ce qu'une prestation désigne dans la bibliothèque, jeu après jeu. */
    fun references(show: Map<*, *>?): ReferencesPrestation {
        val quiz = LinkedHashSet<String>()
        val mimes = LinkedHashSet<String>()
        val playlists = LinkedHashSet<String>()
        val chansons = LinkedHashSet<String>()
        val entieres = LinkedHashSet<String>()
        val contenus = mutableListOf<Pair<String, List<String>>>()
        val medias = LinkedHashMap<String, MediaAPrecharger>()
        for (jeu in jeux(show)) {
            val type = jeu["type"] as? String ?: "quiz"
            parcourir(jeu, null) { cle, valeur ->
                when (cle) {
                    "quizId", "quizIds" -> ajouterId(quiz, valeur)
                    "deckId" -> ajouterId(mimes, valeur)
                    "playlistId" -> ajouterId(playlists, valeur)
                    "chansons", "ordreBlind" -> {
                        ajouterId(chansons, valeur)
                        if (type == "statues") ajouterId(entieres, valeur)
                    }
                }
                ajouterMedia(medias, cle, valeur)
            }
            val choisis = enListe(jeu["picks"]).filterIsInstance<String>().filter { it.isNotBlank() }.map { it.lowercase() }.distinct()
            if (choisis.isNotEmpty()) contenus += type to choisis
        }
        return ReferencesPrestation(quiz.toList(), mimes.toList(), playlists.toList(), chansons.toList(), entieres.toList(), contenus, medias.values.toList())
    }

    /** Médias d'un élément lu dans la bibliothèque (quiz, paquet de mimes, playlist, chanson), dans leur ordre. */
    fun medias(element: Any?): List<MediaAPrecharger> {
        val medias = LinkedHashMap<String, MediaAPrecharger>()
        parcourir(element, null) { cle, valeur -> ajouterMedia(medias, cle, valeur) }
        return medias.values.toList()
    }

    /**
     * Images choisies à la main pour les éléments d'un jeu intégré (Qui suis-je ?…) : library/contents/<type>/images
     * range chaque image sous la clé de son élément (en minuscules, sans . # $ [ ] /). Seulement les éléments [choisis].
     */
    fun imagesChoisies(images: Map<*, *>?, choisis: List<String>): List<MediaAPrecharger> {
        val parCle = images.orEmpty().entries.associate { (k, v) -> k.toString().lowercase() to v }
        return choisis.map { emplacement(it) }.distinct()
            .mapNotNull { parCle[it] as? String }
            .filter { EMPREINTE.matches(it) }
            .distinct()
            .map { MediaAPrecharger(it, false) }
    }

    /** Clé d'un élément dans la base, comme la Régie PC l'écrit (contentSlot de show.js). */
    fun emplacement(cle: String) = cle.replace(Regex("[.#$\\[\\]/]"), "_").take(80)

    /**
     * Tous les médias à copier, sans doublon, dans l'ordre : ceux déjà rangés pour une prestation d'abord, puis les
     * suivants. Une empreinte vue une fois comme son ou comme photo garde ce type.
     */
    fun fusionner(listes: List<List<MediaAPrecharger>>): List<MediaAPrecharger> {
        val tous = LinkedHashMap<String, MediaAPrecharger>()
        for (m in listes.flatten()) {
            val avant = tous[m.id]
            if (avant == null || (avant.son == null && m.son != null)) tous[m.id] = avant?.copy(son = m.son) ?: m
        }
        return tous.values.toList()
    }

    private fun ajouterId(cible: MutableSet<String>, valeur: Any?) {
        when (valeur) {
            is String -> if (ID.matches(valeur) && !EMPREINTE.matches(valeur)) cible += valeur
            is List<*>, is Map<*, *> -> enListe(valeur).forEach { ajouterId(cible, it) }
        }
    }

    private fun ajouterMedia(medias: MutableMap<String, MediaAPrecharger>, cle: String?, valeur: Any?) {
        if (valeur !is String || !EMPREINTE.matches(valeur)) return
        val son = when {
            cle == null -> null
            estSon(cle) -> true
            estPhoto(cle) -> false
            else -> null
        }
        val avant = medias[valeur]
        if (avant == null || (avant.son == null && son != null)) medias[valeur] = MediaAPrecharger(valeur, son)
    }

    /**
     * Visite chaque valeur de l'arbre avec la clé la plus proche qui la nomme : dans une liste, la clé de la liste
     * (« audioIds » : chacun de ses éléments est un son). Les nombres d'une liste ne portent pas de nom.
     */
    private fun parcourir(noeud: Any?, cle: String?, visite: (String?, Any?) -> Unit) {
        visite(cle, noeud)
        when (noeud) {
            is Map<*, *> -> noeud.forEach { (k, v) ->
                val nom = k.toString()
                parcourir(v, if (nom.toIntOrNull() != null) cle else nom, visite)
            }
            is List<*> -> noeud.forEach { parcourir(it, cle, visite) }
        }
    }

    /** Liste Firebase : une vraie liste, ou un objet à clés numériques rangé dans l'ordre de ses clés. */
    private fun enListe(x: Any?): List<Any?> = when (x) {
        is List<*> -> x.filterNotNull()
        is Map<*, *> -> x.entries.sortedWith(compareBy({ it.key.toString().toIntOrNull() ?: Int.MAX_VALUE }, { it.key.toString() })).mapNotNull { it.value }
        else -> emptyList()
    }
}
