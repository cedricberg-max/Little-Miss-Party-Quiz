package com.littlemissparty.quiz.engine

/**
 * Journal de la partie. Chaque action de l'animatrice ou de la box y est inscrite
 * avec un numéro croissant ([seq]) et l'heure du serveur ([at], en millisecondes).
 * L'état de la partie (scores compris) se reconstruit entièrement en rejouant ce journal :
 * c'est ce qui permet de reprendre une partie après un redémarrage sans rien perdre.
 */
sealed interface GameEvent {
    val seq: Int
    val at: Long
}

data class QuestionOpened(override val seq: Int, override val at: Long, val index: Int, val qid: String) : GameEvent
/**
 * Pause générale, possible à toute étape d'une partie commencée : chrono, réponses et progression
 * sont figés, scores et manche conservés. [reason] dit qui l'a demandée : [PAUSE_REGIE] (animatrice)
 * ou [PAUSE_TEAM] (pupitre de l'équipe [team] déconnecté en pleine question).
 */
data class Paused(
    override val seq: Int,
    override val at: Long,
    val reason: String = PAUSE_REGIE,
    val team: String? = null,
) : GameEvent

/**
 * Reprise, toujours décidée par l'animatrice. Le chrono repart [countdownMs] après l'appui,
 * le temps du décompte 3, 2, 1 affiché sur la TV et les pupitres.
 */
data class Resumed(override val seq: Int, override val at: Long, val countdownMs: Long = 0) : GameEvent

const val PAUSE_REGIE = "regie"
const val PAUSE_TEAM = "team"
/** Pause automatique : la box a perdu Internet, les tablettes ne reçoivent plus la question. */
const val PAUSE_NETWORK = "network"

/** Coupure tolérée avant la pause automatique (micro-coupure du Wi-Fi, changement de borne). */
const val NETWORK_GRACE_MS = 4000L

/** Durée du décompte 3, 2, 1 à la reprise. */
const val RESUME_COUNTDOWN_MS = 3000L

/** Délai pendant lequel la télécommande ne peut pas arrêter un chrono qui vient de partir (double appui sur OK). */
const val CLOSE_GUARD_MS = 1500L

/** Plus aucune réponse n'est acceptée pour la question en cours. */
data class QuestionClosed(override val seq: Int, override val at: Long) : GameEvent

/** Bonne réponse révélée, points attribués. Les points sont figés ici une fois pour toutes. */
data class Revealed(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val awards: Map<String, Award>,
) : GameEvent

data class ScoresShown(override val seq: Int, override val at: Long) : GameEvent

/** Correction manuelle d'un score (régie). */
data class ScoreAdjusted(
    override val seq: Int,
    override val at: Long,
    val team: String,
    val delta: Int,
    val reason: String = "",
) : GameEvent

/** Annule l'événement numéro [target] (seules les corrections de score sont annulables pour l'instant). */
data class Undone(override val seq: Int, override val at: Long, val target: Int) : GameEvent

data class GameEnded(override val seq: Int, override val at: Long) : GameEvent

/** Réponse d'une équipe : proposition choisie et heure du serveur à la réception. */
data class Answer(val choice: Int, val at: Long)

/** Points gagnés par une équipe sur une question ([points] inclut déjà le bonus et le doublement). */
data class Award(val choice: Int?, val correct: Boolean, val points: Int, val bonus: Int)

/*
 * Mimes : une manche entière jouée équipe par équipe. La régie choisit l'équipe et lance son tour ;
 * chaque mime trouvé rapporte [Scoring.MIME] points et fait apparaître la carte suivante.
 */

/** Tour de l'équipe [team] lancé : le chrono du tour démarre, la première carte s'affiche. */
data class MimeTurnStarted(override val seq: Int, override val at: Long, val team: String) : GameEvent

/** Mime trouvé, validé par l'animatrice : un point pour l'équipe qui joue, carte suivante. */
data class MimeFound(override val seq: Int, override val at: Long) : GameEvent

/** Carte passée, sans point : elle repart sous le paquet. */
data class MimePassed(override val seq: Int, override val at: Long) : GameEvent

/** Correction de l'animatrice (+1 ou −1) sur les mimes trouvés par [team] pendant cette manche, jamais sous zéro. */
data class MimeCorrected(override val seq: Int, override val at: Long, val team: String, val delta: Int) : GameEvent

/** Fin du tour : chrono écoulé, paquet épuisé ou arrêt par l'animatrice. */
data class MimeTurnEnded(override val seq: Int, override val at: Long) : GameEvent

/**
 * Saut de la régie vers la question [index] (début d'un jeu de la prestation), en avant comme en arrière.
 * Les points des questions [clear] sont retirés : un jeu rejoué ne compte jamais deux fois.
 */
data class Jumped(override val seq: Int, override val at: Long, val index: Int, val qid: String, val clear: List<String> = emptyList()) : GameEvent
