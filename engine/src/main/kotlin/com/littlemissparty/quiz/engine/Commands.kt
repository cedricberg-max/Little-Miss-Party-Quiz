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
    val advances = cmd is Command.Next || cmd is Command.Close || cmd is Command.End
    if (advances && cmd.expectSeq != state.lastSeq) return CommandResult(CommandStatus.STALE, reason = "stale")
    val event = when (cmd) {
        is Command.Next -> when (state.phase) {
            Phase.LOBBY -> if (teams.isEmpty()) return refused("no_teams") else next(now)
            Phase.CLOSED -> reveal(now, answers.filterKeys { it in teams })
            else -> next(now)
        }
        is Command.Close -> close(now)
        is Command.Pause -> pause(now)
        is Command.Resume -> resume(now)
        is Command.Adjust -> when {
            cmd.team !in teams -> return refused("unknown_team")
            cmd.delta == 0 || kotlin.math.abs(cmd.delta) > Command.MAX_DELTA -> return refused("bad_delta")
            else -> adjust(cmd.team, cmd.delta, "régie", now)
        }
        is Command.Undo -> undo(cmd.target, now)
        is Command.End -> end(now)
    }
    return if (event == null) refused("not_now") else CommandResult(CommandStatus.APPLIED, event)
}

private fun refused(reason: String) = CommandResult(CommandStatus.REFUSED, reason = reason)
