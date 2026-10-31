package com.littlemissparty.quiz.engine

import kotlin.math.roundToInt

/**
 * Barème pensé pour les enfants : jamais de points négatifs, une bonne réponse
 * vaut toujours au moins [BASE], la rapidité ne rapporte qu'un petit bonus.
 */
object Scoring {
    const val BASE = 100
    const val MAX_BONUS = 20

    /** Mime trouvé (validé par l'animatrice). */
    const val MIME = 50

    /** Pictionary : dessin trouvé par l'équipe qui joue (validé par l'animatrice), quand l'administration n'en donne pas. */
    const val PICTO = 150

    /**
     * @param remainingFraction part du temps qui restait quand la réponse est arrivée (0 à 1).
     */
    fun award(question: Question, answer: Answer?, remainingFraction: Double, factor: Int = if (question.double) 2 else 1): Award {
        if (answer == null) return Award(choice = null, correct = false, points = 0, bonus = 0)
        if (answer.choice != question.correct) return Award(answer.choice, correct = false, points = 0, bonus = 0)
        val bonus = (MAX_BONUS * remainingFraction.coerceIn(0.0, 1.0)).roundToInt()
        return Award(answer.choice, correct = true, points = (BASE + bonus) * factor, bonus = bonus * factor)
    }

    /** Buzzer (image floue) : bonne réponse de la première équipe qui buzze. */
    const val BUZZ = 150

    /** Buzzer : bonne réponse après l'erreur d'une autre équipe (rebond). */
    const val BUZZ_REBOUND = 100

    /** Blind test : valeur d'un morceau quand l'administration n'en donne pas (les derniers valent souvent le double). */
    const val BLIND_POINTS = 100

    /** Mini-jeu physique (statues musicales) : l'équipe gagnante, puis chaque autre équipe qui a joué. */
    const val MINI_WIN = 300
    const val MINI_PLAYED = 150

    /** Vrai ou Faux express : chaque bonne réponse, sans bonus de vitesse. */
    const val EXPRESS = 50

    /** Vrai ou Faux express : [EXPRESS] par bonne réponse (multiplié en fin de quiz), rien sinon. */
    fun awardExpress(question: Question, answer: Answer, factor: Int = if (question.double) 2 else 1): Award {
        val correct = answer.choice == question.correct
        return Award(answer.choice, correct = correct, points = if (correct) EXPRESS * factor else 0, bonus = 0)
    }

    /** Le Juste Chiffre : la ou les équipes les plus proches. */
    const val NUMBER_CLOSEST = 100

    /** Le Juste Chiffre : nombre trouvé pile. */
    const val NUMBER_EXACT = 150

    /**
     * Le Juste Chiffre : la ou les équipes les plus proches du nombre marquent [NUMBER_CLOSEST]
     * ([NUMBER_EXACT] si elles l'ont trouvé pile) ; égalité de distance = tout le monde marque.
     * La vitesse ne compte pas : pas de bonus, aucune course contre le réseau.
     */
    fun awardNumber(question: Question, answers: Map<String, Answer>, factor: Int = if (question.double) 2 else 1): Map<String, Award> {
        val distance = answers.mapValues { (_, a) -> kotlin.math.abs(a.choice.toLong() - question.correct.toLong()) }
        val best = distance.values.minOrNull()
        return answers.mapValues { (team, a) ->
            val wins = distance[team] == best
            val points = when {
                !wins -> 0
                best == 0L -> NUMBER_EXACT
                else -> NUMBER_CLOSEST
            } * factor
            Award(a.choice, correct = wins, points = points, bonus = 0)
        }
    }
}
