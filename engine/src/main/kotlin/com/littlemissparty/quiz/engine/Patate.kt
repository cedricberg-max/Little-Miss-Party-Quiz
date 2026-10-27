package com.littlemissparty.quiz.engine

/*
 * « Ça va exploser ! » : une bombe passe d'équipe en équipe, chaque équipe choisit sur sa tablette à qui l'envoyer.
 * La mèche brûle pendant [POTATO_FUSE_MS], la durée exacte de la musique du jeu (la TV la montre qui raccourcit, sans
 * secondes). Pas de retour à l'envoyeur (sauf à 2 équipes). La bombe ne bloque jamais : l'équipe qui la reçoit peut la
 * renvoyer aussitôt, mais si elle la garde plus de [POTATO_HOLD_MS], elle lui explose dans les mains (cedric, 27 octobre :
 * plus de « mèche qui colle », ressentie comme une latence entre l'appui sur la tablette et la TV). À l'explosion,
 * l'équipe qui tient la bombe perd [POTATO_POINTS] (jamais sous 0), toutes les autres gagnent autant. [POTATO_BOMBS]
 * bombes par partie : après chaque explosion sauf la dernière, une nouvelle mèche s'allume (cedric, 21 octobre).
 */

/**
 * Délai avant de pouvoir renvoyer la bombe reçue : aucun depuis le 27 octobre (cedric). Les 2 s de « mèche qui colle »
 * d'avant perdaient les appuis trop rapides. Gardé à 0 pour readyAt, que lisent les règles de la base et les tablettes.
 */
const val POTATO_STICKY_MS = 0L

/**
 * Bombe gardée trop longtemps : dès la réception, l'équipe a ce temps (de jeu, pauses exclues) pour l'envoyer ; sinon
 * elle explose chez elle, avec la même pénalité qu'au bout de la mèche. Sa tablette compte 2, 1 (cedric, 27/10).
 */
const val POTATO_HOLD_MS = 2_000L

/**
 * Durée de chaque mèche (millisecondes de jeu, pauses exclues) : exactement la musique du jeu, qui part du début quand la
 * mèche s'allume et finit sur l'explosion (cedric, 23 octobre, « Durée fixe »). Même valeur que PATATE_MUSIQUE_MS de
 * l'habillage de la TV (lmp_patate_musique.ogg) ; un test de la TV vérifie qu'elles restent égales.
 */
const val POTATO_FUSE_MS = 38_391L

/** Mèches acceptées dans le journal d'une partie : avant le 23 octobre, la durée était tirée au sort entre ces bornes. */
const val POTATO_FUSE_MIN_MS = 25_000L
const val POTATO_FUSE_MAX_MS = 45_000L

/** Départ : la TV allume la mèche, la bombe ne peut pas partir avant. */
const val POTATO_GO_MS = 3_500L

/**
 * Points perdus par l'équipe qui tient la bombe à l'explosion (jamais sous 0), gagnés par chacune des autres. Trois
 * bombes de 100 : au plus 300 sur la partie, comme le vainqueur des autres mini-jeux.
 */
const val POTATO_POINTS = 100

/** Nombre de bombes dans une partie, par défaut ; la Régie PC peut le régler de 1 à [POTATO_BOMBS_MAX] (cedric, 26/10). */
const val POTATO_BOMBS = 3
const val POTATO_BOMBS_MAX = 6

/** Entre deux bombes : l'explosion à la TV ([POTATO_BOOM_MS]), puis « Bombe 2 sur 3 » ; la nouvelle bombe part ensuite. */
const val POTATO_BOOM_MS = 3_500L
const val POTATO_NEXT_MS = 7_000L

/**
 * Une explosion : chez quelle équipe, à quelle heure, les points vraiment perdus (réduits au score) et ceux gagnés par les
 * autres ; [held] = avant la fin de la mèche, parce que l'équipe a gardé la bombe plus de [POTATO_HOLD_MS].
 */
data class PotatoBoom(val holder: String, val at: Long, val lost: Int, val gain: Int = POTATO_POINTS, val held: Boolean = false)

/**
 * Bombe en cours de « Ça va exploser ! » : [teams] = équipes qui jouent, [holder] = équipe qui tient la bombe, [from] =
 * celle qui vient de l'envoyer (null au départ), [since] = heure du serveur où [holder] l'a reçue, [hit] = équipes qui
 * l'ont déjà eue, [passes] = nombre d'envois, [bomb] = numéro de la bombe (1 à [total]), [booms] = les
 * explosions de la partie, celle de cette bombe comprise une fois arrivée. [total] = nombre de bombes de la partie
 * (réglé dans la Régie PC ; ramené à la bombe en cours quand Sarah choisit « Dernière bombe »).
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
    val total: Int = POTATO_BOMBS,
) {
    /** Cette bombe a explosé : plus d'envoi, la suivante va s'allumer (ou c'est la fin, après la dernière). */
    val exploded: Boolean get() = booms.size >= bomb

    /** Dernière bombe de la partie. */
    val last: Boolean get() = bomb >= total

    /** À 2 équipes, la bombe repart forcément chez l'envoyeur. */
    val canReturn: Boolean get() = teams.size <= 2

    /** Équipes à qui [holder] peut envoyer la bombe. */
    val targets: List<String> get() = teams.filter { it != holder && (canReturn || it != from) }

    /** Entre deux bombes à [now] : la suivante est allumée mais pas encore partie (explosion et « Bombe 2 sur 3 »). */
    fun entreDeux(now: Long): Boolean = !exploded && bomb > 1 && booms.size == bomb - 1 && now < since

    /** Heure du serveur à partir de laquelle [holder] peut renvoyer la bombe. */
    val readyAt: Long get() = since + POTATO_STICKY_MS
}

