package com.littlemissparty.quiz.tv

/**
 * Couleurs proposées aux équipes, les mêmes que sur le pupitre (web/public/theme.js) : d'abord les 4 des bracelets
 * et des bandeaux (rose, orange, vert, jaune), puis bleu, violet, rouge et turquoise au-delà de 4 équipes.
 */
val TEAM_COLORS = listOf("#FF2D95", "#FF6B1A", "#39FF14", "#FFE600", "#2B86C5", "#9B5DE5", "#F94144", "#2EE8E0")

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
