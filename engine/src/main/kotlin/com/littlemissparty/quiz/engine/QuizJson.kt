package com.littlemissparty.quiz.engine

import org.json.JSONArray
import org.json.JSONObject

/**
 * Lecture d'un quiz au format JSON :
 * `{"id", "title", "questions": [{"id", "text", "choices": [...], "correct", "duration", "kind", "double"}]}`.
 * Toute erreur est signalée avec la question concernée, pour pouvoir la corriger.
 */
object QuizJson {
    fun parse(json: String): Quiz {
        val o = JSONObject(json)
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
        )
    }
}
