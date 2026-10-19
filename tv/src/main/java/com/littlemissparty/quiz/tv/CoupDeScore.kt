package com.littlemissparty.quiz.tv

/**
 * Points ajoutés ou retirés à la main depuis la régie, déjà comptés par le moteur : la TV les montre en
 * BONUS ou en MALUS. [id] : numéro de l'événement ScoreAdjusted ; [delta] : les points exacts de la
 * correction ; [avant]/[apres] : total de l'équipe avant et après. L'animation ne calcule jamais un score.
 */
data class CoupDeScore(
    val id: Int,
    val equipe: String,
    val nom: String,
    val couleur: String,
    val delta: Int,
    val avant: Int,
    val apres: Int,
) {
    val bonus: Boolean get() = delta > 0
}

/**
 * File des coups à montrer, un à la fois pour rester lisibles : chaque validation de la régie a sa propre
 * animation, dans l'ordre, jamais deux fois. Celle qui est à l'écran n'est jamais modifiée.
 */
class FileDesCoups(private val max: Int = 6) {
    private val attente = ArrayDeque<CoupDeScore>()
    private val vus = mutableSetOf<Int>()
    var courant: CoupDeScore? = null
        private set

    /** Ajoute un coup (un id déjà vu est ignoré) ; rend le coup à montrer maintenant. */
    fun ajouter(c: CoupDeScore): CoupDeScore? {
        if (!vus.add(c.id)) return courant
        attente.addLast(c)
        // Une avalanche de corrections : on garde les dernières, le score réel est déjà juste.
        while (attente.size > max) attente.removeFirst()
        if (courant == null) courant = attente.removeFirstOrNull()
        return courant
    }

    /** Le coup [id] a fini de s'afficher ; rend le suivant (ou null). Un id périmé ne change rien. */
    fun fini(id: Int): CoupDeScore? {
        if (courant?.id != id) return courant
        courant = attente.removeFirstOrNull()
        return courant
    }

    fun vider() {
        attente.clear()
        vus.clear()
        courant = null
    }
}
