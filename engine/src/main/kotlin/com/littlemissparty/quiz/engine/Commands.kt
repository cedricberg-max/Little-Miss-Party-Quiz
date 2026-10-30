package com.littlemissparty.quiz.engine

/**
 * Intention envoyée par la régie (téléphone de l'animatrice). La box reste seule arbitre :
 * elle vérifie chaque commande avec [Game.execute] avant de l'inscrire au journal.
 *
 * [expectSeq] est le numéro du dernier événement que la régie affichait. Une commande qui fait
 * avancer la partie est refusée si la partie a bougé entre-temps : deux appuis sur « Suivant »,
 * depuis un ou deux téléphones, n'avancent jamais de deux étapes.
 */
sealed interface Command {
    val id: String
    val expectSeq: Int

    /** Bouton principal : lancer, arrêter le chrono, révéler, scores, question suivante, résultats. */
    data class Next(override val id: String, override val expectSeq: Int) : Command
    data class Pause(override val id: String, override val expectSeq: Int) : Command
    data class Resume(override val id: String, override val expectSeq: Int) : Command

    /** Arrête le chrono de la question en cours. */
    data class Close(override val id: String, override val expectSeq: Int) : Command
    data class Adjust(override val id: String, override val expectSeq: Int, val team: String, val delta: Int) : Command
    data class Undo(override val id: String, override val expectSeq: Int, val target: Int) : Command
    data class End(override val id: String, override val expectSeq: Int) : Command

    /** Mimes : lancer le tour de [team], mime trouvé, carte passée, correction ±1, arrêter le tour. */
    data class MimeStart(override val id: String, override val expectSeq: Int, val team: String) : Command
    data class MimeFound(override val id: String, override val expectSeq: Int) : Command
    data class MimePass(override val id: String, override val expectSeq: Int) : Command
    /** « ⏭ Passer » : le mimeur abandonne son image, les joueurs tournent. */
    data class MimeSkip(override val id: String, override val expectSeq: Int) : Command
    data class MimeFix(override val id: String, override val expectSeq: Int, val team: String, val delta: Int) : Command
    data class MimeStop(override val id: String, override val expectSeq: Int) : Command

    /** Pictionary : montrer le mot à [team] sur sa tablette, puis le masquer pour lancer le dessin et le chrono. */
    data class PictoShow(override val id: String, override val expectSeq: Int, val team: String) : Command
    data class PictoDraw(override val id: String, override val expectSeq: Int) : Command

    /** Image floue : la réponse orale de l'équipe qui a buzzé est bonne ([ok]) ou mauvaise. */
    data class Judge(override val id: String, override val expectSeq: Int, val ok: Boolean, val bonus: Boolean = false) : Command

    /** « Ça va exploser ! » : secours, la bombe part au hasard chez une équipe permise (tablette en panne). */
    data class PotatoRandom(override val id: String, override val expectSeq: Int) : Command

    /** « Ça va exploser ! » : « 🏁 Dernière bombe » (bombe en cours) ou « ⏭ Jeu suivant » (entre deux bombes). */
    data class PotatoStop(override val id: String, override val expectSeq: Int) : Command

    /** Statues musicales : les gagnantes de la chanson en cours ([teams] vide : « Personne »). */
    data class StatuesWin(override val id: String, override val expectSeq: Int, val teams: List<String>) : Command

    /** Statues musicales : « ✋ STATUE ! », la musique se coupe net. */
    data class StatuesStop(override val id: String, override val expectSeq: Int) : Command

    /** Statues musicales : « 💃 On danse ! », la musique reprend. */
    data class StatuesPlay(override val id: String, override val expectSeq: Int) : Command

    /** Statues musicales : « ▶ Chanson suivante », après les gagnantes de la chanson. */
    data class StatuesSong(override val id: String, override val expectSeq: Int) : Command

    /**
     * Duel des robots : « 🤠 Lancer le duel » prêt ; avec [teams] (2 équipes), un duel à la volée entre elles, lancé
     * aussitôt (à la place du duel prêt, ou après un duel jugé).
     */
    data class DuelStart(override val id: String, override val expectSeq: Int, val teams: List<String>? = null) : Command

