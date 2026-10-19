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
            is FactorChosen -> mapOf("type" to "factor", "start" to e.start, "factor" to e.factor)
            is DoorOpened -> mapOf("type" to "door", "qid" to e.qid)
            is DoorSet -> mapOf("type" to "doorset", "qid" to e.qid, "door" to e.door, "value" to e.value)
            is ScoreAdjusted -> mapOf("type" to "adjust", "team" to e.team, "delta" to e.delta, "reason" to e.reason)
            is Undone -> mapOf("type" to "undo", "target" to e.target)
            is GameEnded -> mapOf("type" to "end")
            is MimeTurnStarted -> mapOf("type" to "mime_start", "team" to e.team)
            is PictoShown -> mapOf("type" to "picto_show", "team" to e.team)
            is PictoChosen -> mapOf("type" to "picto_choose", "choice" to e.choice)
            is MimeFound -> mapOf("type" to "mime_found")
            is MimePassed -> mapOf("type" to "mime_pass")
            is MimeCorrected -> mapOf("type" to "mime_fix", "team" to e.team, "delta" to e.delta)
            is MimeTurnEnded -> mapOf("type" to "mime_stop")
            is Buzzed -> mapOf("type" to "buzz", "team" to e.team)
            is BuzzArmed -> mapOf("type" to "buzz_armed")
            is BlindPlayed -> if (e.unblock) mapOf("type" to "blind_play", "unblock" to true) else mapOf("type" to "blind_play")
            is BlindStopped -> mapOf("type" to "blind_stop")
            is BuzzUnblocked -> mapOf("type" to "buzz_unblock")
            is BlindSkipped -> mapOf("type" to "blind_skip", "qid" to e.qid)
            is RevealCut -> mapOf("type" to "reveal_cut", "qid" to e.qid)
            is BuzzJudged -> if (e.bonus) mapOf("type" to "buzz_judge", "ok" to e.ok, "bonus" to true) else mapOf("type" to "buzz_judge", "ok" to e.ok)
            is StatuesWon -> mapOf("type" to "statues_win", "team" to e.team, "others" to e.others.ifEmpty { null })
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
            "factor" -> FactorChosen(seq, at, m.num("start").toInt(), m.num("factor").toInt())
            "door" -> DoorOpened(seq, at, m["qid"] as String)
            "doorset" -> DoorSet(seq, at, m["qid"] as String, m.num("door").toInt(), m.num("value").toInt())
            "adjust" -> ScoreAdjusted(seq, at, m["team"] as String, m.num("delta").toInt(), m["reason"] as? String ?: "")
            "undo" -> Undone(seq, at, m.num("target").toInt())
            "end" -> GameEnded(seq, at)
            "mime_start" -> MimeTurnStarted(seq, at, m["team"] as String)
            "picto_show" -> PictoShown(seq, at, m["team"] as String)
            "picto_choose" -> PictoChosen(seq, at, m.num("choice").toInt())
            "mime_found" -> MimeFound(seq, at)
            "mime_pass" -> MimePassed(seq, at)
            "mime_fix" -> MimeCorrected(seq, at, m["team"] as String, m.num("delta").toInt())
            "mime_stop" -> MimeTurnEnded(seq, at)
            "buzz" -> Buzzed(seq, at, m["team"] as String)
            "buzz_armed" -> BuzzArmed(seq, at)
            "blind_play" -> BlindPlayed(seq, at, m["unblock"] == true)
            "blind_stop" -> BlindStopped(seq, at)
            "buzz_unblock" -> BuzzUnblocked(seq, at)
            "blind_skip" -> BlindSkipped(seq, at, m["qid"] as String)
            "reveal_cut" -> RevealCut(seq, at, m["qid"] as String)
            "statues_win" -> StatuesWon(seq, at, m["team"] as String, (m["others"] as? List<*>).orEmpty().map { it as String })
            "buzz_judge" -> BuzzJudged(seq, at, m["ok"] == true, m["bonus"] == true)
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
        return "${s.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-${s.openedAt ?: 0}-${b.tries}"
    }

    /**
     * Manche de mimes (encore publiée au classement qui la suit) : équipe qui joue, carte affichée (mot et image), compteurs du tour, bilan du dernier
     * tour et mimes trouvés par équipe dans la manche. Seule la carte affichée est publiée, jamais le paquet.
     */
    private fun mimeState(game: Game, m: MimeRound?): Map<String, Any?> = mapOf(
        "team" to m?.team,
        "card" to game.mimeCard?.let(::cardMap),
        "found" to (m?.found ?: 0),
        "passed" to (m?.passed ?: 0),
        "left" to (m?.deck?.size ?: 0),
        "turns" to m?.turns.orEmpty(),
        "last" to m?.last?.let { mapOf("team" to it.team, "found" to it.found, "passed" to it.passed, "word" to game.lastCard?.word, "image" to game.lastCard?.image) + listOfNotNull(game.lastCard?.imageId?.let { "imageId" to it }) },
        "points" to game.state.qid?.let(game.state::pointsPerFound),
        "counts" to game.state.mimes[game.state.qid].orEmpty(),
        // Pictionary : équipe qui découvre son mot, et clé du dessin du tour (en cours ou dernier) dans `drawing/`.
        "secret" to m?.secret,
        "offer" to game.offerCards.map(::cardMap).ifEmpty { null },
        "chosen" to m?.takeIf { it.secret != null }?.pick?.let { m.offer.indexOf(it) },
        "pickKey" to pickKey(game),
        "drawKey" to drawKey(game),
    )

    /** Carte de mime ou de Pictionary : mot, émoji, et photo seulement si elle existe. */
    private fun cardMap(c: MimeCard): Map<String, Any?> = mapOf("word" to c.word, "image" to c.image) + listOfNotNull(c.imageId?.let { "imageId" to it })

    /** Pictionary : clé où la tablette du dessinateur écrit son choix (`pictoChoice/`) : manche et heure de la proposition. */
    fun pickKey(game: Game): String? {
        val m = game.state.mime ?: return null
        if (m.secret == null || game.question?.isPicto != true) return null
        return "${game.state.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-${m.shownAt}"
    }

    /** Pictionary : clé du dessin du tour en cours (ou du dernier tour) : manche et heure de départ du tour. */
    fun drawKey(game: Game): String? {
        val started = game.state.mime?.started ?: return null
        if (game.question?.isPicto != true) return null
        return "${game.state.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-$started"
    }

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
            "buzzOpen" to (s.phase == Phase.LOBBY || (buzzKey(game) != null && !s.buzzHeld && !s.paused && s.buzz?.armed != false && s.buzz?.waiting != true)),
            "paused" to s.paused,
            // Les pupitres voient seulement qu'il y a une pause ; la régie lit aussi l'équipe concernée.
            "pauseReason" to s.hold?.reason,
            "pauseTeam" to s.hold?.team,
            "resumeAt" to s.resumeAt,
        )
        // Dernières questions du quiz : la régie propose le multiplicateur juste avant la première.
        game.factorChoice()?.let { start -> out["factorChoice"] = mapOf("start" to start, "factor" to (s.factors[start] ?: FACTORS.first())) }
        if (q != null && s.phase != Phase.ENDED) {
            game.gameStep()?.let { out["game"] = mapOf("title" to it.title, "n" to it.n, "of" to it.of, "label" to it.label) }
            out += mapOf(
                "index" to s.index,
                "qid" to q.id,
                "kind" to q.kind.code,
                "double" to q.double,
                "factor" to game.factorOf(s.index).takeIf { q.double },
                // Annonce « × N » de la TV avant la première question multipliée : les pupitres attendent avec elle.
                "intro" to game.multiplierIntroUntil(),
                "text" to q.text,
                // Jeux au buzzer : réponse à voix haute, les propositions (qui contiennent la réponse) restent cachées.
                "choices" to if (q.isBuzz && !revealed) null else q.choices,
                // Réponses en images : la photo de chaque proposition ("" pour une proposition en texte).
                "choiceImages" to q.choiceImages.takeIf { q.hasChoiceImages && !(q.isBuzz && !revealed) }?.map { it ?: "" },
                "durationMs" to q.durationMs,
                "deadline" to game.deadline(),
                "remainingMs" to if (!q.isPortes && (s.paused || s.buzzHeld || s.buzz?.waiting == true)) (q.durationMs - s.elapsedAt(Long.MAX_VALUE)).coerceAtLeast(0) else null,
                "correct" to if (revealed && !q.isPortes) q.correct else null,
                // L'émoji d'illustration peut trahir la réponse : seulement une fois révélée.
                "image" to if (revealed) q.emoji else null,
                "artist" to if (revealed) q.artist else null,
                "awards" to if (revealed) s.awards[q.id]?.mapValues { (_, a) ->
                    mapOf("correct" to a.correct, "points" to a.points, "bonus" to a.bonus)
                } else null,
            )
            if (q.isPortes) out["portes"] = portesState(game)
            if (q.isTurns) out["mime"] = mimeState(game, s.mime)
            if (q.isBlind) out["blind"] = blindState(game)
            s.buzz?.let {
                val rebuzz = game.rebuzzAt()
                out["buzz"] = mapOf("team" to it.team, "blocked" to it.blocked, "rebuzzAt" to rebuzz)
                // Même liste en table : les règles de la base refusent le buzz d'une équipe déjà bloquée. Au blind test,
                // l'heure (serveur) à partir de laquelle elle peut rebuzzer sur le même morceau.
                out["buzzBlocked"] = it.blocked.associateWith { rebuzz ?: true }.ifEmpty { null }
            }
        }
        return out
    }

    /**
     * Portes mystères, pour la TV, la régie et les pupitres : rien n'est dit avant la révélation ; ensuite l'ordre
     * d'ouverture, le nombre de portes ouvertes, la valeur des seules portes ouvertes et le choix de chaque équipe.
     */
    fun portesState(game: Game): Map<String, Any?> {
        val q = game.question ?: return emptyMap()
        val s = game.state
        if (s.phase != Phase.REVEAL && s.phase != Phase.SCORES) return mapOf("count" to q.choices.size)
        val order = game.doorOrder()
        val open = order.take(s.doorsOpened).toSet()
        return mapOf(
            "count" to q.choices.size,
            "order" to order,
            "opened" to s.doorsOpened,
            "values" to game.doorsOf(q).mapIndexed { i, v -> if (i in open) v else null }.withIndex().filter { it.value != null }
                .associate { it.index.toString() to it.value },
            "picks" to s.awards[q.id].orEmpty().mapValues { it.value.choice },
        )
    }

    /**
     * Blind test, pour la régie et les pupitres : la valeur du morceau, la musique en attente de relance, et le
     * statut de chaque morceau de la playlist (sans titre ni artiste : ils restent dans le conducteur de la régie).
     */
    fun blindState(game: Game): Map<String, Any?> {
        val s = game.state
        val q = game.question ?: return emptyMap()
        return mapOf(
            "points" to q.trackPoints * (if (q.double) 2 else 1),
            "waiting" to (s.buzz?.waiting == true),
            "played" to s.segments.isNotEmpty(),
            "cut" to (s.revealCut == q.id),
            "tracks" to game.blindTracks().map { mapOf("qid" to it.qid, "points" to it.points, "status" to it.status.code, "team" to it.team) },
        )
    }
}
