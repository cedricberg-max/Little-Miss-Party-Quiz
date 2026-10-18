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
data class Paused(override val seq: Int, override val at: Long) : GameEvent
data class Resumed(override val seq: Int, override val at: Long) : GameEvent

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
