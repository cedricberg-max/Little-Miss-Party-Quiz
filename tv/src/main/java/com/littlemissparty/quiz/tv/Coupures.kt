package com.littlemissparty.quiz.tv

/**
 * Coupures des tablettes et du téléphone de la régie, pour les rapports de la box (cedric, 30/10 au soir : le bilan de
 * santé ne voyait les tablettes qu'une fois toutes les 5 min, une coupure courte entre deux bilans passait inaperçue).
 * La box suit chaque passage en ligne → hors ligne en direct ; [releve] résume les 5 dernières minutes en une ligne,
 * rien quand personne n'a décroché.
 */
internal class Coupures {
    private class Suivi(var enLigne: Boolean, var depuis: Long, var nombre: Int = 0, var pireMs: Long = 0) {
        /** Dernier état de la page vu en ligne : cachée (appli quittée, écran éteint), affichée, ou null (non signalé). */
        var cachee: Boolean? = null
        /** Pour chaque coupure du relevé : « page cachée » ou « réseau ». */
        val causes = mutableListOf<String>()
    }

    private val suivis = linkedMapOf<String, Suivi>()

    /**
     * L'appareil [id] est vu en ligne ou non à [maintenant] (ms) ; seuls les changements comptent. [cachee] : la page dit
     * être passée en arrière-plan (téléphone de la régie, cedric 31/10 : savoir si une coupure vient de l'appli quittée
     * ou de l'écran éteint, ou bien du réseau). Une coupure qui suit une page cachée est notée « page cachée ».
     */
    @Synchronized
    fun vu(id: String, enLigne: Boolean, maintenant: Long, cachee: Boolean? = null) {
        val s = suivis[id]
        if (s == null) {
            // Déjà hors ligne quand la box le découvre (box relancée pendant une coupure) : une coupure en cours.
            suivis[id] = Suivi(enLigne, maintenant, nombre = if (enLigne) 0 else 1).also { if (enLigne) it.cachee = cachee }
            return
        }
        if (enLigne) s.cachee = cachee
        if (s.enLigne == enLigne) return
        if (!enLigne) {
            s.nombre++
            when (s.cachee) {
                true -> s.causes += CAUSE_PAGE_CACHEE
                false -> s.causes += CAUSE_RESEAU
                null -> Unit
            }
        } else ajouterDuree(s, maintenant - s.depuis)
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
                s.causes.distinct().takeIf { it.isNotEmpty() }?.joinToString(" / "),
                "encore coupée".takeIf { !s.enLigne },
            ).joinToString(", ")
            "${nom(id)} ${s.nombre}× ($details)"
        }
        suivis.values.forEach { s ->
            s.nombre = 0; s.pireMs = 0
            val derniere = s.causes.lastOrNull()
            s.causes.clear()
            if (!s.enLigne && derniere != null) s.causes += derniere
            // Une coupure qui dure encore compte de nouveau dans le relevé suivant, avec toute sa durée.
            if (!s.enLigne) s.nombre = 1
        }
        return lignes.takeIf { it.isNotEmpty() }?.joinToString(", ", prefix = "coupures 5 min : ")
    }

    companion object {
        const val CAUSE_PAGE_CACHEE = "page cachée (appli quittée ou écran éteint)"
        const val CAUSE_RESEAU = "réseau (page affichée)"
    }

    private fun ajouterDuree(s: Suivi, ms: Long) {
        if (ms > s.pireMs) s.pireMs = ms
    }

    private fun secondes(ms: Long) = if (ms < 60_000) "${(ms + 500) / 1000} s" else "${ms / 60_000} min ${(ms % 60_000) / 1000} s"
}
