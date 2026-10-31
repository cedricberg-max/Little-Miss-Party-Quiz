package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Mise en page des équipes, de 1 à 8, sans jamais rien pousser hors de l'écran.
 * La règle vaut pour tous les jeux, actuels et futurs : la plupart des fêtes ont 4 équipes, mais il peut y en avoir 8.
 * Les puces reçoivent une largeur imposée : leur nom doit tenir sur une ligne (maxLines = 1, points de suspension).
 * Quand la place manque, elles sont dites « compactes » : texte plus petit, statut abrégé.
 */

/**
 * Bandeau du bas d'écran : les puces des équipes, et les boutons de l'animatrice à droite.
 * 1. Si toutes les puces tiennent à leur largeur naturelle à côté des boutons : une seule ligne, comme d'habitude.
 * 2. Sinon, des rangs de puces à largeur égale (au moins [largeurConfort], pour que les noms restent lisibles),
 *    le dernier rang partageant la ligne des boutons quand il y a la place, sinon les boutons dessous.
 * 3. En dernier recours (8 équipes et trois boutons), deux rangs de puces compactes au-dessus des boutons.
 */
@Composable
fun BandeauEquipes(
    nombre: Int,
    modifier: Modifier = Modifier,
    largeurConfort: Dp = 150.dp,
    largeurMax: Dp = 230.dp,
    ecart: Dp = 10.dp,
    actions: @Composable () -> Unit = {},
    puce: @Composable (index: Int, compacte: Boolean, modifier: Modifier) -> Unit,
) {
    SubcomposeLayout(modifier) { c ->
        val w = c.maxWidth
        val gap = ecart.roundToPx()
        val max = largeurMax.roundToPx()
        val confort = largeurConfort.roundToPx()
        val boutons = subcompose("actions", actions).map { it.measure(Constraints(maxWidth = w, maxHeight = c.maxHeight)) }
        val bw = boutons.sumOf { it.width }
        val bh = boutons.maxOfOrNull { it.height } ?: 0
        val n = nombre.coerceAtLeast(0)
        val aCote = w - bw - if (bw > 0) gap * 2 else 0
        fun largeur(dispo: Int, parRang: Int) = ((dispo - gap * (parRang - 1)) / parRang.coerceAtLeast(1)).coerceIn(0, max)
        val normales = (0 until n).map { i -> subcompose("puce$i") { puce(i, false, Modifier) } }
        val naturelles = normales.map { m -> (m.maxOfOrNull { it.maxIntrinsicWidth(c.maxHeight) } ?: 0).coerceAtMost(max) }
        // Disposition : largeurs des puces, nombre par rang, et le dernier rang partage-t-il la ligne des boutons ?
        var largeurs: List<Int>? = null
        var parRang = n.coerceAtLeast(1)
        var memeLigne = true
        var compacte = false
        if (naturelles.sum() + gap * (n - 1).coerceAtLeast(0) <= aCote) {
            largeurs = naturelles
        } else {
            for (rangs in 1..2) {
                val pr = (n + rangs - 1) / rangs
                val dernier = n - pr * (rangs - 1)
                val u = minOf(largeur(w, pr), largeur(aCote, dernier))
                if (u >= confort) { largeurs = List(n) { u }; parRang = pr; break }
            }
            if (largeurs == null) {
                memeLigne = false
                for (rangs in 1..2) {
                    val pr = (n + rangs - 1) / rangs
                    val u = largeur(w, pr)
                    if (u >= confort || rangs == 2) {
                        largeurs = List(n) { u }; parRang = pr; compacte = u < confort; break
                    }
                }
            }
        }
        // Plan retenu, puis deux replis si la place manque en hauteur (écran déjà chargé au-dessus) : puces compactes
        // au-dessus des boutons, puis un rang de puces compactes au-dessus et les autres sur la ligne des boutons. Sans
        // ces replis, la hauteur était rognée et les boutons recouvraient le second rang (mimes à 8 équipes, 21/10).
        val compactes = (0 until n).map { i -> subcompose("compacte$i") { puce(i, true, Modifier) } }
        /** [tailles] : nombre de puces de chaque rang, de haut en bas. */
        class Plan(val largeurs: List<Int>, val tailles: List<Int>, val memeLigne: Boolean, val compacte: Boolean)
        fun rangsDe(t: Int) = List((n + t - 1) / t.coerceAtLeast(1)) { r -> minOf(t, n - r * t) }
        fun hauteur(p: Plan): Int {
            val src = if (p.compacte) compactes else normales
            var k = 0
            val hr = p.tailles.map { t -> (0 until t).maxOf { src[k + it].maxOfOrNull { m -> m.maxIntrinsicHeight(p.largeurs[k + it]) } ?: 0 }.also { k += t } }.toMutableList()
            if (hr.isEmpty()) return bh
            if (p.memeLigne) hr[hr.lastIndex] = maxOf(hr.last(), bh)
            val hp = hr.sum() + gap * (hr.size - 1)
            return if (p.memeLigne) hp else hp + if (bh > 0) gap + bh else 0
        }
        val deux = ((n + 1) / 2).coerceAtLeast(1)
        // Dernier repli : le plus de puces possible à côté des boutons, chacune encore lisible, les autres au-dessus.
        val lisible = (largeurConfort * 0.75f).roundToPx()
        val aLaLigne = (n - 1 downTo 1).firstOrNull { m -> largeur(aCote, m) >= lisible && largeur(w, n - m) >= lisible } ?: deux
        val plans = if (n == 0) listOf(Plan(emptyList(), emptyList(), memeLigne, compacte)) else listOf(
            Plan(largeurs ?: List(n) { largeur(w, n) }, rangsDe(parRang), memeLigne, compacte),
            Plan(List(n) { largeur(w, deux) }, rangsDe(deux), false, true),
            Plan(List(n) { i -> if (i < n - aLaLigne) largeur(w, n - aLaLigne) else largeur(aCote, aLaLigne) }, listOf(n - aLaLigne, aLaLigne).filter { it > 0 }, true, true),
        )
        val hauteurs = plans.map { hauteur(it) }
        val choisi = plans.indices.firstOrNull { hauteurs[it] <= c.maxHeight } ?: hauteurs.indices.minBy { hauteurs[it] }
        val plan = plans[choisi]
        memeLigne = plan.memeLigne
        val finales = plan.largeurs
        val sources = if (plan.compacte) compactes else normales
        val puces = sources.mapIndexed { i, m ->
            m.map { it.measure(Constraints(minWidth = finales[i], maxWidth = finales[i], maxHeight = c.maxHeight)) }
        }
        var debut = 0
        val rangs = plan.tailles.map { t -> puces.subList(debut, debut + t).also { debut += t } }
        val hauteurRang = rangs.map { r -> r.maxOfOrNull { p -> p.maxOfOrNull { it.height } ?: 0 } ?: 0 }.toMutableList()
        // Le dernier rang partage la ligne des boutons : il prend leur hauteur s'ils sont plus hauts.
        if (memeLigne && hauteurRang.isNotEmpty()) hauteurRang[hauteurRang.lastIndex] = maxOf(hauteurRang.last(), bh)
        val hPuces = hauteurRang.sum() + gap * (rangs.size - 1).coerceAtLeast(0)
        val h = when {
            rangs.isEmpty() -> bh
            memeLigne -> hPuces
            else -> hPuces + if (bh > 0) gap + bh else 0
        }.coerceAtMost(c.maxHeight)
        layout(w, h) {
            var y = 0
            var k = 0
            rangs.forEachIndexed { r, rang ->
                var x = 0
                rang.forEach { p ->
                    p.forEach { it.placeRelative(x, y + (hauteurRang[r] - it.height) / 2) }
                    x += finales[k++] + gap
                }
                y += hauteurRang[r] + gap
            }
            var x = w - bw
            val yb = if (memeLigne) h - (hauteurRang.lastOrNull() ?: bh) + ((hauteurRang.lastOrNull() ?: bh) - bh) / 2 else h - bh
            boutons.forEach { b -> b.placeRelative(x, yb + (bh - b.height) / 2); x += b.width }
        }
    }
}

