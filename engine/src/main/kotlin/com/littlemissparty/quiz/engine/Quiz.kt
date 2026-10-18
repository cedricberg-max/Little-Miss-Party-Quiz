package com.littlemissparty.quiz.engine

/** Type d'épreuve d'une question. Les mini-jeux s'ajouteront ici. */
enum class QuestionKind(val code: String) {
    /** Quatre propositions, une seule bonne. */
    CLASSIC("classic"),

    /** Deux propositions : Vrai ou Faux. */
    TRUE_FALSE("true_false");

    companion object {
        fun of(code: String?): QuestionKind = entries.firstOrNull { it.code == code } ?: CLASSIC
    }
}

data class Question(
    val id: String,
    val text: String,
    val choices: List<String>,
    val correct: Int,
    val durationSec: Int = 20,
    val kind: QuestionKind = QuestionKind.CLASSIC,
    /** Question de Super Finale : points doublés. */
    val double: Boolean = false,
    /** Manche de la prestation (titre affiché sur le conducteur de la régie). */
    val roundTitle: String? = null,
) {
    init {
        require(id.isNotBlank()) { "Question sans identifiant" }
        require(text.isNotBlank()) { "Question $id : texte vide" }
        require(choices.size in 2..4) { "Question $id : il faut 2 à 4 propositions" }
        require(choices.none { it.isBlank() }) { "Question $id : proposition vide" }
        require(correct in choices.indices) { "Question $id : bonne réponse hors des propositions" }
        require(durationSec in 5..120) { "Question $id : durée entre 5 et 120 s" }
    }

    val durationMs: Long get() = durationSec * 1000L
}

data class Quiz(val id: String, val title: String, val questions: List<Question>) {
    init {
        require(questions.isNotEmpty()) { "Quiz $id : aucune question" }
        val dup = questions.groupBy { it.id }.filter { it.value.size > 1 }.keys
        require(dup.isEmpty()) { "Quiz $id : identifiants en double $dup" }
    }
}
