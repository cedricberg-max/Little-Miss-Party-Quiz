package com.littlemissparty.quiz.engine

import kotlin.math.abs
import kotlin.random.Random

/*
 * ⏱️ Le Chrono caché (cedric, 30 octobre) : à la TV, un grand chrono part de 0. À un moment tiré au hasard (entre 6 et
 * 12 s environ), Buzzy arrive avec un grand drap et le jette dessus : plus aucun chiffre n'est visible. Les équipes
 * continuent de compter dans leur tête et buzzent UNE fois, quand elles pensent avoir atteint la cible (30 s par
 * exemple). Quand toutes ont buzzé, la révélation : une règle du temps, la cible, et la pastille de chaque équipe là
 * où elle a buzzé. L'équipe la plus proche de la cible gagne le tour (à égalité au centième, toutes celles-là).
 *
 * Comme le Duel des robots, la box ne fait confiance qu'aux heures du serveur : chaque tablette annonce l'heure de son
 * appui (heure du serveur estimée), et la TV dit quand le 0 est vraiment apparu à l'écran ([ChronoRound.shownAt]).
 * Sarah règle la cible et le nombre de tours dans la Régie PC ; elle peut changer la cible sur son téléphone avant
 * chaque tour (− / +).
 */

/** Points du tour gagné (× 2 si le jeu est doublé). */
const val CHRONO_POINTS = 100

/** Cible (secondes) : bornes et valeur par défaut. */
const val CHRONO_CIBLE_MIN = 10
const val CHRONO_CIBLE_MAX = 90
const val CHRONO_CIBLE_DEFAUT = 30

/** Tours par jeu, réglables dans la Régie PC, et par défaut. */
const val CHRONO_TOURS = 3
const val CHRONO_TOURS_MAX = 10

/** Décompte 3, 2, 1 à la TV entre « ▶ Lancer le chrono » et le 0 du chrono. */
const val CHRONO_DECOMPTE_MS = 3_000L

/** Le drap tombe sur le chrono entre ces deux moments (jamais après 60 % de la cible). */
const val CHRONO_CACHE_MIN_MS = 6_000L
const val CHRONO_CACHE_MAX_MS = 12_000L

/** Temps laissé après la cible aux équipes qui n'ont pas encore buzzé, avant la révélation sans elles. */
const val CHRONO_ATTENTE_MS = 15_000L

/** Heure d'appui annoncée par une tablette : au plus ce temps avant l'arrivée du buzz sur le serveur (jamais après). */
const val CHRONO_LATENCE_MAX_MS = 1_500L

/** Retard (ou avance) d'affichage du 0 pris en compte au plus : au-delà, la TV a calé, on garde la borne. */
const val CHRONO_AFFICHAGE_MAX_MS = 1_000L
const val CHRONO_AVANCE_MAX_MS = 200L

/** Un buzz : l'équipe, l'heure de l'appui (heure du serveur, ramenée dans la fenêtre permise) et d'arrivée. */
data class ChronoBuzz(val team: String, val t: Long, val at: Long)

/**
 * Bilan d'un tour : l'écart de chaque équipe qui a buzzé ([ecarts], en ms : négatif = trop tôt, positif = trop tard),
 * les gagnantes ([winners]) et leurs [points] chacune. Les équipes sans buzz n'ont pas d'écart.
 */
data class ChronoResult(val ecarts: Map<String, Long>, val winners: List<String>, val points: Int, val at: Long)

/**
 * Le tour [tour] du jeu : la [cible] (secondes). [startAt] : « ▶ Lancer le chrono » (null : tour prêt, pas lancé) ;
 * [goAt] : heure prévue du 0 ; [cacheMs] : le drap tombe ce temps après le 0 ; [shownAt] : heure où le 0 est vraiment
 * apparu à la TV ; [teams] : les équipes du tour (inscrites au lancement) ; [buzzes] : un appui par équipe au plus ;
 * [result] : le bilan, une fois jugé. [gagnes] : tours gagnés par équipe dans ce jeu (celui-ci compris).
 */
data class ChronoRound(
    val tour: Int,
    val cible: Int,
    val startAt: Long? = null,
    val goAt: Long? = null,
    val cacheMs: Long? = null,
    val shownAt: Long? = null,
    val teams: List<String> = emptyList(),
    val buzzes: List<ChronoBuzz> = emptyList(),
    val result: ChronoResult? = null,
    val gagnes: Map<String, Int> = emptyMap(),
) {
    /** Le chrono tourne (ou le drap le cache) : lancé, pas encore jugé. */
    val enCours: Boolean get() = startAt != null && result == null

    /** Étape publiée : prêt, chrono en cours, ou bilan. */
    val step: String get() = when {
        result != null -> "result"
        startAt != null -> "run"
        else -> "ready"
    }

    /** Le tour s'arrête sans bilan (pause, « ✋ Arrêter ») : il reste prêt, avec la même cible. */
    fun annule(): ChronoRound =
        if (enCours) copy(startAt = null, goAt = null, cacheMs = null, shownAt = null, teams = emptyList(), buzzes = emptyList()) else this

    /** Le 0 de référence : tel qu'il est apparu à l'écran, sinon son heure prévue. */
    val reference: Long? get() = goAt?.let { go -> shownAt?.coerceIn(go - CHRONO_AVANCE_MAX_MS, go + CHRONO_AFFICHAGE_MAX_MS) ?: go }

    /** Heure où la box doit juger le tour sans attendre d'autre buzz, ou null s'il n'y a rien à attendre. */
    val jugeAt: Long? get() {
        val go = goAt ?: return null
        if (!enCours) return null
        // Toutes les équipes ont buzzé : on juge dès que l'heure du 0 affiché est connue (sinon 5 s après le 0 prévu,
        // bien avant la cible : l'heure prévue sert alors de référence).
        if (teams.isNotEmpty() && teams.all { t -> buzzes.any { it.team == t } }) return if (shownAt != null) startAt else go + 5_000L
        return reference!! + cible * 1_000L + CHRONO_ATTENTE_MS
    }

    /** Écart de [b] avec la cible (ms) : négatif trop tôt, positif trop tard. */
    fun ecart(b: ChronoBuzz): Long = b.t - (reference ?: b.t) - cible * 1_000L

    /** Le bilan à l'heure [at] : la plus petite distance à la cible gagne (au centième près : égalité = toutes). */
    fun bilan(at: Long, points: Int): ChronoResult {
        val ecarts = buzzes.associate { it.team to ecart(it) }
        val best = ecarts.values.minOfOrNull { centiemes(it) }
        val winners = if (best == null) emptyList() else buzzes.map { it.team }.filter { centiemes(ecarts.getValue(it)) == best }
        return ChronoResult(ecarts, winners, if (winners.isEmpty()) 0 else points, at)
    }
}

/** Distance à la cible arrondie au centième de seconde, comme l'affiche la TV. */
fun centiemes(ecartMs: Long): Long = (abs(ecartMs) + 5) / 10

/** Moment où le drap tombe, après le 0 : entre 6 et 12 s, jamais après 60 % de la [cible] (secondes). */
fun momentDuDrap(cible: Int, random: Random = Random.Default): Long {
    val max = minOf(CHRONO_CACHE_MAX_MS, cible * 600L)
    val min = minOf(CHRONO_CACHE_MIN_MS, max * 3 / 5)
    return if (max <= min) min else random.nextLong(min, max + 1)
}

/** Chrono caché : tours gagnés par chaque équipe dans le jeu en cours. */
fun Game.chronoGagnes(): Map<String, Int> = state.chrono?.takeIf { question?.isChrono == true }?.gagnes.orEmpty()
