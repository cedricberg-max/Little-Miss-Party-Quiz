package com.littlemissparty.quiz.engine

import kotlin.random.Random

/*
 * 🤠 Le Duel des robots (cedric, 27 octobre) : deux équipes s'affrontent, un joueur de chaque côté, la main sur le
 * buzzer. À la TV, deux robots se défient du regard, feintent… puis PAN ! La première équipe à buzzer après le PAN gagne
 * le duel ; une équipe qui buzze avant perd, le point va à l'autre. La box fixe seule l'heure du PAN, que personne ne
 * connaît à l'avance (ni les tablettes ni la régie), et compare l'heure de chaque appui à la sienne.
 *
 * « La ronde » : la box prépare chaque duel avec les équipes qui ont le moins joué, puis celles qui attendent depuis le
 * plus longtemps, jamais la même paire deux fois de suite (sauf à 2 équipes). Dans chaque équipe, les joueurs passent
 * l'un après l'autre (n° 1, 2, 3…) : avec le nombre approximatif de joueurs réglé dans la Régie PC, tout le monde joue.
 * Sarah lance chaque duel ; elle peut aussi en lancer un à la volée entre 2 équipes de son choix.
 */

/** Points d'un duel gagné (× 2 si le jeu est doublé). */
const val DUEL_POINTS = 100

/** Joueurs par équipe réglables dans la Régie PC, et par défaut. */
const val DUEL_JOUEURS = 4
const val DUEL_JOUEURS_MAX = 12

/** Face-à-face (secondes) : bornes réglables dans la Régie PC, valeurs par défaut, et durée d'un « long duel ». */
const val DUEL_FACE_MIN_SEC = 10
const val DUEL_FACE_MAX_SEC = 60
const val DUEL_FACE_DEFAUT_MIN = 20
const val DUEL_FACE_DEFAUT_MAX = 40

/** « De temps en temps un long duel » : environ un sur quatre dure entre la durée maximale et 60 s. */
const val DUEL_LONG_CHANCE = 0.25

/** Personne n'a buzzé ce temps après le PAN : duel nul, sans points. */
const val DUEL_PERSONNE_MS = 10_000L

/**
 * Heure d'appui annoncée par une tablette : au plus ce temps avant l'arrivée du buzz sur le serveur (jamais après).
 * Après le premier appui valable, la box attend donc ce temps un appui plus rapide de l'autre équipe, coincé dans un
 * wifi plus lent (sauf si les deux ont déjà buzzé).
 */
const val DUEL_LATENCE_MAX_MS = 1_500L

/** Retard d'affichage du PAN pris en compte au plus (au-delà, la TV a calé : on garde ce retard). */
const val DUEL_AFFICHAGE_MAX_MS = 1_000L

/**
 * Avance d'affichage du PAN tolérée (horloges de la TV et du serveur à quelques dizaines de ms près) : un appui plus
 * de ce temps avant l'heure du PAN est trop tôt sans attendre ; entre les deux, la box attend l'heure de l'image.
 */
const val DUEL_AVANCE_MAX_MS = 200L

/** Un buzz de tablette : l'équipe, l'heure de l'appui (heure du serveur, ramenée dans la fenêtre permise) et d'arrivée. */
data class DuelBuzz(val team: String, val t: Long, val at: Long)

/**
 * Bilan d'un duel : [winner] et [loser] (null tous deux : personne n'a buzzé), [early] = l'équipe qui a buzzé avant le
 * PAN, [ms] = temps de réaction de la gagnante après le PAN, [points] gagnés.
 */
data class DuelResult(val winner: String?, val loser: String?, val early: String?, val ms: Long?, val points: Int, val at: Long)

/**
 * Le duel prêt ou en cours : le [n]-ième du jeu, entre les équipes [teams] (2), leurs joueurs [players] (n° à partir de
 * 1), [extra] = lancé à la volée par Sarah. [startAt] : début du face-à-face (null : duel prêt, pas encore lancé) ;
 * [panAt] : heure du PAN, secrète ; [shownAt] : heure où le PAN est vraiment apparu à l'écran (null tant que la TV ne
 * l'a pas dit) ; [buzzes] : les appuis reçus ; [result] : le bilan, une fois jugé.
 * [played] : duels joués par équipe (celui-ci compris une fois jugé), [lastDuel] : numéro du dernier duel de chaque équipe.
 */
