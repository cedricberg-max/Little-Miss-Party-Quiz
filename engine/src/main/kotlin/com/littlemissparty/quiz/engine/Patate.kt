package com.littlemissparty.quiz.engine

import kotlin.random.Random

/*
 * « Ça va exploser ! » : une bombe passe d'équipe en équipe, chaque équipe choisit sur sa tablette à qui l'envoyer.
 * La mèche brûle pendant une durée tirée au sort par la box, que personne ne connaît (la TV la montre qui raccourcit,
 * sans secondes). Pas de retour à l'envoyeur (sauf à 2 équipes) ; « mèche qui colle » : on ne peut renvoyer la bombe
 * que [POTATO_STICKY_MS] après l'avoir reçue, donc la vitesse du réseau ne désigne jamais le perdant. À l'explosion,
 * l'équipe qui tient la bombe perd [POTATO_POINTS] (jamais sous 0), toutes les autres gagnent autant. [POTATO_BOMBS]
 * bombes par partie : après chaque explosion sauf la dernière, une nouvelle mèche s'allume (cedric, 21 octobre).
 */

/** Mèche qui colle : délai avant de pouvoir renvoyer la bombe reçue. */
const val POTATO_STICKY_MS = 2_000L

/** Durée de la mèche, tirée au sort entre ces bornes (millisecondes de jeu, pauses exclues). */
const val POTATO_FUSE_MIN_MS = 25_000L
const val POTATO_FUSE_MAX_MS = 45_000L

/** Départ : la TV allume la mèche, la bombe ne peut pas partir avant. */
const val POTATO_GO_MS = 3_500L

/**
 * Points perdus par l'équipe qui tient la bombe à l'explosion (jamais sous 0), gagnés par chacune des autres. Trois
 * bombes de 100 : au plus 300 sur la partie, comme le vainqueur des autres mini-jeux.
 */
const val POTATO_POINTS = 100

/** Nombre de bombes dans une partie. */
const val POTATO_BOMBS = 3

/** Entre deux bombes : l'explosion à la TV ([POTATO_BOOM_MS]), puis « Bombe 2 sur 3 » ; la nouvelle bombe part ensuite. */
const val POTATO_BOOM_MS = 3_500L
const val POTATO_NEXT_MS = 7_000L

/** Une explosion : chez quelle équipe, à quelle heure, et les points vraiment perdus (réduits au score). */
data class PotatoBoom(val holder: String, val at: Long, val lost: Int)

/**
 * Bombe en cours de « Ça va exploser ! » : [teams] = équipes qui jouent, [holder] = équipe qui tient la bombe, [from] =
 * celle qui vient de l'envoyer (null au départ), [since] = heure du serveur où [holder] l'a reçue, [hit] = équipes qui
 * l'ont déjà eue, [passes] = nombre d'envois, [bomb] = numéro de la bombe (1 à [POTATO_BOMBS]), [booms] = les
 * explosions de la partie, celle de cette bombe comprise une fois arrivée.
 */
data class PotatoRound(
    val fuseMs: Long,
    val teams: List<String>,
    val holder: String,
    val from: String? = null,
    val since: Long,
    val hit: Set<String> = setOf(holder),
    val passes: Int = 0,
    val bomb: Int = 1,
    val booms: List<PotatoBoom> = emptyList(),
) {
    /** Cette bombe a explosé : plus d'envoi, la suivante va s'allumer (ou c'est la fin, après la dernière). */
    val exploded: Boolean get() = booms.size >= bomb

    /** Dernière bombe de la partie. */
    val last: Boolean get() = bomb >= POTATO_BOMBS

    /** À 2 équipes, la bombe repart forcément chez l'envoyeur : seule la mèche qui colle s'applique. */
    val canReturn: Boolean get() = teams.size <= 2

    /** Équipes à qui [holder] peut envoyer la bombe. */
    val targets: List<String> get() = teams.filter { it != holder && (canReturn || it != from) }

    /** Heure du serveur à partir de laquelle [holder] peut renvoyer la bombe. */
    val readyAt: Long get() = since + POTATO_STICKY_MS
}

/** Durée de mèche tirée au sort. */
fun drawFuse(random: Random): Long = POTATO_FUSE_MIN_MS + random.nextLong(POTATO_FUSE_MAX_MS - POTATO_FUSE_MIN_MS + 1)
