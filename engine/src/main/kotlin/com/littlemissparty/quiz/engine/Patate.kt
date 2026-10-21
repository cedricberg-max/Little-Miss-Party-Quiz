package com.littlemissparty.quiz.engine

import kotlin.random.Random

/*
 * « Ça va exploser ! » : une bombe passe d'équipe en équipe, chaque équipe choisit sur sa tablette à qui l'envoyer.
 * La mèche brûle pendant une durée tirée au sort par la box, que personne ne connaît (la TV la montre qui raccourcit,
 * sans secondes). Pas de retour à l'envoyeur (sauf à 2 équipes) ; « mèche qui colle » : on ne peut renvoyer la bombe
 * que [POTATO_STICKY_MS] après l'avoir reçue, donc la vitesse du réseau ne désigne jamais le perdant. À l'explosion,
 * l'équipe qui tient la bombe perd [POTATO_POINTS] (jamais sous 0), toutes les autres gagnent autant.
 */

/** Mèche qui colle : délai avant de pouvoir renvoyer la bombe reçue. */
const val POTATO_STICKY_MS = 2_000L

/** Durée de la mèche, tirée au sort entre ces bornes (millisecondes de jeu, pauses exclues). */
const val POTATO_FUSE_MIN_MS = 25_000L
const val POTATO_FUSE_MAX_MS = 45_000L

/** Départ : la TV allume la mèche, la bombe ne peut pas partir avant. */
const val POTATO_GO_MS = 3_500L

/** Points perdus par l'équipe qui tient la bombe à l'explosion (jamais sous 0), gagnés par chacune des autres. */
const val POTATO_POINTS = 150

/**
 * Partie de « Ça va exploser ! » : [teams] = équipes qui jouent, [holder] = équipe qui tient la bombe, [from] = celle qui
 * vient de l'envoyer (null au départ), [since] = heure du serveur où [holder] l'a reçue, [hit] = équipes qui l'ont
 * déjà eue, [passes] = nombre d'envois.
 */
data class PotatoRound(
    val fuseMs: Long,
    val teams: List<String>,
    val holder: String,
    val from: String? = null,
    val since: Long,
    val hit: Set<String> = setOf(holder),
    val passes: Int = 0,
) {
    /** À 2 équipes, la bombe repart forcément chez l'envoyeur : seule la mèche qui colle s'applique. */
    val canReturn: Boolean get() = teams.size <= 2

    /** Équipes à qui [holder] peut envoyer la bombe. */
    val targets: List<String> get() = teams.filter { it != holder && (canReturn || it != from) }

    /** Heure du serveur à partir de laquelle [holder] peut renvoyer la bombe. */
    val readyAt: Long get() = since + POTATO_STICKY_MS
}

/** Durée de mèche tirée au sort. */
fun drawFuse(random: Random): Long = POTATO_FUSE_MIN_MS + random.nextLong(POTATO_FUSE_MAX_MS - POTATO_FUSE_MIN_MS + 1)
