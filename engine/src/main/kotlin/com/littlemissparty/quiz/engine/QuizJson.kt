package com.littlemissparty.quiz.engine

import org.json.JSONArray
import org.json.JSONObject

/**
 * Lecture d'un quiz au format JSON :
 * `{"id", "title", "questions": [{"id", "text", "choices": [...], "correct", "duration", "kind", "double", "round"}]}`,
 * plus `"cards": [{"word", "image"}]` pour une manche de mimes ou de Pictionary (`"kind": "mime"` ou
 * `"pictionary"`, sans propositions ; `"points"` : valeur d'un dessin trouvé),
 * l'illustration facultative d'une question : `"image"` (émoji) et `"imageId"` (photo), des réponses en images
 * (`"choiceImages"`, une photo par proposition), les valeurs des Portes mystères (`"doors"`), et pour la
 * musique `"audioId"` (extrait), `"artist"`, `"refrainId"` et `"lyrics"` (blind test et quiz musical).
 * Toute erreur est signalée avec la question concernée, pour pouvoir la corriger.
 */
object QuizJson {
    /** Identifiant d'une photo d'illustration : empreinte de son contenu, 16 caractères hexadécimaux. */
    val IMAGE_ID = Regex("[0-9a-f]{16}")

    /** Longueur maximale du nom d'artiste (blind test). */
    const val MAX_ARTIST = 80

    /** Statues musicales : au plus autant de chansons dans une manche. */
    const val MAX_STATUES_SONGS = 20

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
            intros = o.optBoolean("intros", false),
        )
    }

    /** Kinds de questions dont les propositions peuvent être des photos (QCM et Vrai / Faux ordinaires). */
    private val IMAGE_CHOICE_KINDS = setOf(QuestionKind.CLASSIC, QuestionKind.TRUE_FALSE)

    /**
     * Une photo par proposition (`"choiceImages": ["<id>", null, …]`) ; une photo mal formée est ignorée, et rien
     * n'est gardé si aucune n'est valable ou si la question n'est pas un QCM : jamais un refus de jouer.
     */
    private fun choiceImages(list: JSONArray?, count: Int, kind: QuestionKind): List<String?> {
        if (list == null || kind !in IMAGE_CHOICE_KINDS) return emptyList()
        val ids = (0 until count).map { k -> list.optString(k).takeIf { it.matches(IMAGE_ID) } }
        return if (ids.any { it != null }) ids else emptyList()
    }

    private fun question(q: JSONObject, i: Int): Question {
        val imageId = q.optString("imageId").takeIf { it.matches(IMAGE_ID) }
        // Zoom mystère ou image floue sans photo valable : la question se joue comme une question classique.
        val kind = QuestionKind.of(q.optString("kind"))
            .let { if ((it == QuestionKind.ZOOM || it == QuestionKind.FLOU) && imageId == null) QuestionKind.CLASSIC else it }
        val choices: JSONArray = q.optJSONArray("choices") ?: JSONArray()
        val cards: JSONArray = q.optJSONArray("cards") ?: JSONArray()
        val turns = kind == QuestionKind.MIME || kind == QuestionKind.PICTIONARY
        val doors: JSONArray = q.optJSONArray("doors") ?: JSONArray()
        // Blind test, ou Quiz musical (question à propositions avec un extrait) : l'artiste, le refrain et ses paroles
        // de la révélation (cedric, 24/10 : la révélation du Quiz musical reprend celle du blind test, en plus court).
        val chanson = kind == QuestionKind.BLIND || (kind == QuestionKind.CLASSIC && q.optString("audioId").matches(IMAGE_ID))
        return Question(
            id = q.optString("id", "q${i + 1}"),
            text = q.getString("text"),
            choices = (0 until choices.length()).map { choices.getString(it).trim() },
            correct = if (turns || kind == QuestionKind.STATUES || kind == QuestionKind.PORTES || kind == QuestionKind.COFFRES || kind == QuestionKind.GONFLEUR || kind == QuestionKind.PATATE) q.optInt("correct", -1) else q.getInt("correct"),
            durationSec = q.optInt("duration", if (kind == QuestionKind.PICTIONARY) 90 else if (turns) 60 else if (kind == QuestionKind.GONFLEUR) 45 else 20),
            kind = kind,
            double = q.optBoolean("double", false),
            roundTitle = q.optString("round").ifBlank { null },
            cards = (0 until cards.length()).map { c ->
                val card = cards.getJSONObject(c)
                // Photo du mot (Pictionary, préparée dans l'administration) : ignorée si mal formée.
                MimeCard(card.getString("word").trim(), card.optString("image").ifBlank { null }, card.optString("imageId").takeIf { IMAGE_ID.matches(it) })
            },
            // Une illustration mal formée est ignorée : elle ne doit jamais empêcher de jouer.
            emoji = q.optString("image").trim().takeIf { it.isNotEmpty() && it.length <= 16 && !turns },
            imageId = imageId?.takeIf { !turns },
            choiceImages = choiceImages(q.optJSONArray("choiceImages"), choices.length(), kind),
            doors = if (kind == QuestionKind.PORTES) (0 until doors.length()).map { doors.getInt(it) } else emptyList(),
            artist = q.optString("artist").trim().takeIf { it.isNotEmpty() && chanson }?.take(MAX_ARTIST),
            audioId = q.optString("audioId").takeIf { it.matches(IMAGE_ID) && !turns },
            refrainId = q.optString("refrainId").takeIf { it.matches(IMAGE_ID) && chanson },
            // Paroles du refrain : seulement avec un refrain, et jamais trop longues.
            lyrics = q.optString("lyrics").takeIf { it.isNotBlank() && it.length <= MAX_PAROLES && chanson && q.optString("refrainId").matches(IMAGE_ID) },
            audioIds = q.optJSONArray("audioIds")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
                .filter { it.matches(IMAGE_ID) && kind == QuestionKind.STATUES }.distinct().take(MAX_STATUES_SONGS),
            points = q.optInt("points", 0).takeIf { it > 0 && (kind == QuestionKind.BLIND || kind == QuestionKind.PICTIONARY) }?.coerceAtMost(MAX_TRACK_POINTS),
            // 0 : tout l'extrait à la révélation (le temps de chanter le refrain).
            revealSec = q.optInt("reveal", BLIND_REVEAL_SEC).let { if (it == 0) 0 else it.coerceIn(3, 60) },
        )
    }
}
