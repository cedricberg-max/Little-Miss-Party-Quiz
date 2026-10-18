package com.littlemissparty.quiz.engine

import org.json.JSONArray
import org.json.JSONObject

/**
 * Lecture d'un quiz au format JSON :
 * `{"id", "title", "questions": [{"id", "text", "choices": [...], "correct", "duration", "kind", "double", "round"}]}`,
 * plus `"cards": [{"word", "image"}]` pour une manche de mimes (`"kind": "mime"`, sans propositions),
 * et l'illustration facultative d'une question : `"image"` (émoji) et `"imageId"` (photo).
 * Toute erreur est signalée avec la question concernée, pour pouvoir la corriger.
 */
object QuizJson {
    /** Identifiant d'une photo d'illustration : empreinte de son contenu, 16 caractères hexadécimaux. */
    val IMAGE_ID = Regex("[0-9a-f]{16}")

    fun parse(json: String): Quiz = parse(JSONObject(json))

    /**
     * Quiz relu dans Firebase (instantané de prestation chargé par la régie) : des Map, des List
     * et des Long au lieu d'un texte JSON. Mêmes vérifications que pour un fichier.
     */
    fun fromValue(value: Any?): Quiz {
        require(value is Map<*, *>) { "Prestation sans quiz" }
        return parse(JSONObject(value))
    }

    private fun parse(o: JSONObject): Quiz {
        val questions = o.getJSONArray("questions")
        return Quiz(
            id = o.getString("id"),
            title = o.optString("title", o.getString("id")),
            questions = (0 until questions.length()).map { i -> question(questions.getJSONObject(i), i) },
        )
    }

    private fun question(q: JSONObject, i: Int): Question {
        val imageId = q.optString("imageId").takeIf { it.matches(IMAGE_ID) }
        // Zoom mystère ou image floue sans photo valable : la question se joue comme une question classique.
        val kind = QuestionKind.of(q.optString("kind"))
            .let { if ((it == QuestionKind.ZOOM || it == QuestionKind.FLOU) && imageId == null) QuestionKind.CLASSIC else it }
        val choices: JSONArray = q.optJSONArray("choices") ?: JSONArray()
        val cards: JSONArray = q.optJSONArray("cards") ?: JSONArray()
        return Question(
            id = q.optString("id", "q${i + 1}"),
            text = q.getString("text"),
            choices = (0 until choices.length()).map { choices.getString(it).trim() },
            correct = if (kind == QuestionKind.MIME) q.optInt("correct", -1) else q.getInt("correct"),
            durationSec = q.optInt("duration", if (kind == QuestionKind.MIME) 60 else 20),
            kind = kind,
            double = q.optBoolean("double", false),
            roundTitle = q.optString("round").ifBlank { null },
            cards = (0 until cards.length()).map { c ->
                val card = cards.getJSONObject(c)
                MimeCard(card.getString("word").trim(), card.optString("image").ifBlank { null })
            },
            // Une illustration mal formée est ignorée : elle ne doit jamais empêcher de jouer.
            emoji = q.optString("image").trim().takeIf { it.isNotEmpty() && it.length <= 16 && kind != QuestionKind.MIME },
            imageId = imageId?.takeIf { kind != QuestionKind.MIME },
        )
    }
}
