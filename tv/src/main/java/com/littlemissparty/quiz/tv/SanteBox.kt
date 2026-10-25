package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.engine.CacheMedias
import java.util.Locale

/**
 * Bilan de santé de la box, envoyé dans ses rapports (`reports/`, kind « sante ») pendant la partie : 1 min après la
 * connexion, puis toutes les 5 min (cedric, 25 octobre : les rapports ne disaient que les erreurs ; une box à court de
 * mémoire ou de place, ou un son resté muet sans erreur, ne laissait aucune trace). Une seule ligne, lisible telle
 * quelle dans le journal du workflow « Rapports » (il en garde les 200 premiers caractères).
 */
internal data class SanteBox(
    val ramLibreMo: Long,
    val ramTotaleMo: Long,
    val ramBasse: Boolean,
    val appliMo: Long,
    val appliMaxMo: Long,
    val disqueLibreMo: Long,
    val boucles: Int,
    val sonsLongs: Int,
    val incidentsSon: Int,
    val internet: Boolean,
    val ecran: String,
    val tablettes: Int,
    val equipes: Int,
    val depuisMs: Long,
) {
    fun ligne(): String {
        val minutes = depuisMs / 60_000
        val duree = if (minutes >= 60) "${minutes / 60} h ${"%02d".format(Locale.ROOT, minutes % 60)}" else "$minutes min"
        val alerte = alertes().takeIf { it.isNotEmpty() }?.joinToString(", ", prefix = "⚠ ", postfix = " · ") ?: ""
        return alerte +
            "RAM libre $ramLibreMo/$ramTotaleMo Mo · appli $appliMo/$appliMaxMo Mo · disque ${disque()} · " +
            "boucles $boucles, sons $sonsLongs, incidents $incidentsSon · " +
            "Internet ${if (internet) "oui" else "NON"} · $ecran · tablettes $tablettes/$equipes · $duree"
    }

    /** Ce qui mérite d'être lu en premier : rien quand tout va bien. */
    fun alertes(): List<String> = buildList {
        if (ramBasse || ramLibreMo < RAM_BASSE_MO) add("mémoire basse")
        if (appliMaxMo > 0 && appliMo * 100 >= appliMaxMo * 85) add("appli près de sa limite")
        if (disqueLibreMo < DISQUE_BAS_MO) add("place basse")
        if (!internet) add("sans Internet")
    }

    private fun disque(): String =
        if (disqueLibreMo >= 1024) "%.1f Go".format(Locale.FRANCE, disqueLibreMo / 1024.0) else "$disqueLibreMo Mo"

    companion object {
        const val PREMIER_MS = 60_000L
        const val CADENCE_MS = 5 * 60_000L
        /** 5 h de partie : au-delà, plus rien (une box oubliée allumée ne remplit pas la base). */
        const val MAX_PAR_LANCEMENT = 60
        const val RAM_BASSE_MO = 150L
        /** La place gardée libre par le cache des médias : en dessous, il ne peut plus rien garder. */
        const val DISQUE_BAS_MO = CacheMedias.RESERVE_LIBRE_OCTETS / (1024 * 1024)
    }
}