data class DuelRound(
    val n: Int,
    val teams: List<String>,
    val players: List<Int>,
    val extra: Boolean = false,
    val startAt: Long? = null,
    val panAt: Long? = null,
    val shownAt: Long? = null,
    val buzzes: List<DuelBuzz> = emptyList(),
    val result: DuelResult? = null,
    val played: Map<String, Int> = emptyMap(),
    val lastDuel: Map<String, Int> = emptyMap(),
) {
    /** Le face-à-face est en cours : lancé, pas encore jugé. */
    val enCours: Boolean get() = startAt != null && result == null

    /** Étape publiée : prêt, face-à-face, ou bilan. */
    val step: String get() = when {
        result != null -> "result"
        startAt != null -> "standoff"
        else -> "ready"
    }

    /** Le face-à-face s'arrête sans bilan (pause, « Arrêter le duel ») : la même paire reste prête. */
    fun annule(): DuelRound = if (enCours) copy(startAt = null, panAt = null, shownAt = null, buzzes = emptyList()) else this

    /** L'instant de référence : le PAN tel qu'il est apparu à l'écran, sinon son heure prévue. */
    val reference: Long? get() = panAt?.let { pan -> shownAt?.coerceIn(pan - DUEL_AVANCE_MAX_MS, pan + DUEL_AFFICHAGE_MAX_MS) ?: pan }

    /** Heure où la box doit juger le duel sans attendre d'autre buzz, ou null s'il n'y a rien à attendre. */
    val jugeAt: Long? get() {
        val pan = reference ?: return null
        if (!enCours) return null
        val premier = buzzes.filter { it.t >= pan }.minOfOrNull { it.t }
        return premier?.let { it + DUEL_LATENCE_MAX_MS } ?: (pan + DUEL_PERSONNE_MS)
    }

    /**
     * Le bilan à l'heure [at] d'après les buzz reçus : un appui avant le PAN affiché perd (le plus tôt des deux) ;
     * sinon le plus petit temps gagne (à égalité, le premier arrivé).
     */
    fun bilan(at: Long, points: Int): DuelResult {
        val pan = reference ?: at
        buzzes.filter { it.t < pan }.minByOrNull { it.t }?.let { tot ->
            return DuelResult(teams.first { it != tot.team }, tot.team, tot.team, null, points, at)
        }
        val gagnant = buzzes.minWithOrNull(compareBy<DuelBuzz>({ it.t }, { it.at }))
            ?: return DuelResult(null, null, null, null, 0, at)
        return DuelResult(gagnant.team, teams.first { it != gagnant.team }, null, gagnant.t - pan, points, at)
    }
}

/**
 * Les 2 équipes du duel suivant parmi [teams] : celles qui ont le moins joué, puis celles qui attendent depuis le plus
 * longtemps, au hasard à égalité ; jamais la paire [previous] deux fois de suite, sauf à 2 équipes. Null à moins de 2.
 */
fun prochainePaire(
    teams: Collection<String>,
    played: Map<String, Int>,
    lastDuel: Map<String, Int>,
    previous: List<String>?,
    random: Random = Random.Default,
): List<String>? {
    if (teams.size < 2) return null
    val rangees = teams.distinct().shuffled(random).sortedWith(compareBy({ played[it] ?: 0 }, { lastDuel[it] ?: 0 }))
    val avant = previous?.toSet()
    for (i in rangees.indices) for (j in i + 1 until rangees.size) {
        val paire = listOf(rangees[i], rangees[j])
        if (rangees.size == 2 || avant == null || paire.toSet() != avant) return paire
    }
    return null
}

/**
 * Duel des robots : duels gagnés par chaque équipe dans le jeu en cours, pour les affiches WANTED de la fin (choisies
 * par cedric le 27/10), d'après ses points du jeu : chaque duel gagné rapporte les mêmes points.
 */
fun Game.duelsGagnes(): Map<String, Int> {
    val q = question?.takeIf { it.isDuel } ?: return emptyMap()
    val parDuel = DUEL_POINTS * factorOf(state.index)
    if (parDuel <= 0) return emptyMap()
    return state.awards[q.id].orEmpty().mapValues { (_, a) -> (a.points + parDuel / 2) / parDuel }.filterValues { it > 0 }
}

/** Joueur appelé dans une équipe qui a déjà joué [joues] duels, sur [joueurs] joueurs (n° à partir de 1). */
fun joueurAppele(joues: Int, joueurs: Int): Int = joues % joueurs.coerceAtLeast(1) + 1

/** Duels prévus pour que chacun des [joueurs] joueurs de [equipes] équipes joue une fois (un joueur rejoue si besoin). */
fun duelsPrevus(equipes: Int, joueurs: Int): Int = if (equipes < 2) 0 else (equipes * joueurs + 1) / 2

/**
 * Durée du face-à-face (millisecondes) entre [minSec] et [maxSec] ; avec [longs], environ un duel sur quatre dure
 * entre [maxSec] et 60 s (sans effet quand [maxSec] vaut déjà 60).
 */
fun dureeFaceAFace(minSec: Int, maxSec: Int, longs: Boolean, random: Random = Random.Default): Long {
    val min = minSec.coerceIn(DUEL_FACE_MIN_SEC, DUEL_FACE_MAX_SEC) * 1_000L
    val max = maxSec.coerceIn(min.toInt() / 1_000, DUEL_FACE_MAX_SEC) * 1_000L
    val long = longs && max < DUEL_FACE_MAX_SEC * 1_000L && random.nextDouble() < DUEL_LONG_CHANCE
    return if (long) random.nextLong(max + 1, DUEL_FACE_MAX_SEC * 1_000L + 1) else random.nextLong(min, max + 1)
}
