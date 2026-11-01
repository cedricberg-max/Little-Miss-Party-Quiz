package com.littlemissparty.quiz.engine

/**
 * Conversion entre les événements et les données stockées dans Firebase
 * (des Map de String, Long, Double, Boolean). Firebase renvoie tous les nombres en Long ou Double.
 */
/** Phase publiée pendant l'écran de présentation d'un jeu (la question est ouverte mais rien n'a commencé). */
const val PHASE_INTRO = "intro"

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
            is GameLeft -> mapOf("type" to "leave", "qid" to e.qid)
            is FactorChosen -> mapOf("type" to "factor", "start" to e.start, "factor" to e.factor)
            is GameLaunched -> mapOf("type" to "launch")
            is ChestsDealt -> mapOf("type" to "chests", "qid" to e.qid, "order" to e.order, "count" to e.count, "safe" to e.safe)
            is ChestOpened -> mapOf("type" to "chest", "qid" to e.qid, "team" to e.team, "chest" to e.chest, "delta" to e.delta, "bomb" to e.bomb, "gold" to e.gold)
            is ScoreAdjusted -> mapOf("type" to "adjust", "team" to e.team, "delta" to e.delta, "reason" to e.reason)
            is Undone -> mapOf("type" to "undo", "target" to e.target)
            is GameEnded -> mapOf("type" to "end")
            is OutroLaunched -> mapOf("type" to "outro")
            is MimeTurnStarted -> mapOf("type" to "mime_start", "team" to e.team)
            is PictoShown -> mapOf("type" to "picto_show", "team" to e.team)
            is PictoChosen -> mapOf("type" to "picto_choose", "choice" to e.choice)
            is MimeFound -> mapOf("type" to "mime_found")
            is MimePassed -> mapOf("type" to "mime_pass")
            is MimeSkipped -> mapOf("type" to "mime_skip")
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
            is StatuesStopped -> mapOf("type" to "statues_stop", "qid" to e.qid)
            is StatuesDanced -> mapOf("type" to "statues_play", "qid" to e.qid)
            is StatuesSongEnded -> mapOf("type" to "statues_end", "qid" to e.qid, "song" to e.song)
            is StatuesSongWon -> mapOf(
                "type" to "statues_song_win", "qid" to e.qid, "song" to e.song, "winners" to e.winners.ifEmpty { null },
                "others" to e.others.ifEmpty { null },
            )
            is StatuesSongStarted -> mapOf("type" to "statues_song", "qid" to e.qid, "song" to e.song)
            is PotatoLit -> mapOf("type" to "potato", "qid" to e.qid, "holder" to e.holder, "fuseMs" to e.fuseMs, "teams" to e.teams, "bomb" to e.bomb, "total" to e.total)
            is PotatoStopped -> mapOf("type" to "potato_stop", "qid" to e.qid)
            is PotatoPassed -> mapOf("type" to "potato_pass", "qid" to e.qid, "from" to e.from, "to" to e.to)
            is PotatoExploded -> mapOf("type" to "potato_boom", "qid" to e.qid, "holder" to e.holder)
            is BalloonBurst -> mapOf("type" to "balloon", "qid" to e.qid, "team" to e.team, "teams" to e.teams)
            is DuelReady -> mapOf("type" to "duel_ready", "qid" to e.qid, "n" to e.n, "teams" to e.teams, "players" to e.players, "extra" to e.extra.takeIf { it })
            is DuelStarted -> mapOf("type" to "duel_start", "qid" to e.qid, "n" to e.n, "panAt" to e.panAt)
            is DuelBuzzed -> mapOf("type" to "duel_buzz", "qid" to e.qid, "n" to e.n, "team" to e.team, "t" to e.t)
            is DuelSettled -> mapOf("type" to "duel_settle", "qid" to e.qid, "n" to e.n)
            is DuelStopped -> mapOf("type" to "duel_stop", "qid" to e.qid, "n" to e.n)
            is DuelPlanned -> mapOf("type" to "duel_plan", "qid" to e.qid, "counts" to e.counts.ifEmpty { null }, "manual" to e.manual.takeIf { it })
            is DuelPanShown -> mapOf("type" to "duel_pan", "qid" to e.qid, "n" to e.n, "shownAt" to e.shownAt)
            is ChronoReady -> mapOf("type" to "chrono_ready", "qid" to e.qid, "tour" to e.tour, "cible" to e.cible)
            is ChronoTargetSet -> mapOf("type" to "chrono_cible", "qid" to e.qid, "tour" to e.tour, "cible" to e.cible)
            is ChronoStarted -> mapOf("type" to "chrono_start", "qid" to e.qid, "tour" to e.tour, "goAt" to e.goAt, "cacheMs" to e.cacheMs, "teams" to e.teams) + listOfNotNull(("manuel" to true).takeIf { e.manuel })
            is ChronoBuzzed -> mapOf("type" to "chrono_buzz", "qid" to e.qid, "tour" to e.tour, "team" to e.team, "t" to e.t)
            is ChronoShown -> mapOf("type" to "chrono_shown", "qid" to e.qid, "tour" to e.tour, "shownAt" to e.shownAt)
            is ChronoSettled -> mapOf("type" to "chrono_settle", "qid" to e.qid, "tour" to e.tour, "force" to e.force.takeIf { it })
            is ChronoStopped -> mapOf("type" to "chrono_stop", "qid" to e.qid, "tour" to e.tour)
            is SimonTourReady -> mapOf("type" to "simon_tour", "qid" to e.qid, "tour" to e.tour, "sequence" to e.sequence.joinToString(","), "teams" to e.teams)
            is SimonSuiteStarted -> mapOf("type" to "simon_start", "qid" to e.qid, "tour" to e.tour, "suite" to e.suite)
            // Réponses : les éléments tapés en une chaîne (« rouge,vert,4 »), absents si rien n'a été tapé.
            is SimonJudged -> mapOf(
                "type" to "simon_judge", "qid" to e.qid, "tour" to e.tour, "suite" to e.suite,
                "answers" to e.answers.mapValues { (_, a) -> mapOf("items" to a.items.joinToString(",").ifEmpty { null }, "ms" to a.ms) }.ifEmpty { null },
            )
            is SimonStopped -> mapOf("type" to "simon_stop", "qid" to e.qid, "tour" to e.tour, "suite" to e.suite)
            is Jumped -> mapOf("type" to "goto", "index" to e.index, "qid" to e.qid, "clear" to e.clear.ifEmpty { null })
            is ProgramReset -> mapOf("type" to "reset")
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
            "leave" -> GameLeft(seq, at, m["qid"] as String)
            "factor" -> FactorChosen(seq, at, m.num("start").toInt(), m.num("factor").toInt())
            // Ancien jeu « Portes mystères » (supprimé le 31/10, cedric) : ses événements des anciennes parties sont ignorés.
            "launch" -> GameLaunched(seq, at)
            "chests" -> ChestsDealt(seq, at, m["qid"] as String, (m["order"] as List<*>).map { it as String }, m.num("count").toInt(), m.num("safe").toInt())
            "chest" -> ChestOpened(seq, at, m["qid"] as String, m["team"] as String, m.num("chest").toInt(), m.num("delta").toInt(), m["bomb"] == true, m["gold"] == true)
            "adjust" -> ScoreAdjusted(seq, at, m["team"] as String, m.num("delta").toInt(), m["reason"] as? String ?: "")
            "undo" -> Undone(seq, at, m.num("target").toInt())
            "end" -> GameEnded(seq, at)
            "outro" -> OutroLaunched(seq, at)
            "mime_start" -> MimeTurnStarted(seq, at, m["team"] as String)
            "picto_show" -> PictoShown(seq, at, m["team"] as String)
            "picto_choose" -> PictoChosen(seq, at, m.num("choice").toInt())
            "mime_found" -> MimeFound(seq, at)
            "mime_pass" -> MimePassed(seq, at)
            "mime_skip" -> MimeSkipped(seq, at)
            "mime_fix" -> MimeCorrected(seq, at, m["team"] as String, m.num("delta").toInt())
            "mime_stop" -> MimeTurnEnded(seq, at)
            "buzz" -> Buzzed(seq, at, m["team"] as String)
            "buzz_armed" -> BuzzArmed(seq, at)
            "blind_play" -> BlindPlayed(seq, at, m["unblock"] == true)
            "blind_stop" -> BlindStopped(seq, at)
            "buzz_unblock" -> BuzzUnblocked(seq, at)
            "blind_skip" -> BlindSkipped(seq, at, m["qid"] as String)
            "reveal_cut" -> RevealCut(seq, at, m["qid"] as String)
            "potato" -> PotatoLit(
                seq, at, m["qid"] as String, m["holder"] as String, m.num("fuseMs").toLong(), (m["teams"] as List<*>).map { it as String },
                (m["bomb"] as? Number)?.toInt() ?: 1, (m["total"] as? Number)?.toInt() ?: POTATO_BOMBS,
            )
            "potato_stop" -> PotatoStopped(seq, at, m["qid"] as String)
            "potato_pass" -> PotatoPassed(seq, at, m["qid"] as String, m["from"] as String, m["to"] as String)
            "potato_boom" -> PotatoExploded(seq, at, m["qid"] as String, m["holder"] as String)
            "balloon" -> BalloonBurst(seq, at, m["qid"] as String, m["team"] as String, (m["teams"] as? List<*>).orEmpty().map { it as String })
            "statues_win" -> StatuesWon(seq, at, m["team"] as String, (m["others"] as? List<*>).orEmpty().map { it as String })
            "statues_stop" -> StatuesStopped(seq, at, m["qid"] as String)
            "statues_play" -> StatuesDanced(seq, at, m["qid"] as String)
            "statues_end" -> StatuesSongEnded(seq, at, m["qid"] as String, m.num("song").toInt())
            "statues_song_win" -> StatuesSongWon(
                seq, at, m["qid"] as String, m.num("song").toInt(),
                (m["winners"] as? List<*>).orEmpty().map { it as String }, (m["others"] as? List<*>).orEmpty().map { it as String },
            )
            "statues_song" -> StatuesSongStarted(seq, at, m["qid"] as String, m.num("song").toInt())
            "buzz_judge" -> BuzzJudged(seq, at, m["ok"] == true, m["bonus"] == true)
            "duel_ready" -> DuelReady(
                seq, at, m["qid"] as String, m.num("n").toInt(), (m["teams"] as List<*>).map { it as String },
                (m["players"] as List<*>).map { (it as Number).toInt() }, m["extra"] == true,
            )
            "duel_start" -> DuelStarted(seq, at, m["qid"] as String, m.num("n").toInt(), m.num("panAt"))
            "duel_buzz" -> DuelBuzzed(seq, at, m["qid"] as String, m.num("n").toInt(), m["team"] as String, m.num("t"))
            "duel_settle" -> DuelSettled(seq, at, m["qid"] as String, m.num("n").toInt())
            "duel_stop" -> DuelStopped(seq, at, m["qid"] as String, m.num("n").toInt())
            "duel_plan" -> DuelPlanned(
                seq, at, m["qid"] as String,
                (m["counts"] as? Map<*, *>).orEmpty().entries.mapNotNull { (k, v) -> (k as? String)?.let { it to ((v as? Number)?.toInt() ?: 0) } }.toMap(),
                m["manual"] == true,
            )
            "duel_pan" -> DuelPanShown(seq, at, m["qid"] as String, m.num("n").toInt(), m.num("shownAt"))
            "chrono_ready" -> ChronoReady(seq, at, m["qid"] as String, m.num("tour").toInt(), m.num("cible").toInt())
            "chrono_cible" -> ChronoTargetSet(seq, at, m["qid"] as String, m.num("tour").toInt(), m.num("cible").toInt())
            "chrono_start" -> ChronoStarted(
                seq, at, m["qid"] as String, m.num("tour").toInt(), m.num("goAt"), m.num("cacheMs"), (m["teams"] as List<*>).map { it as String },
                manuel = m["manuel"] == true,
            )
            "chrono_buzz" -> ChronoBuzzed(seq, at, m["qid"] as String, m.num("tour").toInt(), m["team"] as String, m.num("t"))
            "chrono_shown" -> ChronoShown(seq, at, m["qid"] as String, m.num("tour").toInt(), m.num("shownAt"))
            "chrono_settle" -> ChronoSettled(seq, at, m["qid"] as String, m.num("tour").toInt(), m["force"] == true)
            "chrono_stop" -> ChronoStopped(seq, at, m["qid"] as String, m.num("tour").toInt())
            "simon_tour" -> SimonTourReady(
                seq, at, m["qid"] as String, m.num("tour").toInt(), (m["sequence"] as String).split(","), (m["teams"] as List<*>).map { it as String },
            )
            "simon_start" -> SimonSuiteStarted(seq, at, m["qid"] as String, m.num("tour").toInt(), m.num("suite").toInt())
            "simon_judge" -> SimonJudged(
                seq, at, m["qid"] as String, m.num("tour").toInt(), m.num("suite").toInt(),
                (m["answers"] as? Map<*, *>).orEmpty().entries.associate { (team, v) ->
                    val a = v as Map<*, *>
                    team as String to SimonAnswer((a["items"] as? String)?.split(",")?.filter { it.isNotEmpty() }.orEmpty(), (a["ms"] as? Number)?.toLong())
                },
            )
            "simon_stop" -> SimonStopped(seq, at, m["qid"] as String, m.num("tour").toInt(), m.num("suite").toInt())
            "goto" -> Jumped(seq, at, m.num("index").toInt(), m["qid"] as String, (m["clear"] as? List<*>).orEmpty().map { it as String })
            "reset" -> ProgramReset(seq, at)
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
        // Changement de joueur en cours : l'image suivante attend « Image suivante ».
        "relais" to m?.takeIf { it.team != null }?.relais,
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
    fun publicState(game: Game, buzzRound: Int = 1, teams: Collection<String> = emptyList()): Map<String, Any?> {
        val s = game.state
        val q = game.question
        val revealed = s.phase == Phase.REVEAL || s.phase == Phase.SCORES || s.phase == Phase.ENDED
        val out = linkedMapOf<String, Any?>(
            // Présentation d'un jeu : ni question ni propositions, tout le monde attend le lancement de l'animatrice.
            "phase" to if (s.intro) PHASE_INTRO else s.phase.code,
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
        // Partie terminée : son heure de fin (serveur), pour le ménage des copies des médias par la Régie PC.
        if (s.phase == Phase.ENDED) s.endedAt?.let { out["endedAt"] = it }
        if (s.phase == Phase.ENDED) s.outroAt?.let { out["outroAt"] = it }
        // Un point a déjà été donné : la régie ne propose plus « Mauvaise prestation ? » (la box la refuserait).
        if (s.scored) out["scored"] = true
        // Bilan d'un jeu quitté en cours de route : la régie annonce le jeu choisi (première question).
        game.leaveTarget?.let { out["leaveTo"] = it }
        // Dernières questions du quiz : la régie propose le multiplicateur juste avant la première.
        game.factorChoice()?.let { start -> out["factorChoice"] = mapOf("start" to start, "factor" to (s.factors[start] ?: FACTORS.first())) }
        if (q != null && s.intro) {
            game.gameStep()?.let { out["game"] = mapOf("title" to it.title, "n" to it.n, "of" to it.of, "label" to it.label) }
            out += mapOf("index" to s.index, "qid" to q.id, "kind" to q.kind.code, "deadline" to null, "buzzOpen" to false)
            // Duel des robots (cedric, 1/11) : pendant la présentation, la régie demande les joueurs de chaque équipe.
            if (q.isDuel) out["duel"] = duelState(game, teams)
            return out
        }
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
                // « Ça va exploser ! » : la mèche reste un secret, même pour les tablettes.
                // Statues musicales (depuis le 27/10) : plus de chrono, chaque chanson dure ce qu'elle dure.
                "durationMs" to q.durationMs.takeIf { !q.isPatate && !q.isStatues && !q.isDuel && !q.isSimon && !q.isChrono },
                "deadline" to game.deadline().takeIf { !q.isPatate },
                "remainingMs" to if (!q.isCoffres && !q.isGonfleur && !q.isPatate && !q.isStatues && !q.isDuel && !q.isSimon && !q.isChrono && (s.paused || s.buzzHeld || s.buzz?.waiting == true)) (q.durationMs - s.elapsedAt(Long.MAX_VALUE)).coerceAtLeast(0) else null,
                "correct" to if (revealed && !q.isCoffres && !q.isGonfleur && !q.isPatate) q.correct else null,
                // L'émoji d'illustration peut trahir la réponse : seulement une fois révélée.
                "image" to if (revealed) q.emoji else null,
                "artist" to if (revealed) q.artist else null,
                "awards" to if (revealed) s.awards[q.id]?.mapValues { (_, a) ->
                    mapOf("correct" to a.correct, "points" to a.points, "bonus" to a.bonus)
                } else null,
            )
            if (q.isCoffres) out["chests"] = chestState(game)
            if (q.isPatate) out["potato"] = potatoState(game)
            if (q.isStatues) out["statues"] = statuesState(game)
            if (q.isDuel) out["duel"] = duelState(game, teams)
            if (q.isSimon) out["simon"] = simonState(game)
            if (q.isChrono) out["chrono"] = chronoState(game)
            if (q.isGonfleur) out["pump"] = pumpKey(game)?.let { mapOf("key" to it, "goAt" to game.pumpGoAt, "target" to PUMP_TARGET) }
            if (q.isTurns) out["mime"] = mimeState(game, s.mime)
            if (q.isBlind) out["blind"] = blindState(game)
            s.buzz?.let {
                val rebuzz = game.rebuzzAt()
                out["buzz"] = mapOf("team" to it.team, "blocked" to it.blocked, "rebuzzAt" to rebuzz)
                // Même liste en table : les règles de la base refusent le buzz d'une équipe déjà bloquée avant l'heure
                // (serveur) à partir de laquelle elle peut rebuzzer sur la même question.
                out["buzzBlocked"] = it.blocked.associateWith { rebuzz ?: true }.ifEmpty { null }
            }
        }
        return out
    }

    /** Duel des robots : clé du buzz des tablettes pour le face-à-face en cours (`duel/<clé>/<équipe>`), ou null. */
    fun duelKey(game: Game): String? {
        val d = game.state.duel?.takeIf { it.enCours } ?: return null
        if (game.question?.isDuel != true || game.state.paused) return null
        return "${game.state.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-${d.n}-${d.startAt}"
    }

    /**
     * Duel des robots, pour la TV, la régie et les tablettes : le duel prêt ou en cours, son étape et son bilan. L'heure
     * du PAN n'y est jamais (seule la box la connaît). [teams] : équipes inscrites, pour les duels prévus.
     */
    fun duelState(game: Game, teams: Collection<String>): Map<String, Any?> {
        val d = game.state.duel
        return mapOf(
            "n" to d?.n,
            "total" to game.duelsAPrevoir(teams),
            // Nouveau déroulé (cedric, 1/11) : joueurs par équipe donnés (plan), ou étape passée (manuel) ; null : pas encore.
            "plan" to game.state.duelPlan?.let { p -> if (p.manual) mapOf("manual" to true) else mapOf("counts" to p.counts) },
            "teams" to d?.teams,
            "players" to d?.players,
            "step" to (d?.step ?: "none"),
            "extra" to d?.extra?.takeIf { it },
            "key" to duelKey(game),
            "result" to d?.result?.let { r -> mapOf("winner" to r.winner, "loser" to r.loser, "early" to r.early, "ms" to r.ms, "points" to r.points) },
            "played" to d?.played?.ifEmpty { null },
            "allPlayed" to game.duelTousPasses(teams),
            // Joueurs par équipe réglés dans la Régie PC : le départ des − / ＋ de la régie.
            "joueurs" to (game.question?.joueurs ?: DUEL_JOUEURS),
        )
    }

    /** Chrono de Buzzy : clé du buzz des tablettes pour le tour en cours (`chrono/<clé>/<équipe>`), ou null. */
    fun chronoKey(game: Game): String? {
        val c = game.state.chrono?.takeIf { it.enCours } ?: return null
        if (game.question?.isChrono != true || game.state.paused) return null
        return "${game.state.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-${c.tour}-${c.startAt}"
    }

    /**
     * Chrono de Buzzy, pour la TV, la régie et les tablettes : le tour, la cible, l'étape, l'heure du 0 et du drap, les
     * équipes du tour et celles qui ont déjà buzzé (sans leur heure), puis le bilan (écart de chaque équipe, gagnantes).
     */
    fun chronoState(game: Game): Map<String, Any?> {
        val c = game.state.chrono
        val q = game.question
        return mapOf(
            "tour" to c?.tour,
            "tours" to (q?.chronoTours ?: CHRONO_TOURS),
            "cible" to c?.cible,
            "step" to (c?.step ?: "none"),
            "key" to chronoKey(game),
            "goAt" to c?.takeIf { it.enCours }?.goAt,
            "cacheMs" to c?.takeIf { it.enCours }?.cacheMs,
            "teams" to c?.teams?.ifEmpty { null },
            "buzzed" to c?.takeIf { it.enCours }?.buzzes?.map { it.team }?.ifEmpty { null },
            // Toutes les équipes ont buzzé : la régie propose « 👀 Révéler » (le bilan attend Sarah).
            "reveler" to c?.takeIf { it.enCours }?.revelable?.takeIf { it },
            "result" to c?.result?.let { r ->
                mapOf("ecarts" to r.ecarts.ifEmpty { null }, "winners" to r.winners.ifEmpty { null }, "points" to r.points, "gains" to r.gains.ifEmpty { null }, "at" to r.at)
            },
            "gagnes" to c?.gagnes?.ifEmpty { null },
            "last" to game.chronoFini,
        )
    }

    /** Simon de Buzzy : clé des réponses des tablettes pour la suite en cours (`simon/<clé>/<équipe>`), ou null. */
    fun simonKey(game: Game): String? {
        val r = game.state.simon?.takeIf { it.enCours } ?: return null
        if (game.question?.isSimon != true || game.state.paused) return null
        return "${game.state.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-${r.tour}-${r.suite}-${r.startAt}"
    }

    /**
     * Simon de Buzzy, pour la TV, la régie et les tablettes : le tour, la suite (sa longueur), ses heures (montrée, chrono,
     * fin), les équipes du tour et les éliminées, le joueur appelé dans chaque équipe, et le bilan une fois jugée. La suite
     * secrète n'y est jamais avant le bilan (seule la box la connaît) ; ensuite, la bonne suite pour la vérification.
     */
    fun simonState(game: Game): Map<String, Any?> {
        val r = game.state.simon
        val q = game.question
        val joueurs = q?.joueurs ?: DUEL_JOUEURS
        val v = r?.verdict
        return mapOf(
            "tour" to r?.tour,
            "tours" to (q?.simonTours ?: SIMON_TOURS),
            "suite" to (r?.let { if (it.enCours) it.suite else it.prochaine }),
            "step" to when {
                r == null -> "none"
                r.enCours -> "play"
                r.fini -> "won"
                v != null -> "judged"
                else -> "ready"
            },
            "key" to simonKey(game),
            "startAt" to r?.startAt?.takeIf { r.enCours },
            "chiffresAt" to r?.takeIf { it.enCours && it.annonceChiffres }?.startAt,
            "montreAt" to r?.takeIf { it.enCours }?.montreAt,
            "reponseAt" to r?.takeIf { it.enCours }?.reponseAt,
            "finAt" to r?.takeIf { it.enCours }?.finAt(q?.simonSec ?: SIMON_REPONSE_SEC),
            // Le pavé des chiffres des tablettes : dès la première suite à chiffres, une fois annoncés.
            "chiffres" to (SIMON_AVEC_CHIFFRES && r != null && (r.chiffresVus || (r.enCours && r.suite >= SIMON_CHIFFRES_DES))),
            "teams" to r?.teams,
            "out" to r?.out?.ifEmpty { null },
            "players" to r?.let { rr -> rr.teams.associateWith { rr.joueur(it, joueurs) } },
            "last" to game.simonFini,
            "verdict" to v?.let {
                mapOf(
                    "suite" to it.suite,
                    "solution" to r!!.sequence.take(it.suite).joinToString(","),
                    "answers" to it.answers.mapValues { (_, a) -> mapOf("items" to a.items.joinToString(",").ifEmpty { null }, "ms" to a.ms) }.ifEmpty { null },
                    "wrong" to it.wrong.ifEmpty { null },
                    "winners" to it.winners.ifEmpty { null },
                    "points" to it.points,
                    "bahAlors" to it.bahAlors.takeIf { b -> b },
                    "at" to it.at,
                )
            },
        )
    }

    /**
     * Statues musicales, pour la TV, la régie et les tablettes : la chanson en cours (et le nombre de chansons, leurs
     * titres), si la musique joue (DANSEZ !) ou non (STATUE !), où elle en est, et les gagnantes une fois désignées.
     */
    fun statuesState(game: Game): Map<String, Any?> {
        val q = game.question ?: return emptyMap()
        val chansons = q.statuesSongs
        val out = linkedMapOf<String, Any?>(
            "songs" to q.statuesTours,
            "titles" to chansons.map { it.title.orEmpty() }.takeIf { t -> t.any { it.isNotEmpty() } },
            "annonceMs" to STATUES_ANNONCE_MS,
        )
        val st = game.state.statues ?: return out
        out += mapOf(
            "song" to st.song,
            "dancing" to st.dancing,
            "since" to st.since,
            "playedMs" to st.playedMs,
            "ended" to st.ended,
            "result" to st.result?.let { r -> mapOf("song" to r.song, "winners" to r.winners, "gains" to r.gains, "at" to r.at) },
        )
        return out
    }

    /** « Ça va exploser ! » : clé où la tablette de l'équipe qui tient la bombe écrit son envoi (`potatoPass/`), une par réception. */
    fun potatoKey(game: Game): String? {
        val p = game.state.potato ?: return null
        if (game.state.phase != Phase.QUESTION || p.exploded) return null
        return "${game.state.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-${p.since}"
    }

    /**
     * « Ça va exploser ! », pour la TV, la régie et les tablettes : qui tient la bombe, qui l'a envoyée, à qui elle peut
     * partir et à partir de quand, et qui l'a déjà eue. Jamais la durée de la mèche.
     */
    fun potatoState(game: Game): Map<String, Any?> {
        val p = game.state.potato ?: return mapOf("lit" to false)
        return mapOf(
            "lit" to true,
            "holder" to p.holder,
            "from" to p.from,
            "since" to p.since,
            "readyAt" to p.readyAt,
            "canReturn" to p.canReturn,
            "targets" to p.targets,
            "teams" to p.teams,
            "hit" to p.teams.filter { it in p.hit },
            "passes" to p.passes,
            // Bombe n° [bomb] sur [bombs] ; les explosions déjà arrivées (la TV et les tablettes les montrent un moment).
            "bomb" to p.bomb,
            "bombs" to p.total,
            "exploded" to p.exploded,
            // Heure où la mèche aurait été allumée sans les pauses (null en pause ou entre deux bombes) : la tablette qui
            // tient la bombe en tire un rouge qui bat de plus en plus vite, sans jamais connaître la durée de la mèche.
            "burnFrom" to game.state.segments.lastOrNull()?.takeIf { it.end == null && !p.exploded }
                ?.let { it.start - game.state.elapsedAt(it.start) },
            // L'équipe qui tient la bombe doit l'avoir envoyée avant cette heure (null en pause) : sa tablette compte 3, 2, 1.
            "holdUntil" to game.holdDeadline(),
            "booms" to p.booms.map { mapOf("holder" to it.holder, "at" to it.at, "lost" to it.lost, "gain" to it.gain, "held" to it.held) },
            "key" to potatoKey(game),
        )
    }

    /** Gonfleur fou : clé où les tablettes écrivent leurs tapes (`pumps/`), une par course (un jeu rejoué repart de zéro). */
    fun pumpKey(game: Game): String? {
        val go = game.pumpGoAt ?: return null
        return "${game.state.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-$go"
    }

    /** Les coffres mystères : clé où la tablette de l'équipe qui joue écrit le coffre choisi (`chestChoice/`), une par ouverture. */
    fun chestKey(game: Game): String? {
        val r = game.chestRound ?: return null
        if (r.team == null) return null
        return "${game.state.qid.orEmpty().replace(Regex("[.#$\\[\\]/]"), "_")}-${r.dealt}-${r.turn}"
    }

    /**
     * Les coffres mystères, pour la TV, la régie et les pupitres : les coffres ouverts (le contenu des autres n'existe pas
     * encore), l'équipe qui joue et l'heure où elle pourra ouvrir, le danger, et les gains de chaque équipe.
     */
    fun chestState(game: Game): Map<String, Any?> {
        val r = game.chestRound ?: return mapOf("ready" to false)
        return mapOf(
            "ready" to true,
            "count" to r.count,
            "order" to r.order,
            "team" to r.team,
            "turn" to r.turn,
            "safe" to r.safe,
            // Ouvertures sans danger qui restent avant l'arrivée de la bombe.
            "safeLeft" to (r.safe - r.turn).coerceAtLeast(0),
            "danger" to r.danger,
            "exploded" to r.exploded,
            // Le coffre en or (+500) est caché avec la bombe tant que personne ne l'a ouvert.
            "goldLeft" to (!r.goldFound && !r.exploded),
            "readyAt" to r.readyAt,
            "key" to chestKey(game),
            "opened" to r.opened.map { mapOf("team" to it.team, "chest" to it.chest, "delta" to it.delta, "bomb" to it.bomb, "gold" to it.gold, "at" to it.at) },
            "gains" to r.gains(),
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
