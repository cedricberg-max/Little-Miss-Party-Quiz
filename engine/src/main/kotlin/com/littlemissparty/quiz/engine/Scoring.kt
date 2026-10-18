package com.littlemissparty.quiz.engine

import kotlin.math.roundToInt

/**
 * Barème pensé pour les enfants : jamais de points négatifs, une bonne réponse
 * vaut toujours au moins [BASE], la rapidité ne rapporte qu'un petit bonus.
 */
object Scoring {
    const val BASE = 100
    const val MAX_BONUS = 20

    /**
     * @param remainingFraction part du temps qui restait quand la réponse est arrivée (0 à 1).
     */
    fun award(question: Question, answer: Answer?, remainingFraction: Double): Award {
        if (answer == null) return Award(choice = null, correct = false, points = 0, bonus = 0)
        if (answer.choice != question.correct) return Award(answer.choice, correct = false, points = 0, bonus = 0)
        val bonus = (MAX_BONUS * remainingFraction.coerceIn(0.0, 1.0)).roundToInt()
        val factor = if (question.double) 2 else 1
        return Award(answer.choice, correct = true, points = (BASE + bonus) * factor, bonus = bonus * factor)
    }
}
