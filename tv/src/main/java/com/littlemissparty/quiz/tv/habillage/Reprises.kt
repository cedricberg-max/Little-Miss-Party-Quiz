package com.littlemissparty.quiz.tv.habillage

/**
 * Lecteur en erreur : quand le refaire. Test du 24 octobre : la box, à court de sorties audio, a mis « lmp_bed_full »
 * en erreur 19 fois en 2 s ; chaque lecteur refait aussitôt retombait en erreur, et cette avalanche privait les autres
 * sons (scores, Super Finale muets). Un son est donc refait de plus en plus tard ([delais]), et au plus autant
 * de fois que [delais] en compte sur [fenetreMs] ; au-delà, il attend qu'une tentative sorte de la fenêtre.
 */
internal class Reprises(
    private val delais: List<Long> = listOf(500L, 2_000L, 5_000L),
    private val fenetreMs: Long = 60_000L,
) {
    /** Instants (prévus) des dernières tentatives, par fichier. */
    private val tentatives = mutableMapOf<String, ArrayDeque<Long>>()

    /** Délai avant de refaire le lecteur du fichier [nom], tombé en erreur à l'instant [maintenant] (en ms). */
    @Synchronized
    fun delai(nom: String, maintenant: Long): Long {
        val passees = tentatives.getOrPut(nom) { ArrayDeque() }
        while (passees.isNotEmpty() && maintenant - passees.first() >= fenetreMs) passees.removeFirst()
        // Au-delà : une fenêtre pleine après la tentative qui est [delais.size] rangs plus tôt (jamais toutes au même instant).
        val d = delais.getOrNull(passees.size)
            ?: (passees[passees.size - delais.size] + fenetreMs - maintenant).coerceAtLeast(delais.last())
        passees.addLast(maintenant + d)
        return d
    }
}

/**
 * Incidents du son envoyés dans les rapports de la box. Avant, seuls les 20 premiers d'un lancement partaient : le
 * 24 octobre, ils étaient tous pris en 2 s par la même erreur répétée, et la suite de la soirée n'a laissé aucune trace.
 * Désormais un même message part une fois, puis ses répétitions pendant [fenetreMs] sont résumées en une ligne
 * (« … : encore ×18 en 2 s ») ; au plus [max] envois par lancement.
 */
internal class Incidents(
    val fenetreMs: Long = 10_000L,
    private val max: Int = 60,
    private val envoyer: (String) -> Unit,
) {
    private class Rafale(val debut: Long) {
        var repetitions = 0
        var derniere = debut
    }

    private val rafales = mutableMapOf<String, Rafale>()
    private var envoyes = 0

    /** Rapports du son déjà envoyés pendant ce lancement (le bilan de santé de la box les compte). */
    val nombre: Int @Synchronized get() = envoyes

    /**
     * Note l'incident [texte]. Vrai quand il ouvre une rafale : appeler [fermer] pour ce texte [fenetreMs] plus tard.
     */
    @Synchronized
    fun noter(texte: String, maintenant: Long): Boolean {
        rafales[texte]?.let {
            it.repetitions++
            it.derniere = maintenant
            return false
        }
        rafales[texte] = Rafale(maintenant)
        envoyerAuPlus(texte)
        return true
    }

    /** Fin de la rafale de [texte] : ses répétitions, s'il y en a eu, en une seule ligne. */
    @Synchronized
    fun fermer(texte: String) {
        val r = rafales.remove(texte) ?: return
        if (r.repetitions == 0) return
        val secondes = ((r.derniere - r.debut + 999) / 1000).coerceAtLeast(1)
        envoyerAuPlus("$texte : encore ×${r.repetitions} en $secondes s")
    }

    private fun envoyerAuPlus(texte: String) {
        if (envoyes >= max) return
        envoyes++
        if (envoyes == max) envoyer("$texte (dernier rapport du son pour ce lancement)") else envoyer(texte)
    }
}
