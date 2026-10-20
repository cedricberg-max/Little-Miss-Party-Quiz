package com.littlemissparty.quiz.engine

/*
 * Le Gonfleur fou : chaque équipe tapote sa tablette pour gonfler son ballon. La tablette compte elle-même ses tapes
 * et les envoie régulièrement (games/<code>/pumps/<clé>/<équipe> = { n, at }) : le réseau ne décide presque rien.
 * Le premier ballon qui atteint [PUMP_TARGET] éclate et gagne ; si l'animatrice arrête la course (ou au bout du
 * chrono de secours), le plus gros ballon gagne. Barème des mini-jeux : 300 au gagnant, 150 aux autres.
 */

/** Tapes pour faire éclater un ballon (une quinzaine de secondes pour un enfant). */
const val PUMP_TARGET = 100

/** Départ 3, 2, 1… « GONFLEZ ! » à la TV : les tapes ne comptent qu'après. */
const val PUMP_GO_MS = 3_500L

/** Tapes envoyées par une tablette : [n] au total depuis le départ, [at] heure du serveur du dernier envoi. */
data class Pump(val n: Int, val at: Long)

/**
 * Gagnant de la course : le premier ballon éclaté (le plus tôt arrivé à [PUMP_TARGET]) ; sinon, si la course est
 * arrêtée ([stop]), le plus gros ballon (à égalité, celui qui y est arrivé le premier). Null tant que personne n'a
 * éclaté et que la course continue ; [NO_WINNER] si elle s'arrête sans que personne ait tapé.
 */
fun pumpWinner(pumps: Map<String, Pump>, teams: Collection<String>, stop: Boolean): String? {
    val played = teams.mapNotNull { t -> pumps[t]?.takeIf { it.n > 0 }?.let { t to it } }
    played.filter { it.second.n >= PUMP_TARGET }.minByOrNull { it.second.at }?.let { return it.first }
    if (!stop) return null
    return played.sortedWith(compareByDescending<Pair<String, Pump>> { it.second.n }.thenBy { it.second.at }).firstOrNull()?.first ?: NO_WINNER
}

/** Course arrêtée sans aucune tape : personne ne gagne, chaque équipe a ses points de participation. */
const val NO_WINNER = ""
