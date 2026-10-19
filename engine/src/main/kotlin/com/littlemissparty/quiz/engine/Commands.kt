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
    data class MimeFix(override val id: String, override val expectSeq: Int, val team: String, val delta: Int) : Command
    data class MimeStop(override val id: String, override val expectSeq: Int) : Command

    /** Image floue : la réponse orale de l'équipe qui a buzzé est bonne ([ok]) ou mauvaise. */
    data class Judge(override val id: String, override val expectSeq: Int, val ok: Boolean, val bonus: Boolean = false) : Command

    /** Statues musicales : l'équipe gagnante désignée par l'animatrice. */
    data class StatuesWin(override val id: String, override val expectSeq: Int, val team: String) : Command

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
                "mime_fix" -> MimeFix(id, seq, m["team"] as String, (m["delta"] as Number).toInt())
                "mime_stop" -> MimeStop(id, seq)
                "buzz_ok" -> Judge(id, seq, true)
                "buzz_ko" -> Judge(id, seq, false)
                // Blind test : bon titre et bon artiste.
                "buzz_bonus" -> Judge(id, seq, true, bonus = true)
                "statues_win" -> StatuesWin(id, seq, m["team"] as String)
                "blind_play" -> BlindPlay(id, seq)
                "blind_unblock" -> BlindUnblock(id, seq)
                "blind_reveal" -> BlindReveal(id, seq)
                "blind_skip" -> BlindSkip(id, seq)
                "blind_cut" -> BlindCut(id, seq)
                "goto" -> Goto(id, seq, (m["index"] as Number).toInt(), m["qid"] as String)
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
): CommandResult {
    // Un double appui sur « Trouvé » ne compte qu'un mime : chaque appui vise la carte que la régie affichait.
    val advances = cmd is Command.Next || cmd is Command.Close || cmd is Command.End || cmd is Command.MimeStart ||
        cmd is Command.MimeFound || cmd is Command.MimePass || cmd is Command.MimeStop || cmd is Command.Goto ||
        cmd is Command.Judge || cmd is Command.StatuesWin || cmd is Command.BlindPlay || cmd is Command.BlindUnblock ||
        cmd is Command.BlindReveal || cmd is Command.BlindSkip || cmd is Command.BlindCut
    if (advances && cmd.expectSeq != state.lastSeq) return CommandResult(CommandStatus.STALE, reason = "stale")
    // En pause, rien n'avance : l'animatrice reprend d'abord (corrections de score et fin restent possibles).
    // Le saut de jeu reste possible en pause : c'est la commande de secours pour débloquer une prestation.
    if (state.paused && advances && cmd !is Command.End && cmd !is Command.Goto) return refused("paused")
    // Toutes les équipes inscrites ont déjà tenté leur chance : à la relance, tout le monde peut rebuzzer.
    val allTried = state.buzz?.blocked?.let { b -> b.isNotEmpty() && teams.isNotEmpty() && teams.all { it in b } } == true
    val event = when (cmd) {
        is Command.Next -> when (state.phase) {
            Phase.LOBBY -> if (teams.isEmpty()) return refused("no_teams") else next(now)
            // Blind test : le bouton principal lance ou relance la musique, comme « Lancer le morceau ».
            Phase.QUESTION -> if (question?.isBlind == true && state.buzz?.waiting == true) blindPlay(now, allTried) else next(now)
            Phase.CLOSED -> reveal(now, answers.filterKeys { it in teams })
            else -> next(now)
        }
        is Command.Close -> if (state.mime != null) mimeStop(now) else if (question?.isBlind == true) blindStop(now) else close(now)
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
        is Command.MimeFix -> if (cmd.team !in teams) return refused("unknown_team") else mimeFix(cmd.team, cmd.delta, now)
        is Command.MimeStop -> mimeStop(now)
        // Un double appui ne juge qu'une fois : il visait l'équipe que la régie affichait.
        is Command.Judge -> judgeBuzz(cmd.ok, now, cmd.bonus)
        is Command.StatuesWin -> if (cmd.team !in teams) return refused("unknown_team") else statuesWin(cmd.team, teams - cmd.team, now)
        is Command.BlindPlay -> blindPlay(now, unblock = allTried)
        is Command.BlindUnblock -> blindUnblock(now)
        is Command.BlindReveal -> blindReveal(now)
        is Command.BlindSkip -> blindSkip(now)
        is Command.BlindCut -> blindCut(now)
        // Le programme a changé depuis l'affichage de la régie : rien n'est fait.
        is Command.Goto -> if (quiz.questions.getOrNull(cmd.index)?.id != cmd.qid) return refused("stale_program") else goto(cmd.index, now)
    }
    return if (event == null) refused("not_now") else CommandResult(CommandStatus.APPLIED, event)
}

private fun refused(reason: String) = CommandResult(CommandStatus.REFUSED, reason = reason)