/**
 * Liste des équipes dans un espace fixé (salon d'accueil) : en ligne, à leur largeur naturelle, tant qu'elles tiennent ;
 * sinon en grille compacte de 2 colonnes à largeur égale (3 si les noms restent lisibles). Un rang qui ne tient vraiment pas n'est pas montré, jamais
 * poussé plus bas : le bouton placé sous la grille reste toujours visible.
 */
@Composable
fun GrilleEquipes(
    nombre: Int,
    modifier: Modifier = Modifier,
    ecart: Dp = 16.dp,
    ecartCompact: Dp = 6.dp,
    largeurLisible: Dp = 160.dp,
    puce: @Composable (index: Int, compacte: Boolean, modifier: Modifier) -> Unit,
) {
    // Pas de rognage au cadre : une vignette qui apparaît ou buzze grossit un instant (rebond) et doit rester entière, coins
    // arrondis compris (vu par cedric le 22 octobre). Un rang qui ne tient pas en entier n'est simplement pas posé.
    SubcomposeLayout(modifier) { c ->
        val w = c.maxWidth
        val hMax = c.maxHeight
        val gap = ecart.roundToPx()
        val n = nombre.coerceAtLeast(0)
        // 1. À la largeur naturelle, retour à la ligne quand le rang est plein.
        val libres = (0 until n).map { i -> subcompose("libre$i") { puce(i, false, Modifier) }.map { it.measure(Constraints(maxWidth = w)) } }
        val rangsLibres = mutableListOf<MutableList<List<Placeable>>>()
        var largeurRang = 0
        libres.forEach { p ->
            val lp = p.maxOfOrNull { it.width } ?: 0
            if (rangsLibres.isEmpty() || largeurRang + gap + lp > w) {
                rangsLibres += mutableListOf(p)
                largeurRang = lp
            } else {
                rangsLibres.last() += p
                largeurRang += gap + lp
            }
        }
        fun hauteur(rangs: List<List<List<Placeable>>>) =
            rangs.sumOf { r -> r.maxOfOrNull { p -> p.maxOfOrNull { it.height } ?: 0 } ?: 0 } + gap * (rangs.size - 1).coerceAtLeast(0)
        if (c.hasBoundedHeight.not() || hauteur(rangsLibres) <= hMax || n <= 1) {
            val h = hauteur(rangsLibres).coerceAtMost(hMax)
            return@SubcomposeLayout layout(w, h) {
                var y = 0
                rangsLibres.forEach { r ->
                    val hr = r.maxOfOrNull { p -> p.maxOfOrNull { it.height } ?: 0 } ?: 0
                    var x = 0
                    if (y == 0 || y + hr <= h) r.forEach { p -> p.forEach { it.placeRelative(x, y + (hr - it.height) / 2) }; x += (p.maxOfOrNull { it.width } ?: 0) + gap }
                    y += hr + gap
                }
            }
        }
        // 2. Grille compacte à largeur égale : 2 colonnes, ou 3 si 2 ne tiennent pas en hauteur.
        val gc = ecartCompact.roundToPx()
        fun hauteurGrille(rangs: List<List<List<Placeable>>>) =
            rangs.sumOf { r -> r.maxOfOrNull { p -> p.maxOfOrNull { it.height } ?: 0 } ?: 0 } + gc * (rangs.size - 1).coerceAtLeast(0)
        var colonnes = 1
        var grille: List<List<List<Placeable>>>
        do {
            colonnes++
            val largeurColonne = (w - gc * (colonnes - 1)) / colonnes
            grille = (0 until n).map { i ->
                subcompose("grille$colonnes-$i") { puce(i, true, Modifier) }
                    .map { it.measure(Constraints(minWidth = largeurColonne, maxWidth = largeurColonne)) }
            }.chunked(colonnes)
        } while (hauteurGrille(grille) > hMax && colonnes < 3 && (w - gc * colonnes) / (colonnes + 1) >= largeurLisible.roundToPx())
        val lc = (w - gc * (colonnes - 1)) / colonnes
        val h = hauteurGrille(grille).coerceAtMost(hMax)
        layout(w, h) {
            var y = 0
            grille.forEach { r ->
                val hr = r.maxOfOrNull { p -> p.maxOfOrNull { it.height } ?: 0 } ?: 0
                if (y == 0 || y + hr <= h) r.forEachIndexed { k, p -> p.forEach { it.placeRelative(k * (lc + gc), y + (hr - it.height) / 2) } }
                y += hr + gc
            }
        }
    }
}

