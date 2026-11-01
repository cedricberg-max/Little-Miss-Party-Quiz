package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.graphics.Color
import kotlin.math.abs

/*
 * Classements qui bougent (Coffres mystères) : rangs avant et après, ce qui arrive à chaque équipe, et les petits
 * textes de points. Repris de l'ancien jeu des portes, supprimé le 31/10 (cedric).
 */

/** Gain qui fait sonner le jackpot (Coffres mystères). */
const val GROS_GAIN = 300

/** 1 250 : les milliers séparés par une espace, quelle que soit la langue de la box. */
fun espaceMilliers(n: Int): String = (if (n < 0) "−" else "") + abs(n).toString().reversed().chunked(3).joinToString(" ").reversed()

/** « +300 », « −150 » (vrai signe moins). */
fun texteValeur(v: Int): String = (if (v < 0) "−" else "+") + abs(v)

/** Une ligne du classement : scores avant et après, rangs (1 = premier) calculés par la partie. */
data class LigneClassement(val nom: String, val couleur: Color, val avant: Int, val apres: Int, val rangAvant: Int, val rangApres: Int)

/** Rang (0 = premier) de chaque équipe selon [scores] ; à égalité, [departage] (rang précédent) puis l'ordre des équipes. */
fun rangs(scores: List<Int>, departage: List<Int>? = null): List<Int> {
    val ordre = scores.indices.sortedWith(compareByDescending<Int> { scores[it] }.thenBy { departage?.get(it) ?: 0 }.thenBy { it })
    val r = IntArray(scores.size)
    ordre.forEachIndexed { place, i -> r[i] = place }
    return r.toList()
}

enum class Recit { TOUJOURS_EN_TETE, NOUVEAU_PREMIER, TUILE_DU_PREMIER, MONTE, DESCEND, TIENT, AUCUN }

/** Ce qui arrive à une équipe ; rangs à partir de 0. */
data class Evolution(val rangAvant: Int, val rangApres: Int, val recit: Recit) {
    val places get() = rangAvant - rangApres
}

/** Ce qui arrive à chaque équipe entre le classement d'avant et celui d'après. */
fun evolutions(lignes: List<LigneClassement>): List<Evolution> = lignes.map { l ->
    val a = l.rangAvant - 1
    val p = l.rangApres - 1
    val recit = when {
        lignes.size == 1 -> Recit.TOUJOURS_EN_TETE
        a == 0 && p == 0 -> Recit.TOUJOURS_EN_TETE
        p == 0 -> Recit.NOUVEAU_PREMIER
        a == 0 -> Recit.TUILE_DU_PREMIER
        p < a -> Recit.MONTE
        p > a -> Recit.DESCEND
        l.apres > l.avant -> Recit.TIENT
        else -> Recit.AUCUN
    }
    Evolution(a, p, recit)
}

fun texteRecit(e: Evolution): String? = when (e.recit) {
    Recit.TOUJOURS_EN_TETE -> "Toujours en tête !"
    Recit.NOUVEAU_PREMIER -> "Nouveau n°1 !"
    Recit.TUILE_DU_PREMIER -> "Aïe, la tuile !"
    Recit.MONTE -> "+${e.places} place${if (e.places > 1) "s" else ""} !"
    Recit.DESCEND -> "−${-e.places} place${if (e.places < -1) "s" else ""}"
    // « Ça tient ! » n'était pas clair (cedric, 21/10) : l'équipe a marqué des points mais reste à la même place.
    Recit.TIENT -> "Garde sa place !"
    Recit.AUCUN -> null
}