    /** Duel des robots : « ▶ Duel suivant », la box prépare le duel suivant de la ronde. */
    data class DuelNext(override val id: String, override val expectSeq: Int) : Command

    /** Duel des robots : « ✋ Arrêter le duel », le face-à-face s'arrête sans points. */
    data class DuelStop(override val id: String, override val expectSeq: Int) : Command

    /** Chrono de Buzzy : « ▶ Lancer le chrono » du tour prêt, ou « ▶ Tour suivant » après un tour jugé. */
    data class ChronoGo(override val id: String, override val expectSeq: Int) : Command

    /** Chrono de Buzzy : la cible du tour prêt (secondes), − / + du téléphone. */
    data class ChronoCible(override val id: String, override val expectSeq: Int, val cible: Int) : Command

    /** Chrono de Buzzy : « 👀 Révéler maintenant », sans attendre les équipes qui n'ont pas buzzé (cible passée). */
    data class ChronoReveal(override val id: String, override val expectSeq: Int) : Command

    /** Chrono de Buzzy : « ✋ Arrêter », le tour s'arrête sans points et reste prêt. */
    data class ChronoStop(override val id: String, override val expectSeq: Int) : Command

    /** Simon du Prof : « ▶ » de Sarah, la suite suivante (ou la même après « Bah alors »), ou le tour suivant. */
    data class SimonGo(override val id: String, override val expectSeq: Int) : Command

    /** Simon du Prof : « ✋ Arrêter la suite », elle se relancera telle quelle, sans élimination. */
    data class SimonStop(override val id: String, override val expectSeq: Int) : Command

    /** Blind test : lancer ou relancer la musique du morceau. */
    data class BlindPlay(override val id: String, override val expectSeq: Int) : Command

    /** Blind test : réautoriser toutes les équipes à buzzer sur ce morceau. */
    data class BlindUnblock(override val id: String, override val expectSeq: Int) : Command

    /** Blind test : révéler le morceau sans gagnant. */
    data class BlindReveal(override val id: String, override val expectSeq: Int) : Command

    /** Blind test : passer le morceau sans le révéler. */
    data class BlindSkip(override val id: String, override val expectSeq: Int) : Command

    /** Blind test : raccourcir la révélation. */
    data class BlindCut(override val id: String, override val expectSeq: Int) : Command

    /** Dernières questions du quiz : multiplicateur de la série qui commence à la question suivante. */
    data class Factor(override val id: String, override val expectSeq: Int, val factor: Int) : Command

    /** Portes mystères : nouvelle valeur derrière une porte, avant leur ouverture. */
    data class PortesSet(override val id: String, override val expectSeq: Int, val qid: String, val door: Int, val value: Int) : Command

    /** Les coffres mystères, secours : ouvrir un coffre au hasard pour l'équipe qui joue (tablette en panne, hésitation). */
    data class ChestRandom(override val id: String, override val expectSeq: Int) : Command

    /** Régie : aller au jeu (manche) qui commence à la question [index], [qid] vérifiant le programme. */
    data class Goto(override val id: String, override val expectSeq: Int, val index: Int, val qid: String) : Command

