package com.littlemissparty.quiz.tv

import android.view.Choreographer

/**
 * Fluidité mesurée sur la vraie box (cedric, 25/10 au soir : « petites saccades par-ci par-là, pas acceptable », la
 * Mi Box comme référence) : chaque image de l'écran est chronométrée ; une image qui arrive plus de [EN_RETARD_MS]
 * après la précédente est « en retard », une de plus de [ACCROC_MS] est un « accroc » qui se voit. Le compte, écran par
 * écran, part dans les rapports de la box avec le bilan de santé ([CompteurFluidite.ligne]). Rien ici ne touche à la
 * partie. Fil principal seulement.
 */
internal object Fluidite : Choreographer.FrameCallback {
    /** Écran en cours, posé par l'habillage (« question zoom », « intro gonfleur »…). */
    @Volatile var ecran: String = "démarrage"

    /**
     * Moment précis dans l'écran, posé par une animation qui veut sa propre ligne (« vol » de la bombe, « boum »…) :
     * compté sous « question bombe vol ». null : l'écran seul.
     */
    @Volatile var moment: String? = null

    private val compteur = CompteurFluidite()
    private var derniere = 0L
    private var lance = false

    fun demarrer() {
        if (lance) return
        lance = true
        Choreographer.getInstance().postFrameCallback(this)
    }

    override fun doFrame(nanos: Long) {
        if (derniere != 0L) compteur.image((nanos - derniere) / 1_000_000, moment?.let { "$ecran $it" } ?: ecran)
        derniere = nanos
        Choreographer.getInstance().postFrameCallback(this)
    }

    /** Ligne du rapport depuis le dernier appel (null si rien à dire), puis remise à zéro. */
    fun releve(): String? = synchronized(compteur) { compteur.ligne().also { compteur.vider() } }

    /** Appli en arrière-plan : la pause entre deux images n'est pas une saccade. */
    fun oublierDerniere() {
        derniere = 0L
    }
}

/** Le décompte des images, par écran : voir [Fluidite]. */
internal class CompteurFluidite {
    private class Ecran(var images: Int = 0, var retards: Int = 0, var accrocs: Int = 0, var pireMs: Long = 0)

    private val ecrans = linkedMapOf<String, Ecran>()

    @Synchronized fun image(intervalleMs: Long, ecran: String) {
        // Appli revenue au premier plan, écran éteint : pas une image de la partie.
        if (intervalleMs <= 0 || intervalleMs > IGNORE_MS) return
        val e = ecrans.getOrPut(ecran) { Ecran() }
        e.images++
        if (intervalleMs > EN_RETARD_MS) e.retards++
        if (intervalleMs > ACCROC_MS) e.accrocs++
        if (intervalleMs > e.pireMs) e.pireMs = intervalleMs
    }

    /**
     * « images 17 980, en retard 1,2 % · accrocs : question zoom 4 (pire 420 ms), intro coffres 2 (pire 260 ms) » ;
     * les écrans aux accrocs les plus nombreux d'abord, 4 au plus (la ligne doit rester lisible dans le workflow).
     */
    @Synchronized fun ligne(): String? {
        val images = ecrans.values.sumOf { it.images }
        if (images == 0) return null
        val retards = ecrans.values.sumOf { it.retards }
        val pourcent = "%.1f".format(java.util.Locale.FRANCE, retards * 100.0 / images)
        val pires = ecrans.entries.filter { it.value.accrocs > 0 }
            .sortedWith(compareByDescending<Map.Entry<String, Ecran>> { it.value.accrocs }.thenByDescending { it.value.pireMs })
            .take(4)
            .joinToString(", ") { (nom, e) -> "$nom ${e.accrocs} (pire ${e.pireMs} ms)" }
        return "images $images, en retard $pourcent %" + if (pires.isEmpty()) " · aucun accroc" else " · accrocs : $pires"
    }

    @Synchronized fun vider() = ecrans.clear()

    companion object {
        /** Plus de 3 images à 60 Hz : l'œil voit l'image hésiter. */
        const val EN_RETARD_MS = 50L
        /** L'image se fige : saccade franche. */
        const val ACCROC_MS = 150L
        const val IGNORE_MS = 5_000L
    }
}

/**
 * Délai entre l'appui sur une tablette (heure du serveur de son écriture) et sa réception par la box : buzz, envoi de
 * la bombe (cedric, 26/10 : petit décalage du buzz au blind test, bombe « pas au taquet »). Le compte part dans les
 * rapports de la box toutes les 5 min, avec la fluidité. Rien ici ne touche à la partie.
 */
internal object Reactivite {
    private val mesures = linkedMapOf<String, MutableList<Long>>()

    @Synchronized fun noter(quoi: String, ms: Long) {
        // Horloges mal calées (heure du serveur pas encore connue) : rien à en tirer.
        if (ms < -2_000 || ms > 60_000) return
        mesures.getOrPut(quoi) { mutableListOf() } += ms.coerceAtLeast(0)
    }

    /** « réception : buzz 6 (médiane 140 ms, pire 380 ms), bombe 14 (médiane 120 ms, pire 260 ms) », puis remise à zéro. */
    @Synchronized fun releve(): String? {
        if (mesures.isEmpty()) return null
        return "réception : " + mesures.entries.joinToString(", ") { (quoi, l) ->
            val tri = l.sorted()
            "$quoi ${tri.size} (médiane ${tri[tri.size / 2]} ms, pire ${tri.last()} ms)"
        }.also { mesures.clear() }
    }
}
