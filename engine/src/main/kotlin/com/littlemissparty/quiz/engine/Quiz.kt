package com.littlemissparty.quiz.engine

/** Type d'épreuve d'une question. Les mini-jeux s'ajouteront ici. */
enum class QuestionKind(val code: String) {
    /** Quatre propositions, une seule bonne. */
    CLASSIC("classic"),

    /** Deux propositions : Vrai ou Faux. */
    TRUE_FALSE("true_false"),

    /** Mimes : toute une manche, jouée équipe par équipe sur un paquet de cartes ([Question.cards]). */
    MIME("mime");

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
    /** Mimes seulement : les cartes, dans l'ordre où elles apparaîtront. */
    val cards: List<MimeCard> = emptyList(),
) {
    init {
        require(id.isNotBlank()) { "Question sans identifiant" }
        require(text.isNotBlank()) { "Question $id : texte vide" }
        if (kind == QuestionKind.MIME) {
            // Pour les mimes, la durée est celle du tour de chaque équipe.
            require(cards.size in 1..MAX_MIME_CARDS) { "Mimes $id : il faut 1 à $MAX_MIME_CARDS cartes" }
            require(cards.none { it.word.isBlank() }) { "Mimes $id : carte sans mot" }
            require(durationSec in 15..180) { "Mimes $id : tour entre 15 et 180 s" }
        } else {
            require(choices.size in 2..4) { "Question $id : il faut 2 à 4 propositions" }
            require(choices.none { it.isBlank() }) { "Question $id : proposition vide" }
            require(correct in choices.indices) { "Question $id : bonne réponse hors des propositions" }
            require(durationSec in 5..120) { "Question $id : durée entre 5 et 120 s" }
        }
    }

    val isMime: Boolean get() = kind == QuestionKind.MIME

    val durationMs: Long get() = durationSec * 1000L
}

data class Quiz(val id: String, val title: String, val questions: List<Question>) {
    init {
        require(questions.isNotEmpty()) { "Quiz $id : aucune question" }
        val dup = questions.groupBy { it.id }.filter { it.value.size > 1 }.keys
        require(dup.isEmpty()) { "Quiz $id : identifiants en double $dup" }
    }
}

/** Carte de mime : le mot à faire deviner et son image (un emoji du catalogue intégré, facultatif). */
data class MimeCard(val word: String, val image: String? = null)

const val MAX_MIME_CARDS = 200