    companion object {
        /** Correction maximale en une fois, pour qu'une faute de frappe ne fausse pas tout le classement. */
        const val MAX_DELTA = 500

        /** Lit une commande stockée dans Firebase ; null si elle est illisible ou d'un type inconnu. */
        fun decode(id: String, m: Map<*, *>): Command? = runCatching {
            val seq = (m["expectSeq"] as Number).toInt()
            when (m["type"]) {
                "next" -> Next(id, seq)
                "pause" -> Pause(id, seq)
                "resume" -> Resume(id, seq)
                "close" -> Close(id, seq)
                "adjust" -> Adjust(id, seq, m["team"] as String, (m["delta"] as Number).toInt())
                "undo" -> Undo(id, seq, (m["target"] as Number).toInt())
                "end" -> End(id, seq)
                "mime_start" -> MimeStart(id, seq, m["team"] as String)
                "mime_found" -> MimeFound(id, seq)
                "mime_pass" -> MimePass(id, seq)
                "mime_skip" -> MimeSkip(id, seq)
                "mime_fix" -> MimeFix(id, seq, m["team"] as String, (m["delta"] as Number).toInt())
                "mime_stop" -> MimeStop(id, seq)
                "picto_show" -> PictoShow(id, seq, m["team"] as String)
                "picto_draw" -> PictoDraw(id, seq)
                "buzz_ok" -> Judge(id, seq, true)
                "buzz_ko" -> Judge(id, seq, false)
                // Blind test : bon titre et bon artiste.
                "buzz_bonus" -> Judge(id, seq, true, bonus = true)
                // « Personne » arrive en { personne: true } (Firebase efface une liste vide) ; régie d'avant le 27/10 : `team`.
                "statues_win" -> StatuesWin(
                    id, seq,
                    if (m["personne"] == true) emptyList()
                    else (m["teams"] as? List<*>)?.map { it as String } ?: listOf(m["team"] as String),
                )
                "statues_stop" -> StatuesStop(id, seq)
                "statues_play" -> StatuesPlay(id, seq)
                "statues_song" -> StatuesSong(id, seq)
                "blind_play" -> BlindPlay(id, seq)
                "blind_unblock" -> BlindUnblock(id, seq)
                "blind_reveal" -> BlindReveal(id, seq)
                "blind_skip" -> BlindSkip(id, seq)
                "blind_cut" -> BlindCut(id, seq)
                "goto" -> Goto(id, seq, (m["index"] as Number).toInt(), m["qid"] as String)
                "factor" -> Factor(id, seq, (m["factor"] as Number).toInt())
                "chest_random" -> ChestRandom(id, seq)
                "potato_random" -> PotatoRandom(id, seq)
                "potato_stop" -> PotatoStop(id, seq)
                "duel_start" -> DuelStart(id, seq, (m["teams"] as? List<*>)?.map { it as String })
                "duel_next" -> DuelNext(id, seq)
                "duel_stop" -> DuelStop(id, seq)
                "simon_go" -> SimonGo(id, seq)
                "simon_stop" -> SimonStop(id, seq)
                "chrono_go" -> ChronoGo(id, seq)
                "chrono_cible" -> ChronoCible(id, seq, (m["cible"] as Number).toInt())
                "chrono_reveal" -> ChronoReveal(id, seq)
                "chrono_stop" -> ChronoStop(id, seq)
                "portes_set" -> PortesSet(id, seq, m["qid"] as String, (m["door"] as Number).toInt(), (m["value"] as Number).toInt())
                else -> null
            }
        }.getOrNull()
    }
}

/** Réponse de la box à une commande, publiée dans `commandStatus/$id` pour la régie. */
enum class CommandStatus(val code: String) {
    APPLIED("applied"),

    /** La partie avait déjà avancé : la régie se met à jour, rien n'est fait. */
    STALE("stale"),

    /** Commande impossible dans l'état actuel (déjà en pause, équipe inconnue…). */
    REFUSED("refused"),
}

data class CommandResult(val status: CommandStatus, val event: GameEvent? = null, val reason: String? = null)

/**
 * Applique une commande de la régie. [teams] liste les équipes inscrites (les réponses et corrections
 * d'appareils inconnus sont ignorées) ; [answers] ne sert qu'à la révélation.
 */
