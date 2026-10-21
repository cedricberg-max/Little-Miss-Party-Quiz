package com.littlemissparty.quiz.engine

/*
 * Paroles du refrain au blind test (cedric, 21/10) : à la révélation, « on chante tous ensemble » avec les paroles qui
 * apparaissent au rythme de la chanson. La Régie PC lit le fichier .lrc de Sarah, garde seulement le passage du
 * refrain (l'extrait que la TV joue en boucle) et l'envoie dans la question (champ « lyrics ») sous une forme courte :
 * une ligne par phrase, « début|texte » ou « début|texte|temps des mots », temps en millisecondes depuis le début de
 * l'extrait du refrain. Une ligne sans texte est une pause instrumentale.
 */

/** Un mot chanté et son moment, en millisecondes depuis le début de l'extrait du refrain. */
data class MotParole(val texte: String, val debutMs: Long)

/** Une phrase chantée : de [debutMs] à [finMs] (le début de la suivante), ses mots ; aucun mot = pause. */
data class LigneParole(val debutMs: Long, val finMs: Long, val mots: List<MotParole>) {
    val texte: String get() = mots.joinToString(" ") { it.texte }
}

/** Taille maximale des paroles d'une question (caractères) et nombre de phrases gardées. */
const val MAX_PAROLES = 8_000
const val MAX_LIGNES_PAROLES = 120

/** Durée d'affichage de la dernière phrase, faute de phrase suivante. */
const val FIN_DERNIERE_LIGNE_MS = 6_000L

/** Mots sans temps dans le fichier : ils se suivent à ce rythme au plus (ms par mot), au prorata de leurs lettres. */
private const val MS_PAR_MOT = 420L

/**
 * Paroles de la forme courte : les phrases dans l'ordre, chacune jusqu'au début de la suivante. Les mots sans temps
 * (fichier .lrc phrase par phrase, le cas courant) reçoivent un moment estimé : la phrase est partagée au prorata des
 * lettres, sans jamais traîner plus de [MS_PAR_MOT] par mot. Une ligne illisible est ignorée : des paroles abîmées
 * ne doivent jamais empêcher de jouer.
 */
fun lireParoles(court: String?): List<LigneParole> {
    if (court.isNullOrBlank() || court.length > MAX_PAROLES) return emptyList()
    val brutes = court.lineSequence().mapNotNull { ligne ->
        val parts = ligne.split('|')
        val debut = parts.getOrNull(0)?.trim()?.toLongOrNull()?.takeIf { it in 0..3_600_000 } ?: return@mapNotNull null
        val mots = parts.getOrNull(1).orEmpty().split(' ').map { it.trim() }.filter { it.isNotEmpty() }
        val temps = parts.getOrNull(2)?.split(',')?.map { it.trim().toLongOrNull() }
            ?.takeIf { t -> t.size == mots.size && t.all { it != null && it >= 0 } }?.map { it!! }
        Triple(debut, mots, temps)
    }.take(MAX_LIGNES_PAROLES).sortedBy { it.first }.toList()
    return brutes.mapIndexed { i, (debut, mots, temps) ->
        val fin = brutes.getOrNull(i + 1)?.first ?: (debut + FIN_DERNIERE_LIGNE_MS)
        LigneParole(debut, fin, temps?.let { t -> mots.mapIndexed { k, m -> MotParole(m, t[k].coerceIn(debut, fin)) } } ?: estimerMots(mots, debut, fin))
    }
}

/** Moments estimés des [mots] d'une phrase chantée de [debut] à [fin], au prorata de leurs lettres. */
private fun estimerMots(mots: List<String>, debut: Long, fin: Long): List<MotParole> {
    if (mots.isEmpty()) return emptyList()
    val poids = mots.map { it.length + 2L }
    val total = poids.sum()
    val duree = minOf((fin - debut) * 85 / 100, MS_PAR_MOT * mots.size).coerceAtLeast(0)
    var avant = 0L
    return mots.mapIndexed { k, m ->
        MotParole(m, debut + duree * avant / total).also { avant += poids[k] }
    }
}