/**
 * Scène dessinée pour une surface de référence ([largeur] × [hauteur]) et agrandie ou réduite d'un bloc pour remplir
 * la place qui reste au-dessus des équipes et des boutons : de 1 à 8 équipes, tout garde ses proportions, rien ne
 * déborde. Textes, marges et images changent ensemble d'échelle ; la scène occupe toute la place (un peu plus large
 * ou plus haute que la référence selon l'écran).
 */
@Composable
fun Echelle(largeur: Dp, hauteur: Dp, modifier: Modifier = Modifier, maxi: Float = 1.25f, contenu: @Composable BoxScope.() -> Unit) {
    BoxWithConstraints(modifier.clipToBounds()) {
        val k = minOf(maxWidth / largeur, maxHeight / hauteur).coerceIn(0.2f, maxi)
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density * k, d.fontScale)) {
            Box(Modifier.fillMaxSize(), content = contenu)
        }
    }
}

/**
 * Le contenu garde sa taille s'il tient dans la hauteur ; sinon il rapetisse d'un bloc (textes, images et marges
 * ensemble) juste assez pour tenir, centré. Avec 8 équipes sur deux rangées, rien ne passe plus sous leurs cartes
 * (cedric, 30/10 : la règle du Pictionary à moitié mangée).
 */
