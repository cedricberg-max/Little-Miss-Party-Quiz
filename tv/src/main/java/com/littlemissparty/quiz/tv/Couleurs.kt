package com.littlemissparty.quiz.tv

/** Couleurs proposées aux équipes, les mêmes que sur le pupitre (web/public/theme.js). */
val TEAM_COLORS = listOf("#FF3CAC", "#FFD166", "#06D6A0", "#2B86C5", "#9B5DE5", "#F94144", "#FF7F11", "#9EF01A")

/** Clé de réservation d'une couleur dans la base (games/<code>/colors/<clé>) : « #ff3cac » → « FF3CAC ». */
fun colorKey(color: String): String = color.removePrefix("#").uppercase()

/**
 * Couleur d'une équipe admise en cours de partie : celle qu'elle a demandée si aucune autre équipe ne l'a,
 * sinon la première couleur libre. Deux équipes n'ont jamais la même couleur.
 */
fun freeColor(wanted: String?, used: Collection<String>): String {
    val taken = used.map(::colorKey).toSet()
    val valid = wanted?.takeIf { it.startsWith("#") && colorKey(it).matches(Regex("[0-9A-F]{6}")) }
    if (valid != null && colorKey(valid) !in taken) return valid
    return TEAM_COLORS.firstOrNull { colorKey(it) !in taken } ?: valid ?: TEAM_COLORS.first()
}
