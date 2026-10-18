package com.littlemissparty.quiz.engine

/** Type d'épreuve d'une question. Les mini-jeux s'ajouteront ici. */
enum class QuestionKind(val code: String) {
    /** Quatre propositions, une seule bonne. */
    CLASSIC("classic"),

    /** Deux propositions : Vrai ou Faux. */
    TRUE_FALSE("true_false"),

    /** Mimes : toute une manche, jouée équipe par équipe sur un paquet de cartes ([Question.cards]). */
    MIME("mime"),

    /**
     * Le Juste Chiffre : chaque équipe tape un nombre sur son pupitre, la ou les plus proches gagnent.
     * Pas de propositions ; [Question.correct] est le nombre à trouver.
     */
    NUMBER("number"),

    /**
     * Vrai ou Faux express : une série d'affirmations (deux propositions, Vrai puis Faux) au chrono court,
     * que la TV ferme, révèle et enchaîne toute seule jusqu'à la fin de la manche.
     */
    EXPRESS("express"),

    /**
     * Zoom mystère : une question à propositions dont la photo ([Question.imageId]) part très zoomée sur la
     * TV et se dévoile au fil du chrono ; la révélation la montre entière. Points du quiz classique.
     */
    ZOOM("zoom"),

    /**
     * Image floue : la photo ([Question.imageId]) devient de plus en plus nette ; la première équipe qui
     * buzze répond à voix haute et l'animatrice valide. La réponse est la proposition [Question.correct].
     */
    FLOU("flou");

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
    /**
     * Illustration facultative montrée à la révélation : un émoji ([emoji]) ou une photo préparée dans
     * l'administration ([imageId], lue dans games/<code>/images). Absente ou introuvable : rien ne change.
     */
    val emoji: String? = null,
    val imageId: String? = null,
) {
    init {
        require(id.isNotBlank()) { "Question sans identifiant" }
        require(text.isNotBlank()) { "Question $id : texte vide" }
        if (kind == QuestionKind.MIME) {
            // Pour les mimes, la durée est celle du tour de chaque équipe.
            require(cards.size in 1..MAX_MIME_CARDS) { "Mimes $id : il faut 1 à $MAX_MIME_CARDS cartes" }
            require(cards.none { it.word.isBlank() }) { "Mimes $id : carte sans mot" }
            require(durationSec in 15..180) { "Mimes $id : tour entre 15 et 180 s" }
        } else if (kind == QuestionKind.NUMBER) {
            require(choices.isEmpty()) { "Juste Chiffre $id : pas de propositions" }
            require(correct in -MAX_NUMBER..MAX_NUMBER) { "Juste Chiffre $id : nombre hors limites" }
            require(durationSec in 5..120) { "Question $id : durée entre 5 et 120 s" }
        } else {
            require(choices.size in 2..4) { "Question $id : il faut 2 à 4 propositions" }
            require(kind != QuestionKind.EXPRESS || choices.size == 2) { "Vrai ou Faux express $id : il faut 2 propositions" }
            require(kind != QuestionKind.ZOOM || imageId != null) { "Zoom mystère $id : il faut une photo" }
            require(kind != QuestionKind.FLOU || imageId != null) { "Image floue $id : il faut une photo" }
            require(choices.none { it.isBlank() }) { "Question $id : proposition vide" }
            require(correct in choices.indices) { "Question $id : bonne réponse hors des propositions" }
            require(durationSec in 5..120) { "Question $id : durée entre 5 et 120 s" }
        }
    }

    val isMime: Boolean get() = kind == QuestionKind.MIME
    val isNumber: Boolean get() = kind == QuestionKind.NUMBER
    val isExpress: Boolean get() = kind == QuestionKind.EXPRESS
    val isZoom: Boolean get() = kind == QuestionKind.ZOOM
    val isFlou: Boolean get() = kind == QuestionKind.FLOU

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

/** Le Juste Chiffre : nombres de -999 999 999 à 999 999 999 (ce que le pupitre laisse taper). */
const val MAX_NUMBER = 999_999_999