@Composable
fun TientEnHauteur(modifier: Modifier = Modifier, contenu: @Composable () -> Unit) {
    val d = LocalDensity.current
    SubcomposeLayout(modifier) { c ->
        val libre = c.copy(minWidth = 0, minHeight = 0, maxHeight = Constraints.Infinity)
        val naturelle = subcompose("mesure", contenu).maxOfOrNull { it.measure(libre).height } ?: 0
        val k = echelleQuiTient(naturelle, if (c.hasBoundedHeight) c.maxHeight else Constraints.Infinity)
        val places = subcompose("place") {
            CompositionLocalProvider(LocalDensity provides Density(d.density * k, d.fontScale)) { contenu() }
        }.map { it.measure(c.copy(minWidth = 0, minHeight = 0)) }
        val largeur = if (c.hasBoundedWidth) c.maxWidth else places.maxOfOrNull { it.width } ?: 0
        val hauteur = if (c.hasBoundedHeight) c.maxHeight else places.maxOfOrNull { it.height } ?: 0
        layout(largeur, hauteur) { places.forEach { p -> p.place((largeur - p.width) / 2, (hauteur - p.height) / 2) } }
    }
}

/** Échelle (≤ 1) pour qu'un contenu haut de [naturelle] px tienne dans [place] px ; 1 s'il tient déjà. */
internal fun echelleQuiTient(naturelle: Int, place: Int): Float =
    if (naturelle <= 0 || naturelle <= place) 1f else (place.toFloat() / naturelle).coerceIn(0.2f, 1f)
