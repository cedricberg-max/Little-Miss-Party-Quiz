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
            else -> null
        }
    }.getOrNull()

    private fun Map<*, *>.num(k: String): Long = (this[k] as Number).toLong()

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
            // Buzzer de test du salon d'attente : la box incrémente le tour pour réarmer.
            "round" to buzzRound,
            "buzzOpen" to (s.phase == Phase.LOBBY),
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
                "choices" to q.choices,
                "durationMs" to q.durationMs,
                "deadline" to game.deadline(),
                "remainingMs" to if (s.paused) (q.durationMs - s.elapsedAt(Long.MAX_VALUE)).coerceAtLeast(0) else null,
                "correct" to if (revealed) q.correct else null,
                "awards" to if (revealed) s.awards[q.id]?.mapValues { (_, a) ->
                    mapOf("correct" to a.correct, "points" to a.points, "bonus" to a.bonus)
                } else null,
            )
        }
        return out
    }
}
