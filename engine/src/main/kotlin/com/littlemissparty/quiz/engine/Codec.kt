package com.littlemissparty.quiz.engine

/**
 * Conversion entre les événements et les données stockées dans Firebase
 * (des Map de String, Long, Double, Boolean). Firebase renvoie tous les nombres en Long ou Double.
 */
object Codec {

    /** Clé d'un événement dans `log/` : numérotée sur 6 chiffres pour rester triée. */
    fun key(seq: Int): String = seq.toString().padStart(6, '0')

    fun encode(e: GameEvent): Map<String, Any?> {
        val base = mapOf("seq" to e.seq, "at" to e.at)
        val body: Map<String, Any?> = when (e) {
            is QuestionOpened -> mapOf("type" to "open", "index" to e.index, "qid" to e.qid)
            is Paused -> mapOf("type" to "pause", "reason" to e.reason, "team" to e.team)
            is Resumed -> mapOf("type" to "resume", "countdownMs" to e.countdownMs)
            is QuestionClosed -> mapOf("type" to "close")
            is Revealed -> mapOf(
                "type" to "reveal",
                "qid" to e.qid,
                "awards" to e.awards.mapValues { (_, a) ->
                    mapOf("choice" to a.choice, "correct" to a.correct, "points" to a.points, "bonus" to a.bonus)
                },
            )
            is ScoresShown -> mapOf("type" to "scores")
            is ScoreAdjusted -> mapOf("type" to "adjust", "team" to e.team, "delta" to e.delta, "reason" to e.reason)
            is Undone -> mapOf("type" to "undo", "target" to e.target)
            is GameEnded -> mapOf("type" to "end")
            is MimeTurnStarted -> mapOf("type" to "mime_start", "team" to e.team)
            is MimeFound -> mapOf("type" to "mime_found")
            is MimePassed -> mapOf("type" to "mime_pass")
            is MimeCorrected -> mapOf("type" to "mime_fix", "team" to e.team, "delta" to e.delta)
            is MimeTurnEnded -> mapOf("type" to "mime_stop")
            is Buzzed -> mapOf("type" to "buzz", "team" to e.team)
            is BuzzJudged -> mapOf("type" to "buzz_judge", "ok" to e.ok)
            is Jumped -> mapOf("type" to "goto", "index" to e.index, "qid" to e.qid, "clear" to e.clear.ifEmpty { null })
        }
        return base + body
    }

    /** Renvoie null pour un événement illisible (version future, donnée abîmée) au lieu de planter la reprise. */
    fun decode(m: Map<*, *>): GameEvent? = runCatching {
        val seq = m.num("seq").toInt()
        val at = m.num("at")
        when (m["type"]) {
            "open" -> QuestionOpened(seq, at, m.num("index").toInt(), m["qid"] as String)
            // Journaux d'avant la pause générale : pause de l'animatrice, reprise sans décompte.
            "pause" -> Paused(seq, at, m["reason"] as? String ?: PAUSE_REGIE, m["team"] as? String)
            "resume" -> Resumed(seq, at, (m["countdownMs"] as? Number)?.toLong() ?: 0L)
            "close" -> QuestionClosed(seq, at)
            "reveal" -> Revealed(
                seq, at, m["qid"] as String,
                (m["awards"] as? Map<*, *>).orEmpty().entries.associate { (team, v) ->
                    val a = v as Map<*, *>
                    team as String to Award(
                        choice = (a["choice"] as? Number)?.toInt(),
                        correct = a["correct"] == true,
                        points = a.num("points").toInt(),
                        bonus = a.num("bonus").toInt(),
                    )
                },
            )
            "scores" -> ScoresShown(seq, at)
            "adjust" -> ScoreAdjusted(seq, at, m["team"] as String, m.num("delta").toInt(), m["reason"] as? String ?: "")
            "undo" -> Undone(seq, at, m.num("target").toInt())
            "end" -> GameEnded(seq, at)
            "mime_start" -> MimeTurnStarted(seq, at, m["team"] as String)
            "mime_found" -> MimeFound(seq, at)
            "mime_pass" -> MimePassed(seq, at)
            "mime_fix" -> MimeCorrected(seq, at, m["team"] as String, m.num("delta").toInt())
            "mime_stop" -> MimeTurnEnded(seq, at)
            "buzz" -> Buzzed(seq, at, m["team"] as String)
            "buzz_judge" -> BuzzJudged(seq, at, m["ok"] == true)
            "goto" -> Jumped(seq, at, m.num("index").toInt(), m["qid"] as String, (m["clear"] as? List<*>).orEmpty().map { it as String })
            else -> null
        }
    }.getOrNull()

