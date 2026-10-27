package com.littlemissparty.quiz.engine

/*
 * Statues musicales (cedric, 26 et 27 octobre) : chaque chanson est un tour. La chanson entière part de 0:00 ; Sarah
 * coupe la musique quand elle veut (« ✋ STATUE ! ») et la relance là où elle s'était arrêtée (« 💃 On danse ! »).
 * Quand elle le décide (ou quand la chanson est finie), elle désigne la ou les équipes qui ont le mieux dansé, ou
 * « Personne » : la TV fait durer le suspense, montre les gagnantes dans leur couleur, puis le récap des scores. Ensuite
 * Sarah lance la chanson suivante, ou passe au jeu suivant. Plus de chrono ni d'arrêts automatiques.
 */

/**
 * Une chanson des statues : [songId] = la chanson de la bibliothèque, jouée entière (copiée dans la partie sous
 * games/<code>/songs) ; [audioId] = son extrait, joué si la chanson entière manque ; [title] = son titre, pour la régie.
 */
data class ChansonStatues(val songId: String?, val audioId: String?, val title: String? = null)

/**
 * Durée de l'annonce des gagnantes à la TV, roulement de tambour compris, avant le récap des scores : la régie attend
 * jusque-là pour proposer la chanson suivante.
 */
const val STATUES_ANNONCE_MS = 8_000L

/** Bilan d'une chanson : [winners] (vide : « Personne »), et les points qu'elle a donnés à chaque équipe. */
data class StatuesResult(val song: Int, val winners: List<String>, val gains: Map<String, Int>, val at: Long)

/**
 * Statues en cours : la chanson [song] (de 0 à [Question.statuesTours] − 1). [dancing] : la musique joue (DANSEZ !),
 * sinon STATUE ! (coupée par Sarah, ou chanson finie). [playedMs] : musique déjà jouée avant [since], l'heure du
 * serveur où elle a repris (null quand elle est arrêtée : statue, pause, fin). [ended] : la chanson est allée au bout.
 * [result] : les gagnantes de cette chanson, une fois désignées.
 */
data class StatuesRound(
    val song: Int = 0,
    val dancing: Boolean = true,
    val playedMs: Long = 0,
    val since: Long? = null,
    val ended: Boolean = false,
    val result: StatuesResult? = null,
) {
    /** Où en est la chanson à l'heure du serveur [now] (millisecondes depuis son début). */
    fun positionMs(now: Long): Long = playedMs + (since?.let { (now - it).coerceAtLeast(0) } ?: 0)

    /** La musique s'arrête : ce qu'elle a joué depuis [since] est compté. */
    fun arretee(at: Long): StatuesRound = copy(playedMs = positionMs(at), since = null)

    /** La chanson se joue encore : ni finie, ni jugée. */
    val enCours: Boolean get() = result == null && !ended
}
