package com.littlemissparty.quiz.engine

/*
 * Programme modifié pendant la partie depuis la régie : jeu ajouté, manches futures déplacées ou retirées.
 * Tout ce qui a été joué et la manche en cours restent intouchables ; seules les manches pas encore
 * commencées changent. Le journal est rejoué tel quel : équipes, scores et progression sont gardés.
 */

/** Dernière question verrouillée : celle en cours et la fin de sa manche (-1 au salon d'attente). */
fun Game.lockedUntil(): Int {
    val i = state.index
    if (i < 0) return -1
    val round = quiz.questions[i].roundTitle ?: return i
    var end = i
    while (quiz.questions.getOrNull(end + 1)?.roundTitle == round) end++
    return end
}

/**
 * Raison du refus d'un nouveau programme, ou null s'il peut remplacer l'actuel sans rien perdre.
 * Possible aussi après la fin de la partie : un jeu ajouté permet de la reprendre (saut de la régie),
 * équipes et scores gardés. Tout ce qui a déjà été joué reste intouchable.
 */
fun Game.programProblem(next: Quiz): String? {
    val keep = lockedUntil()
    if (next.questions.size <= keep) return "current_round"
    if ((0..keep).any { next.questions[it] != quiz.questions[it] }) return "current_round"
    return null
}

/** La même partie avec le nouveau programme, ou null s'il toucherait à ce qui est joué ou en cours. */
fun Game.withProgram(next: Quiz): Game? {
    if (programProblem(next) != null) return null
    return Game(next, events).takeIf { it.state == state }
}

/**
 * Nom du jeu qui commence à la question suivante, pour annoncer « Jeu suivant : … » à la fin d'un jeu
 * (jamais une simple « question suivante » quand c'est un autre jeu qui arrive). Null si la suite est dans
 * le même jeu ou s'il n'y a plus rien ; « Quiz » pour des questions sans titre de manche (quiz de démonstration).
 */
fun Game.nextGameTitle(): String? {
    val i = state.index + 1
    val q = quiz.questions.getOrNull(i) ?: return null
    if (state.index >= 0 && q.roundTitle == quiz.questions[state.index].roundTitle) return null
    return if (q.isMime) "Mimes" else q.roundTitle ?: "Quiz"
}

/**
 * Points gagnés par chaque équipe dans le jeu en cours (questions, mimes, et bonus ou malus donnés par la
 * régie pendant ce jeu) : le vainqueur d'un jeu, célébré à sa fin, sans attendre le classement final.
 */
fun Game.gameGains(): Map<String, Int> {
    if (state.index !in quiz.questions.indices) return emptyMap()
    val totals = mutableMapOf<String, Int>()
    val ids = roundOf(state.index).map { quiz.questions[it].id }.toSet()
    ids.forEach { id ->
        state.awards[id].orEmpty().forEach { (team, a) -> totals.merge(team, a.points, Int::plus) }
        state.mimes[id].orEmpty().forEach { (team, n) -> totals.merge(team, n * Scoring.MIME, Int::plus) }
    }
    state.adjustments.values.filter { state.adjustedIn[it.seq] in ids }.forEach { totals.merge(it.team, it.delta, Int::plus) }
    return totals
}