    private fun Map<*, *>.num(k: String): Long = (this[k] as Number).toLong()

    /** Clé du buzzer de l'image floue en cours : question, ouverture (une question rejouée a sa propre clé) et essai. */
    fun buzzKey(game: Game): String? {
        val s = game.state
        val b = s.buzz ?: return null
        if (s.phase != Phase.QUESTION) return null
        // Une clé de la base ne peut pas contenir . # $ [ ] / : on les remplace dans l'identifiant de la question.
        return "${s.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-${s.openedAt ?: 0}-${b.blocked.size}"
    }

    /**
     * Manche de mimes (encore publiée au classement qui la suit) : équipe qui joue, carte affichée (mot et image), compteurs du tour, bilan du dernier
     * tour et mimes trouvés par équipe dans la manche. Seule la carte affichée est publiée, jamais le paquet.
     */
    private fun mimeState(game: Game, m: MimeRound?): Map<String, Any?> = mapOf(
        "team" to m?.team,
        "card" to game.mimeCard?.let { mapOf("word" to it.word, "image" to it.image) },
        "found" to (m?.found ?: 0),
        "passed" to (m?.passed ?: 0),
        "left" to (m?.deck?.size ?: 0),
        "turns" to m?.turns.orEmpty(),
        "last" to m?.last?.let { mapOf("team" to it.team, "found" to it.found, "passed" to it.passed) },
        "points" to Scoring.MIME,
        "counts" to game.state.mimes[game.state.qid].orEmpty(),
    )

    /**
     * Ce que les pupitres ont le droit de voir. La bonne réponse n'y figure qu'après la révélation :
     * un enfant qui inspecte la page du pupitre ne peut pas la trouver avant.
     */
    fun publicState(game: Game, buzzRound: Int = 1): Map<String, Any?> {
        val s = game.state
        val q = game.question
        val revealed = s.phase == Phase.REVEAL || s.phase == Phase.SCORES || s.phase == Phase.ENDED
        val out = linkedMapOf<String, Any?>(
            "phase" to s.phase.code,
            "seq" to s.lastSeq,
            "total" to game.quiz.questions.size,
            "scores" to s.scores(),
            // Buzzer : au salon d'attente (tour réarmé par la box), et à l'image floue tant que personne n'attend son
            // verdict. La clé change à chaque ouverture et après chaque erreur : le premier qui écrit gagne.
            "round" to (buzzKey(game) ?: buzzRound),
            "buzzOpen" to (s.phase == Phase.LOBBY || (buzzKey(game) != null && !s.buzzHeld && !s.paused)),
            "paused" to s.paused,
            // Les pupitres voient seulement qu'il y a une pause ; la régie lit aussi l'équipe concernée.
            "pauseReason" to s.hold?.reason,
            "pauseTeam" to s.hold?.team,
            "resumeAt" to s.resumeAt,
        )
        if (q != null && s.phase != Phase.ENDED) {
            out += mapOf(
                "index" to s.index,
                "qid" to q.id,
                "kind" to q.kind.code,
                "double" to q.double,
                "text" to q.text,
                // Jeux au buzzer : réponse à voix haute, les propositions (qui contiennent la réponse) restent cachées.
                "choices" to if (q.isBuzz && !revealed) null else q.choices,
                "durationMs" to q.durationMs,
                "deadline" to game.deadline(),
                "remainingMs" to if (s.paused || s.buzzHeld) (q.durationMs - s.elapsedAt(Long.MAX_VALUE)).coerceAtLeast(0) else null,
                "correct" to if (revealed) q.correct else null,
                // L'émoji d'illustration peut trahir la réponse : seulement une fois révélée.
                "image" to if (revealed) q.emoji else null,
                "awards" to if (revealed) s.awards[q.id]?.mapValues { (_, a) ->
                    mapOf("correct" to a.correct, "points" to a.points, "bonus" to a.bonus)
                } else null,
            )
            if (q.isMime) out["mime"] = mimeState(game, s.mime)
            s.buzz?.let {
                out["buzz"] = mapOf("team" to it.team, "blocked" to it.blocked)
                // Même liste en table : les règles de la base refusent le buzz d'une équipe déjà bloquée.
                out["buzzBlocked"] = it.blocked.associateWith { true }.ifEmpty { null }
            }
        }
        return out
    }
}
