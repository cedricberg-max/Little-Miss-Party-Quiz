package com.littlemissparty.quiz.engine

/*
 * Cache des médias de la box : extraits musicaux (filesDir/extraits) et photos (filesDir/photos), copiés depuis les
 * parties et gardés d'une fête à l'autre. Tout y est retéléchargeable (≈ 1 Mo par chanson) : ce qui compte, c'est
 * que la box reste fluide avec assez de place libre, sans jamais perdre un média dont la fête en cours a besoin.
 * La box liste ses fichiers, demande ici lesquels effacer, puis les efface : toute la décision est ici, testée.
 */

/** Un fichier du cache : [nom] dans son dossier, [taille] en octets, [utiliseA] dernière utilisation (heure de la box, ms). */
data class FichierMedia(val nom: String, val taille: Long, val utiliseA: Long)

/** Les fichiers à effacer de chaque dossier, du moins récemment utilisé au plus récent. */
data class MenageMedias(val musiques: List<String>, val photos: List<String>) {
    val vide: Boolean get() = musiques.isEmpty() && photos.isEmpty()
}

object CacheMedias {
    /**
     * Place des musiques : ≈ 300 chansons (extrait de 30 s + refrain de 90 s ≈ 1 Mo chacune), toute la bibliothèque
     * (250 chansons au plus) et de la marge, soit ≈ 6 % des 5 Go libres d'une Mi Box S neuve.
     */
    const val BUDGET_MUSIQUES_OCTETS = 300L * 1024 * 1024

    /** Photos gardées au plus (≈ 50 Ko chacune, ≈ 30 Mo en tout). */
    const val PHOTOS_MAX = 600

    /**
     * Place toujours laissée libre sur la box : ≈ 2 fois le seuil « mémoire faible » d'Android, de quoi installer une
     * mise à jour de l'appli et laisser grandir les caches de Spotify et KaraFun. En dessous, le ménage va plus loin
     * que les limites (musiques d'abord, puis photos).
     */
    const val RESERVE_LIBRE_OCTETS = 1024L * 1024 * 1024

    /** Média inutilisé depuis 180 jours (chanson réglée autrement, remplacée ou retirée) : effacé, même sous les limites. */
    const val OUBLI_MS = 180L * 24 * 60 * 60 * 1000

    /** Média utilisé depuis moins de 48 h (fête en cours, fête de la veille) : jamais effacé. */
    const val RECENT_MS = 48L * 60 * 60 * 1000

    /** Copie interrompue (box éteinte en plein téléchargement) : fichier provisoire, sans suite une fois vieux de 48 h. */
    private const val PROVISOIRE = ".part"

    /**
     * Fichiers à effacer, le moins récemment utilisé d'abord : oubliés depuis [OUBLI_MS] et copies interrompues,
     * puis les musiques au-delà de [BUDGET_MUSIQUES_OCTETS] et les photos au-delà de [PHOTOS_MAX], puis encore des
     * musiques et des photos tant que la place libre ([libre] octets) reste sous [RESERVE_LIBRE_OCTETS].
     * Jamais effacés, même s'il faut rester au-dessus des limites : les noms [proteges] (médias de la partie ouverte,
     * téléchargements en cours) et les fichiers utilisés depuis moins de [RECENT_MS] (ou datés du futur : heure de la
     * box changée).
     */
    fun menage(
        musiques: List<FichierMedia>,
        photos: List<FichierMedia>,
        proteges: Set<String>,
        libre: Long,
        maintenant: Long,
    ): MenageMedias {
        fun garde(f: FichierMedia) = f.nom in proteges || maintenant - f.utiliseA < RECENT_MS
        val lru = compareBy<FichierMedia>({ it.utiliseA }, { it.nom })
        val m = musiques.sortedWith(lru)
        val p = photos.sortedWith(lru)
        val effaceM = LinkedHashSet<FichierMedia>()
        val effaceP = LinkedHashSet<FichierMedia>()
        fun taille(f: FichierMedia) = f.taille.coerceAtLeast(0)

        // 1. Oubliés depuis longtemps, copies interrompues.
        for ((liste, efface) in listOf(m to effaceM, p to effaceP)) {
            liste.filterTo(efface) { !garde(it) && (maintenant - it.utiliseA >= OUBLI_MS || it.nom.endsWith(PROVISOIRE)) }
        }

        // 2. Musiques au-delà du budget (les protégées comptent, mais restent).
        var musique = m.sumOf(::taille) - effaceM.sumOf(::taille)
        for (f in m) {
            if (musique <= BUDGET_MUSIQUES_OCTETS) break
            if (f !in effaceM && !garde(f)) { effaceM += f; musique -= taille(f) }
        }

        // 3. Photos au-delà du plafond.
        var nbPhotos = p.size - effaceP.size
        for (f in p) {
            if (nbPhotos <= PHOTOS_MAX) break
            if (f !in effaceP && !garde(f)) { effaceP += f; nbPhotos-- }
        }

        // 4. Réserve de place libre : musiques d'abord (les plus grosses), puis photos.
        var manque = RESERVE_LIBRE_OCTETS - libre.coerceIn(0, RESERVE_LIBRE_OCTETS) - (effaceM + effaceP).sumOf(::taille)
        for ((liste, efface) in listOf(m to effaceM, p to effaceP)) {
            for (f in liste) {
                if (manque <= 0) break
                if (f !in efface && !garde(f)) { efface += f; manque -= taille(f) }
            }
        }

        return MenageMedias(m.filter { it in effaceM }.map { it.nom }, p.filter { it in effaceP }.map { it.nom })
    }
}
