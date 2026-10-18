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

/** Raison du refus d'un nouveau programme, ou null s'il peut remplacer l'actuel sans rien perdre. */
fun Game.programProblem(next: Quiz): String? {
    if (state.phase == Phase.ENDED) return "ended"
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
