package com.littlemissparty.quiz.engine

import org.json.JSONArray
import org.json.JSONObject

/**
 * Lecture d'un quiz au format JSON :
 * `{"id", "title", "questions": [{"id", "text", "choices": [...], "correct", "duration", "kind", "double", "round"}]}`.
 * Toute erreur est signalée avec la question concernée, pour pouvoir la corriger.
 */
object QuizJson {
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
        val choices: JSONArray = q.getJSONArray("choices")
        return Question(
            id = q.optString("id", "q${i + 1}"),
            text = q.getString("text"),
            choices = (0 until choices.length()).map { choices.getString(it).trim() },
            correct = q.getInt("correct"),
            durationSec = q.optInt("duration", 20),
            kind = QuestionKind.of(q.optString("kind")),
            double = q.optBoolean("double", false),
            roundTitle = q.optString("round").ifBlank { null },
        )
    }
}
