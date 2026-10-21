package com.littlemissparty.quiz.engine

import kotlin.random.Random

/*
 * Les coffres mystères : les équipes ouvrent des coffres chacune son tour, sur leur tablette. Bonus ou malus, tirés au
 * sort par la box à l'ouverture : le contenu d'un coffre n'existe nulle part avant, personne ne peut le lire ni
 * le choisir, régie comprise. Après quelques tours sans danger, une bombe se cache dans un des coffres restants, et
 * un coffre en or aussi ; l'équipe qui ouvre la bombe perd des points et le jeu s'arrête sur le bilan.
 */

/** Points perdus par l'équipe qui ouvre la bombe (jamais sous 0). */
const val BOMB_POINTS = 300

/** Bonus possibles dans un coffre, et malus (jamais sous 0). */
val CHEST_BONUS = listOf(50, 100, 150, 200, 300)
val CHEST_MALUS = listOf(-50, -100, -150)

/** Le coffre en or : caché avec la bombe dans les derniers coffres, une seule fois, de quoi sauver une équipe. */
const val GOLD_POINTS = 500

/** Chance qu'un coffre (hors bombe et coffre en or) soit un bonus, sur 10. */
const val CHEST_BONUS_IN_10 = 7

/** Nombre de coffres au plus (8 équipes). */
const val MAX_CHESTS = 20

/** Ouverture d'un coffre à la TV, puis l'animation bonus ou malus de l'équipe : l'équipe suivante ne peut pas ouvrir avant. */
const val CHEST_SHOW_MS = 4_500L

/** Après chaque coffre (sauf la bombe), le classement à la TV : qui monte, qui descend. */
const val CHEST_RANKING_MS = 3_000L

/** Annonce « une bombe se cache… et un coffre en or » à la TV, après le dernier tour sans danger. */
const val BOMB_ALERT_MS = 5_000L

/** Tours sans danger (chaque équipe ouvre un coffre par tour) : moins il y a d'équipes, plus il y en a. */
fun safeRounds(teams: Int): Int = when {
    teams <= 3 -> 3
    teams <= 5 -> 2
    else -> 1
}

/**
 * Coffres encore fermés quand la bombe arrive : au moins 8, et toujours 4 de plus que d'équipes, pour que la bombe et
 * le coffre en or restent noyés parmi beaucoup de coffres.
 */
fun dangerChests(teams: Int): Int = maxOf(8, teams + 4)

/** Nombre de coffres : les tours sans danger, plus les coffres où se cachent la bombe et le coffre en or (20 au plus). */
fun chestCount(teams: Int): Int = (teams * safeRounds(teams) + dangerChests(teams)).coerceAtMost(MAX_CHESTS)

/**
 * Un coffre ouvert : par quelle équipe, les points vraiment comptés (malus réduit au score), si c'était la bombe, et
 * si c'était le coffre en or.
 */
data class ChestOpen(val team: String, val chest: Int, val delta: Int, val bomb: Boolean, val at: Long, val gold: Boolean = false)

/**
 * Partie de coffres mystères : [order] = ordre de jeu des équipes (la plus en retard d'abord), [safe] = nombre
 * d'ouvertures sans bombe possible, [dealt] = heure de la distribution (clé des choix des tablettes).
 */
data class ChestRound(
    val count: Int,
    val order: List<String>,
    val safe: Int,
    val dealt: Long,
    val opened: List<ChestOpen> = emptyList(),
) {
    /** Nombre de coffres déjà ouverts. */
    val turn: Int get() = opened.size

    val exploded: Boolean get() = opened.any { it.bomb }

    /** Le coffre en or a déjà été ouvert (il n'y en a qu'un). */
    val goldFound: Boolean get() = opened.any { it.gold }

    /** Équipe qui doit ouvrir un coffre, ou null une fois la bombe ouverte. */
    val team: String? get() = if (exploded || closed.isEmpty()) null else order[turn % order.size]

    /** La bombe peut être dans le prochain coffre ouvert. */
    val danger: Boolean get() = turn >= safe

    val closed: List<Int> get() = (0 until count).filter { c -> opened.none { it.chest == c } }

    /**
     * Heure à partir de laquelle l'équipe qui joue peut ouvrir : après l'animation du coffre précédent et le classement,
     * et après l'annonce de la bombe quand ce coffre a terminé les tours sans danger.
     */
    val readyAt: Long get() {
        val last = opened.lastOrNull() ?: return dealt
        return last.at + CHEST_SHOW_MS + CHEST_RANKING_MS + if (turn == safe) BOMB_ALERT_MS else 0L
    }

    /** Points gagnés ou perdus par chaque équipe dans ce jeu. */
    fun gains(): Map<String, Int> {
        val out = linkedMapOf<String, Int>()
        order.forEach { out[it] = 0 }
        opened.forEach { out.merge(it.team, it.delta, Int::plus) }
        return out
    }
}

/**
 * Contenu tiré au sort pour le prochain coffre de [round]. Dès la fin des tours sans danger : la bombe, une chance sur
 * le nombre de coffres encore fermés, et le coffre en or ([GOLD_POINTS], tant qu'il n'est pas trouvé), une chance
 * aussi. Sinon un bonus ou un malus. Null pour la bombe, sinon les points.
 */
fun drawChest(round: ChestRound, random: Random): Int? {
    val left = round.closed.size
    if (round.danger) {
        val k = random.nextInt(left)
        if (k == 0) return null
        if (k == 1 && !round.goldFound) return GOLD_POINTS
    }
    return if (random.nextInt(10) < CHEST_BONUS_IN_10) CHEST_BONUS.random(random) else CHEST_MALUS.random(random)
}
