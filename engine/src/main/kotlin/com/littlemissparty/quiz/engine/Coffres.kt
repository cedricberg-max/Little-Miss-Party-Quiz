package com.littlemissparty.quiz.engine

import kotlin.random.Random

/*
 * Les coffres mystères : les équipes ouvrent des coffres chacune son tour, sur leur tablette. Bonus ou malus, tirés au
 * sort par la box à l'ouverture : le contenu d'un coffre n'existe nulle part avant, personne ne peut le lire ni
 * le choisir, régie comprise. Après quelques tours sans danger, une bombe se cache dans un des coffres restants ;
 * l'équipe qui l'ouvre perd des points et le jeu s'arrête sur le bilan.
 */

/** Points perdus par l'équipe qui ouvre la bombe (jamais sous 0). */
const val BOMB_POINTS = 300

/** Bonus possibles dans un coffre, et malus (jamais sous 0). */
val CHEST_BONUS = listOf(50, 100, 150, 200, 300)
val CHEST_MALUS = listOf(-50, -100, -150)

/** Chance qu'un coffre (hors bombe) soit un bonus, sur 10. */
const val CHEST_BONUS_IN_10 = 7

/** Nombre de coffres au plus (8 équipes). */
const val MAX_CHESTS = 20

/** Ouverture d'un coffre à la TV, puis l'animation bonus ou malus de l'équipe : l'équipe suivante ne peut pas ouvrir avant. */
const val CHEST_SHOW_MS = 4_500L

/** Annonce « une bombe se cache… » à la TV, après le dernier tour sans danger. */
const val BOMB_ALERT_MS = 4_000L

/** Tours sans danger (chaque équipe ouvre un coffre par tour) : moins il y a d'équipes, plus il y en a. */
fun safeRounds(teams: Int): Int = when {
    teams <= 3 -> 3
    teams <= 5 -> 2
    else -> 1
}

/** Nombre de coffres : de quoi jouer les tours sans danger, un tour avec la bombe, et deux de plus. */
fun chestCount(teams: Int): Int = (teams * safeRounds(teams) + teams + 2).coerceAtMost(MAX_CHESTS)

/** Un coffre ouvert : par quelle équipe, les points vraiment comptés (malus réduit au score), et si c'était la bombe. */
data class ChestOpen(val team: String, val chest: Int, val delta: Int, val bomb: Boolean, val at: Long)

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

    /** Équipe qui doit ouvrir un coffre, ou null une fois la bombe ouverte. */
    val team: String? get() = if (exploded || closed.isEmpty()) null else order[turn % order.size]

    /** La bombe peut être dans le prochain coffre ouvert. */
    val danger: Boolean get() = turn >= safe

    val closed: List<Int> get() = (0 until count).filter { c -> opened.none { it.chest == c } }

    /**
     * Heure à partir de laquelle l'équipe qui joue peut ouvrir : après l'animation du coffre précédent, et après
     * l'annonce de la bombe quand ce coffre a terminé les tours sans danger.
     */
    val readyAt: Long get() {
        val last = opened.lastOrNull() ?: return dealt
        return last.at + CHEST_SHOW_MS + if (turn == safe) BOMB_ALERT_MS else 0L
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
 * Contenu tiré au sort pour le prochain coffre de [round] : la bombe (une chance sur le nombre de coffres encore
 * fermés, dès la fin des tours sans danger), sinon un bonus ou un malus. Null pour la bombe, sinon les points.
 */
fun drawChest(round: ChestRound, random: Random): Int? {
    val left = round.closed.size
    if (round.danger && random.nextInt(left) == 0) return null
    return if (random.nextInt(10) < CHEST_BONUS_IN_10) CHEST_BONUS.random(random) else CHEST_MALUS.random(random)
}
