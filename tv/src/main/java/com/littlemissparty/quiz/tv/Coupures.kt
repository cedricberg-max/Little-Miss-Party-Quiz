package com.littlemissparty.quiz.tv

/**
 * Coupures des tablettes et du téléphone de la régie, pour les rapports de la box (cedric, 30/10 au soir : le bilan de
 * santé ne voyait les tablettes qu'une fois toutes les 5 min, une coupure courte entre deux bilans passait inaperçue).
 * La box suit chaque passage en ligne → hors ligne en direct ; [releve] résume les 5 dernières minutes en une ligne,
 * rien quand personne n'a décroché.
 */
internal class Coupures {
    private class Suivi(var enLigne: Boolean, var depuis: Long, var nombre: Int = 0, var pireMs: Long = 0)

    private val suivis = linkedMapOf<String, Suivi>()

    /** L'appareil [id] est vu en ligne ou non à [maintenant] (ms) ; seuls les changements comptent. */
    @Synchronized
    fun vu(id: String, enLigne: Boolean, maintenant: Long) {
        val s = suivis[id]
        if (s == null) {
            // Déjà hors ligne quand la box le découvre (box relancée pendant une coupure) : une coupure en cours.
            suivis[id] = Suivi(enLigne, maintenant, nombre = if (enLigne) 0 else 1)
            return
        }
        if (s.enLigne == enLigne) return
        if (!enLigne) s.nombre++ else ajouterDuree(s, maintenant - s.depuis)
        s.enLigne = enLigne
        s.depuis = maintenant
    }

    /**
     * Une ligne pour les rapports (« coupures 5 min : Les Licornes 2× (pire 14 s), régie 1× (3 s, encore coupée) »),
     * puis remise à zéro ; null si aucune coupure. [nom] donne le nom à afficher d'un identifiant.
     */
    @Synchronized
    fun releve(maintenant: Long, nom: (String) -> String): String? {
        val lignes = suivis.mapNotNull { (id, s) ->
            val enCours = if (!s.enLigne) maintenant - s.depuis else 0L
            if (s.nombre == 0 && enCours == 0L) return@mapNotNull null
            val pire = maxOf(s.pireMs, enCours)
            val details = listOfNotNull(
                if (s.nombre > 1) "pire ${secondes(pire)}" else secondes(pire),
                "encore coupée".takeIf { !s.enLigne },
            ).joinToString(", ")
            "${nom(id)} ${s.nombre}× ($details)"
        }
        suivis.values.forEach { s ->
            s.nombre = 0; s.pireMs = 0
            // Une coupure qui dure encore compte de nouveau dans le relevé suivant, avec toute sa durée.
            if (!s.enLigne) s.nombre = 1
        }
        return lignes.takeIf { it.isNotEmpty() }?.joinToString(", ", prefix = "coupures 5 min : ")
    }

    private fun ajouterDuree(s: Suivi, ms: Long) {
        if (ms > s.pireMs) s.pireMs = ms
    }

    private fun secondes(ms: Long) = if (ms < 60_000) "${(ms + 500) / 1000} s" else "${ms / 60_000} min ${(ms % 60_000) / 1000} s"
}
