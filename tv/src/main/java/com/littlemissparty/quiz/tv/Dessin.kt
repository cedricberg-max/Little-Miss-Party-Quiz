package com.littlemissparty.quiz.tv

/*
 * Pictionary : le dessin de la tablette, tel que la TV le reçoit dans games/<code>/drawing/<clé du tour>.
 * Chaque paquet est { c: "#RRGGBB" ou "paper" (gomme), w: 1 à 3, p: "x,y x,y …" } ou { clear: true } ;
 * coordonnées de 0 à 1000 sur une feuille 4:3 (la même que celle du pupitre, voir web/public/picto.js).
 * Fonctions pures, sans Android : testées sur la JVM.
 */

/** Un morceau de trait : sa couleur (ARGB, null pour la gomme), son épaisseur (1 à 3) et ses points (0 à 1000). */
data class Trait(val couleur: Long?, val epaisseur: Int, val points: List<Pair<Int, Int>>)

/** Le dessin du tour [cle] : ses traits dans l'ordre d'arrivée ; [effacements] compte les « Tout effacer ». */
data class Dessin(val cle: String? = null, val traits: List<Trait> = emptyList(), val effacements: Int = 0) {

    /** Le dessin après un paquet reçu de la tablette ; un paquet illisible est ignoré (jamais de plantage). */
    fun avec(paquet: Map<*, *>): Dessin {
        if (paquet["clear"] == true) return copy(traits = emptyList(), effacements = effacements + 1)
        val trait = lireTrait(paquet) ?: return this
        // Garde-fou pour la box : au-delà, les plus anciens morceaux disparaissent (un dessin d'enfant n'y arrive pas).
        return copy(traits = (traits + trait).takeLast(MAX_TRAITS))
    }

    companion object {
        const val MAX_TRAITS = 4_000
        private const val CHIFFRES_CLE = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"

        /**
         * Heure d'envoi d'un paquet, lue dans sa clé : les 8 premiers caractères d'une clé de push Firebase sont l'heure
         * du serveur (estimée par la tablette) en millisecondes. Null si la clé n'en est pas une.
         */
        fun heureDeCle(cle: String?): Long? {
            if (cle == null || cle.length < 8) return null
            var t = 0L
            for (c in cle.substring(0, 8)) {
                val v = CHIFFRES_CLE.indexOf(c)
                if (v < 0) return null
                t = t * 64 + v
            }
            return t
        }
        private val POINT = Regex("^(\\d{1,4}),(\\d{1,4})$")
        private val COULEUR = Regex("^#([0-9A-Fa-f]{6})$")

        fun lireTrait(paquet: Map<*, *>): Trait? {
            val p = paquet["p"] as? String ?: return null
            val c = paquet["c"] as? String ?: return null
            val w = (paquet["w"] as? Number)?.toInt()?.takeIf { it in 1..3 } ?: return null
            val couleur = if (c == "paper") null else COULEUR.find(c)?.groupValues?.get(1)?.toLong(16)?.let { 0xFF000000L or it } ?: return null
            val points = p.split(' ').mapNotNull { POINT.find(it) }.map { m ->
                m.groupValues[1].toInt().coerceIn(0, 1000) to m.groupValues[2].toInt().coerceIn(0, 1000)
            }
            if (points.isEmpty()) return null
            return Trait(couleur, w, points)
        }
    }
}