fun Game.execute(
    cmd: Command,
    now: Long,
    teams: Set<String>,
    answers: Map<String, Answer> = emptyMap(),
    pumps: Map<String, Pump> = emptyMap(),
    random: kotlin.random.Random = kotlin.random.Random.Default,
): CommandResult {
    // Un double appui sur « Trouvé » ne compte qu'un mime : chaque appui vise la carte que la régie affichait.
    val advances = cmd is Command.Next || cmd is Command.Close || cmd is Command.End || cmd is Command.MimeStart ||
        cmd is Command.MimeFound || cmd is Command.MimePass || cmd is Command.MimeSkip || cmd is Command.MimeStop || cmd is Command.Goto ||
        cmd is Command.Judge || cmd is Command.StatuesWin || cmd is Command.BlindPlay || cmd is Command.BlindUnblock ||
        cmd is Command.BlindReveal || cmd is Command.BlindSkip || cmd is Command.BlindCut ||
        cmd is Command.PictoShow || cmd is Command.PictoDraw || cmd is Command.ChestRandom || cmd is Command.PotatoRandom ||
        cmd is Command.PotatoStop || cmd is Command.StatuesStop || cmd is Command.StatuesPlay || cmd is Command.StatuesSong ||
        cmd is Command.DuelStart || cmd is Command.DuelNext || cmd is Command.DuelStop || cmd is Command.SimonGo || cmd is Command.SimonStop ||
        cmd is Command.ChronoGo || cmd is Command.ChronoCible || cmd is Command.ChronoReveal || cmd is Command.ChronoStop
    if (advances && cmd.expectSeq != state.lastSeq) return CommandResult(CommandStatus.STALE, reason = "stale")
    // En pause, rien n'avance : l'animatrice reprend d'abord (corrections de score et fin restent possibles).
    // Le saut de jeu reste possible en pause : c'est la commande de secours pour débloquer une prestation.
    if (state.paused && advances && cmd !is Command.End && cmd !is Command.Goto) return refused("paused")
    // Décompte 3, 2, 1 d'une reprise : un « Arrêter le chrono » arrivé maintenant est un appui réflexe
    // (la question n'a pas encore repris) ; il fermerait la question avant qu'elle reparte.
    if (cmd is Command.Close && state.phase == Phase.QUESTION && (state.resumeAt ?: Long.MIN_VALUE) > now) return refused("countdown")
    // Chrono parti il y a moins de 1,5 s : le gros bouton du téléphone venait d'afficher « Question suivante » ; ce second
    // appui d'un double clic fermait la question dans la même seconde (test du 27/10 : « Temps écoulé ! » sur les tablettes).
    if (cmd is Command.Close && justStarted(now)) return refused("just_started")
    // Vrai ou Faux express : les scores de fin de série viennent de s'afficher seuls ; on les laisse à l'écran.
    if (cmd is Command.Next && scoresJustShown(now)) return refused("scores_just_shown")
    // Toutes les équipes inscrites ont déjà tenté leur chance : à la relance, tout le monde peut rebuzzer.
    val allTried = state.buzz?.blocked?.let { b -> b.isNotEmpty() && teams.isNotEmpty() && teams.all { it in b } } == true
    val event = when (cmd) {
        is Command.Next -> when (state.phase) {
            Phase.LOBBY -> if (teams.isEmpty()) return refused("no_teams") else next(now)
            // Blind test : le bouton principal lance ou relance la musique, comme « Lancer le morceau ».
            Phase.QUESTION -> if (question?.isBlind == true && state.buzz?.waiting == true) blindPlay(now, allTried)
            // Gonfleur fou : le bouton principal arrête la course, le plus gros ballon gagne.
            else if (question?.isGonfleur == true && !state.intro) balloon(pumps, teams, now, stop = true)
            else next(now)
            Phase.CLOSED -> reveal(now, answers.filterKeys { it in teams })
            else -> next(now)
        }
        is Command.Close -> if (question?.isGonfleur == true) balloon(pumps, teams, now, stop = true) else if (state.mime != null) mimeStop(now) else if (question?.isBlind == true) blindStop(now) else close(now)
        is Command.Pause -> pause(now)
        is Command.Resume -> resume(now)
        is Command.Adjust -> when {
            cmd.team !in teams -> return refused("unknown_team")
            cmd.delta == 0 || kotlin.math.abs(cmd.delta) > Command.MAX_DELTA -> return refused("bad_delta")
            else -> adjust(cmd.team, cmd.delta, "régie", now)
        }
        is Command.Undo -> undo(cmd.target, now)
        is Command.End -> end(now)
        is Command.MimeStart -> if (cmd.team !in teams) return refused("unknown_team") else mimeStart(cmd.team, now)
        is Command.MimeFound -> mimeFound(now)
        is Command.MimePass -> mimePass(now)
        is Command.MimeSkip -> mimeSkip(now)
        is Command.MimeFix -> if (cmd.team !in teams) return refused("unknown_team") else mimeFix(cmd.team, cmd.delta, now)
        is Command.MimeStop -> mimeStop(now)
        is Command.PictoShow -> if (cmd.team !in teams) return refused("unknown_team") else pictoShow(cmd.team, now)
        is Command.PictoDraw -> pictoDraw(now)
        // Un double appui ne juge qu'une fois : il visait l'équipe que la régie affichait.
        is Command.Judge -> judgeBuzz(cmd.ok, now, cmd.bonus)
        is Command.StatuesWin -> if (!teams.containsAll(cmd.teams)) return refused("unknown_team") else statuesSongWin(cmd.teams.distinct(), teams - cmd.teams.toSet(), now)
        is Command.StatuesStop -> statuesStop(now)
        is Command.StatuesPlay -> statuesPlay(now)
        is Command.StatuesSong -> statuesNextSong(now)
        is Command.BlindPlay -> blindPlay(now, unblock = allTried)
        is Command.BlindUnblock -> blindUnblock(now)
        is Command.BlindReveal -> blindReveal(now)
        is Command.BlindSkip -> blindSkip(now)
        is Command.BlindCut -> blindCut(now)
        is Command.ChestRandom -> openRandomChest(now)
        is Command.PotatoRandom -> passPotatoRandom(now)
        is Command.PotatoStop -> stopPotato(now)
        // Duel à la volée : prêt entre les 2 équipes choisies, puis lancé ; si le lancement échoue, rien ne reste.
        is Command.DuelStart -> when {
            cmd.teams == null -> startDuel(now, random)
            cmd.teams.size != 2 || cmd.teams.distinct().size != 2 -> return refused("bad_teams")
            !teams.containsAll(cmd.teams) -> return refused("unknown_team")
            else -> readyDuel(teams, now, cmd.teams, random)?.let { startDuel(now, random) }
        }
        is Command.DuelNext -> if (state.duel?.result == null) null else readyDuel(teams, now, random = random)
        is Command.DuelStop -> stopDuel(now)
        is Command.SimonGo -> if (teams.isEmpty()) return refused("no_teams") else simonGo(teams, now, random)
        is Command.SimonStop -> stopSimon(now)
        is Command.ChronoGo -> when {
            teams.isEmpty() -> return refused("no_teams")
            state.chrono?.step == "ready" -> startChrono(teams, now, random)
            chronoFini -> return refused("last_tour")
            else -> readyChrono(now)
        }
        is Command.ChronoCible -> if (cmd.cible !in CHRONO_CIBLE_MIN..CHRONO_CIBLE_MAX) return refused("bad_cible") else chronoCible(cmd.cible, now)
        is Command.ChronoReveal -> settleChrono(now, force = true)
        is Command.ChronoStop -> stopChrono(now)
        is Command.PortesSet -> if (question?.id != cmd.qid) return refused("stale_program") else setDoor(cmd.door, cmd.value, now)
        is Command.Factor -> if (cmd.factor !in FACTORS) return refused("bad_factor") else chooseFactor(cmd.factor, now)
        // Le programme a changé depuis l'affichage de la régie : rien n'est fait.
        is Command.Goto -> if (quiz.questions.getOrNull(cmd.index)?.id != cmd.qid) return refused("stale_program") else changeGame(cmd.index, now)
    }
    return if (event == null) refused("not_now") else CommandResult(CommandStatus.APPLIED, event)
}

private fun refused(reason: String) = CommandResult(CommandStatus.REFUSED, reason = reason)
