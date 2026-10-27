package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.AlignmentLine
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.offset
import androidx.compose.ui.unit.sp
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Nom du gagnant du podium, version « nerveuse » (cedric, 24/10 : « un tout petit peu plus nerveuse ») : maquette de
 * référence podmock/mock.html, nomNerveux(). Bungee à la couleur de l'équipe, contour sombre, deux lueurs, reflet
 * blanc sur le haut des lettres ; les lettres claquent une à une (×2,4 → 1 avec ressort, flash blanc), le mot complet
 * fait une onde de choc et un glitch cyan / magenta, puis le nom bat sur les temps de Digital Love (accent sur chaque
 * mesure), un reflet le balaie toutes les 4 battues et des étincelles en jaillissent ; « 900 POINTS » défile puis éclate.
 * Le nombre affiché à la fin est le vrai score ([Classee.points]) : rien ici ne compte de points.
 *
 * Léger pour la Mi Box : chaque couche d'une lettre (lueur, corps, flash) est dessinée une fois dans son propre calque
 * (CompositingStrategy.Offscreen) ; à chaque image seuls échelle, position et opacité des calques changent. Le glitch,
 * l'onde, le balayage et les étincelles sont de simples formes et lettres sans flou, dessinées seulement quand elles
 * sont visibles. Temps u en secondes depuis le solo ([Tempo.PODIUM_REVELATION]).
 */
@Composable
internal fun NomNerveux(g: Classee, ligneDeBase: Dp, ms: () -> Float, modifier: Modifier = Modifier) {
    val couleur = enNeon(g.couleur)
    val texte = g.nom.uppercase()
    val mesure = rememberTextMeasurer()
    val densite = LocalDensity.current
    // Les lettres une à une : taille ramenée pour que le nom entier tienne dans NOM_LARGEUR_MAX (jamais coupé).
    val lettres = remember(texte, densite) {
        fun style(t: Float) = TextStyle(fontFamily = PoliceGsTitre, fontSize = t.sp)
        fun largeur(t: Float) = texte.sumOf { mesure.measure(it.toString(), style(t), maxLines = 1, softWrap = false).size.width }
        val maxPx = with(densite) { NOM_LARGEUR_MAX.dp.toPx() }
        val l0 = largeur(NOM_TAILLE)
        val taille = if (l0 > maxPx) NOM_TAILLE * maxPx / l0 else NOM_TAILLE
        val mises = texte.map { mesure.measure(it.toString(), style(taille), maxLines = 1, softWrap = false) }
        val total = mises.sumOf { it.size.width }.toFloat()
        var x = with(densite) { 480.dp.toPx() } - total / 2
        LettresNom(
            mises.mapIndexed { i, m -> LettreNom(texte[i], m, x).also { x += m.size.width } },
            tailleTexte = with(densite) { taille.sp.toPx() },
            largeur = total,
        )
    }
    val n = texte.length
    val ev = remember(n) { evenementsNerveux(n) }
    // La bande du nom : de 140 dp au-dessus de la ligne de base à 90 dp dessous ; les lettres y sont placées en px.
    val haut = ligneDeBase - 140.dp
    val base = with(densite) { 140.dp.toPx() }
    val cap = lettres.tailleTexte * CAP_SUR_TAILLE
    val u = { (ms() - Tempo.PODIUM_REVELATION) / 1000f }
    Box(
        modifier.fillMaxWidth().height(230.dp).offset(y = haut)
            .clearAndSetSemantics { text = AnnotatedString("Victoire de ${g.nom}") },
    ) {
        // Derrière : voile sombre, onde de choc au mot complet, copies cyan / magenta du glitch.
        Canvas(Modifier.fillMaxSize()) {
            val t = u()
            if (t < 0f) return@Canvas
            val c = Offset(size.width / 2, base - cap)
            val voile = 0.6f * lisse((t - NV_D0) / 0.3f)
            if (voile > 0f) {
                drawRect(Brush.radialGradient(listOf(GS.Noir.copy(alpha = voile), Color.Transparent), c, (lettres.largeur * 0.7f).coerceAtLeast(1f)))
            }
            val dM = t - ev.tMot
            if (dM in 0f..0.45f) {
                val k = dM / 0.45f
                val rx = (lettres.largeur / 2 + 20.dp.toPx()) * (1 + 0.5f * k)
                val ry = 45.dp.toPx() * (1 + 0.9f * k)
                val a = 0.45f * (1 - k) * (1 - k)
                // Anneau néon flou imité par trois traits de plus en plus larges et pâles.
                for ((largeur, part) in listOf(28f to 0.25f, 16f to 0.5f, 6f to 1f)) {
                    drawOval(couleur.copy(alpha = a * part), Offset(c.x - rx, c.y - ry), Size(2 * rx, 2 * ry), style = Stroke(largeur.dp.toPx() * (1.2f - k)))
                }
            }
            val gl = maxOf(if (t - NV_D0 in 0f..0.12f) 1 - (t - NV_D0) / 0.12f else 0f, if (dM in 0f..0.14f) 1 - dM / 0.14f else 0f)
            if (gl > 0f) {
                for ((teinte, dx) in listOf(GS.Cyan to -5f, GS.Rose to 5f)) {
                    lettres.liste.forEachIndexed { i, l ->
                        val e = etatLettre(t, i, ev) ?: return@forEachIndexed
                        lettre(l, e, base, cap) { drawText(l.mise, teinte, Offset(l.x + dx.dp.toPx() * gl, base - l.mise.firstBaseline), alpha = 0.55f * gl * e.alpha) }
                    }
                }
            }
        }
        // Les lettres : un groupe par lettre (position, échelle, opacité), trois calques figés dedans.
        lettres.liste.forEachIndexed { i, l ->
            if (l.c.isWhitespace()) return@forEachIndexed
            val lw = l.mise.size.width
            val lh = l.mise.size.height
            val gauche = l.x
            val dessus = base - l.mise.firstBaseline
            Box(
                Modifier
                    .offset { androidx.compose.ui.unit.IntOffset(gauche.roundToInt(), dessus.roundToInt()) }
                    .size(with(densite) { lw.toDp() }, with(densite) { lh.toDp() })
                    .graphicsLayer {
                        val e = etatLettre(u(), i, ev)
                        if (e == null) {
                            alpha = 0f
                        } else {
                            alpha = e.alpha
                            scaleX = e.echelle
                            scaleY = e.echelle
                            translationY = e.dy.dp.toPx()
                        }
                        transformOrigin = TransformOrigin(0.5f, ((l.mise.firstBaseline - cap) / lh).coerceIn(0f, 1f))
                        compositingStrategy = CompositingStrategy.ModulateAlpha
                    },
            ) {
                // Grande lueur, qui bat sur les temps et s'allume au flash.
                Spacer(
                    Modifier.fillMaxSize().debordement(56.dp)
                        .graphicsLayer {
                            val e = etatLettre(u(), i, ev)
                            alpha = if (e == null) 0f else minOf(1f, 0.3f + 0.55f * e.pouls + 0.5f * e.flash)
                            compositingStrategy = CompositingStrategy.Offscreen
                        }
                        .drawBehind {
                            val m = 56.dp.toPx()
                            drawText(l.mise, couleur, Offset(m, m), shadow = Shadow(couleur, Offset.Zero, 34.dp.toPx()))
                        },
                )
                // Corps : contour sombre, lettre néon et sa lueur serrée, reflet blanc sur le haut.
                Spacer(
                    Modifier.fillMaxSize().debordement(28.dp)
                        .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                        .drawBehind {
                            val m = 28.dp.toPx()
                            val o = Offset(m, m)
                            drawText(l.mise, GS.Noir.copy(alpha = 0.68f), o, drawStyle = Stroke(7.dp.toPx(), join = StrokeJoin.Round))
                            drawText(l.mise, couleur, o, shadow = Shadow(couleur.copy(alpha = 0.95f), Offset.Zero, 14.dp.toPx()))
                            val b = l.mise.firstBaseline
                            val t = lettres.tailleTexte
                            drawText(
                                l.mise,
                                Brush.verticalGradient(0f to Color.White.copy(alpha = 0.8f), 0.55f to Color.White.copy(alpha = 0.12f), 1f to Color.Transparent, startY = b - 0.805f * t, endY = b - 0.17f * t),
                                o,
                            )
                        },
                )
                // Flash blanc à l'impact de la lettre et au mot complet.
                Spacer(
                    Modifier.fillMaxSize().debordement(8.dp)
                        .graphicsLayer {
                            val e = etatLettre(u(), i, ev)
                            alpha = if (e == null) 0f else 0.85f * e.flash
                            compositingStrategy = CompositingStrategy.Offscreen
                        }
                        .drawBehind { drawText(l.mise, Color.White, Offset(8.dp.toPx(), 8.dp.toPx())) },
                )
            }
        }
        // Balayage : un reflet blanc incliné traverse les lettres en 0,35 s, toutes les 4 battues.
        Spacer(
            Modifier.fillMaxSize()
                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .drawBehind {
                    val t = u()
                    val tb = t - ev.tMot - 0.15f
                    if (tb < 0f) return@drawBehind
                    val bal = (tb % (4 * NV_BT)) / 0.35f
                    if (bal >= 1f) return@drawBehind
                    lettres.liste.forEachIndexed { i, l ->
                        val e = etatLettre(t, i, ev) ?: return@forEachIndexed
                        lettre(l, e, base, cap) { drawText(l.mise, Color.White, Offset(l.x, base - l.mise.firstBaseline)) }
                    }
                    val bx = size.width / 2 - lettres.largeur / 2 - 100.dp.toPx() + (lettres.largeur + 200.dp.toPx()) * bal
                    val d = 35.dp.toPx()
                    drawRect(
                        Brush.linearGradient(
                            0f to Color.Transparent, 0.5f to Color.White, 1f to Color.Transparent,
                            start = Offset(bx - d, base), end = Offset(bx + d, base + 0.35f * d),
                        ),
                        blendMode = BlendMode.SrcIn,
                    )
                },
        )
        // Étincelles : une gerbe de 7 étoiles à chaque temps (12 sur le premier de la mesure), 0,4 s de vie.
        Canvas(Modifier.fillMaxSize()) {
            val t = u()
            if (t <= ev.tMot) return@Canvas
            val nb = floor(t / NV_BT).toInt()
            for (b in maxOf(0, nb - 1)..nb) {
                val d = t - b * NV_BT
                if (d < 0f || d > 0.4f || b * NV_BT < ev.tMot) continue
                gerbe(b, d / 0.4f, couleur, lettres.largeur, Offset(size.width / 2, base - 20.dp.toPx()))
            }
        }
    }
}

/** « 900 POINTS » sous le nom : défile de 0 au vrai score en 0,6 s, éclate (×1,35 → 1, flash), puis bat sur les temps. */
@Composable
internal fun PointsNerveux(points: Int, longueurNom: Int, ligneDeBase: Dp, ms: () -> Float) {
    val ev = remember(longueurNom) { evenementsNerveux(longueurNom) }
    val u = { (ms() - Tempo.PODIUM_REVELATION) / 1000f }
    val valeur by remember(points) {
        derivedStateOf {
            val d = u() - ev.tPts
            if (d <= 0f) 0 else if (d >= 0.6f) points else (points * (1 - (1 - d / 0.6f).pow(3))).roundToInt()
        }
    }
    // Chiffres espacés : en Black, « 1217 » se touchait (« 1 » collés, Mi Box, cedric 26/10).
    val style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = 28.sp, color = GS.Jaune, letterSpacing = 2.5.sp, shadow = Shadow(GS.Jaune.copy(alpha = 0.8f), Offset.Zero, 22f))
    Box(
        Modifier.fillMaxSize().clearAndSetSemantics {}.graphicsLayer {
            val t = u()
            val d = t - ev.tPts
            alpha = (d / 0.08f).coerceIn(0f, 1f)
            val e = d - 0.6f
            val ec = if (e >= 0f) 1 + 0.35f * exp(-e * 11) * cos(e * 18) else 0.92f
            val s = ec * (1 + 0.03f * poulsNerveux(t, ev.tMot))
            scaleX = s
            scaleY = s
            transformOrigin = TransformOrigin(0.5f, ((ligneDeBase.toPx() - 10.dp.toPx()) / size.height).coerceIn(0f, 1f))
            compositingStrategy = CompositingStrategy.ModulateAlpha
        },
    ) {
        val texte = "$valeur POINTS"
        Text(texte, style = style, maxLines = 1, softWrap = false, modifier = Modifier.surLigneDeBase(ligneDeBase))
        Text(
            texte, style = style.copy(color = Color(0xFFFFF7B0)), maxLines = 1, softWrap = false,
            modifier = Modifier.surLigneDeBase(ligneDeBase).graphicsLayer {
                val e = u() - ev.tPts - 0.6f
                alpha = if (e in 0f..0.2f) 1 - e / 0.2f else 0f
            },
        )
    }
}

/** Les autres équipes sous le gagnant, « 2  Les Dragons 770      3  … », sur une ou deux lignes, jamais coupées. */
@Composable
internal fun ClassementNerveux(autres: List<Classee>, classement: List<Classee>, lignesDeBase: List<Dp>, ms: () -> Float) {
    if (autres.isEmpty()) return
    val mesure = rememberTextMeasurer()
    val densite = LocalDensity.current
    val entrees = autres.map { e -> "${1 + classement.count { it.points > e.points }}  ${e.nom} ${e.points}" }
    val lignes = if (lignesDeBase.size > 1) entrees.chunked((entrees.size + 1) / 2) else listOf(entrees)
    val textes = lignes.map { it.joinToString("      ") }
    fun style(t: Float) = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = t.sp, color = GS.Encre.copy(alpha = 0.85f), shadow = Shadow(Color.Black, Offset.Zero, 10f))
    val taille = remember(textes, densite) {
        val maxPx = with(densite) { CLASSEMENT_LARGEUR_MAX.dp.toPx() }
        val l = textes.maxOf { mesure.measure(it, style(15f), maxLines = 1, softWrap = false).size.width }.toFloat()
        if (l > maxPx) 15f * maxPx / l else 15f
    }
    Box(
        Modifier.fillMaxSize().graphicsLayer {
            alpha = (((ms() - Tempo.PODIUM_REVELATION) / 1000f - 2.4f) / 0.5f).coerceIn(0f, 1f)
            compositingStrategy = CompositingStrategy.ModulateAlpha
        },
    ) {
        textes.forEachIndexed { k, t ->
            Text(t, style = style(taille), maxLines = 1, softWrap = false, modifier = Modifier.surLigneDeBase(lignesDeBase[k.coerceAtMost(lignesDeBase.size - 1)]))
        }
    }
}

/** Secousse de caméra (dp) au premier impact et au mot complet, comme secousseNerveux() de la maquette. */
internal fun secousseNerveuse(u: Float, longueurNom: Int): Offset {
    val ev = evenementsNerveux(longueurNom)
    var x = 0f
    var y = 0f
    for ((t0, a) in listOf(ev.t1 to 6f, ev.tMot to 9f)) {
        val d = u - t0
        if (d < 0f || d > 0.4f) continue
        val e = a * exp(-14 * d)
        x += e * sin(97 * d)
        y += e * cos(83 * d) * 0.7f
    }
    return Offset(x, y)
}

/** Battue de Digital Love dans gs_podium (s) : 124,7 battues par minute, le solo part sur un premier temps. */
internal const val NV_BT = 0.48105f
internal const val NV_D0 = 0.2f
private const val NV_ECH0 = 2.4f
private const val NV_AMORT = 12f
private const val NV_FREQ = 16f
private const val NV_FLASH = 0.15f
private const val NOM_TAILLE = 59f
/** Largeur maximale du nom (dp sur 960) : même à ×2,4 à l'impact, la première et la dernière lettre restent à l'écran. */
internal const val NOM_LARGEUR_MAX = 860f
internal const val CLASSEMENT_LARGEUR_MAX = 900f
/** Hauteur du milieu des capitales Bungee au-dessus de la ligne de base, en part de la taille du texte (44 / 118). */
private const val CAP_SUR_TAILLE = 0.373f

/** Instants clés (s depuis le solo) : 1re lettre, mot complet, début des points ; une lettre par double croche. */
internal class EvenementsNerveux(val pas: Float, val t1: Float, val tMot: Float, val tPts: Float)

internal fun evenementsNerveux(longueur: Int): EvenementsNerveux {
    val pas = NV_BT / 4
    val l = longueur.coerceAtLeast(1)
    return EvenementsNerveux(pas, NV_D0, NV_D0 + (l - 1) * pas + 0.06f, NV_D0 + (l - 1) * pas + 0.16f)
}

/** Pulsation sur chaque temps après le mot complet, plus forte sur le premier temps de la mesure. */
internal fun poulsNerveux(u: Float, tMot: Float): Float {
    if (u <= tMot) return 0f
    val x = u / NV_BT
    val nb = floor(x).toInt()
    return exp(-(x - nb) * 9) * (if (nb % 4 == 0) 1.6f else 1f)
}

/** État d'une lettre à u : null tant qu'elle n'est pas tombée. Échelle de 2,4 à 1 avec ressort, puis respiration. */
internal class EtatLettre(val echelle: Float, val alpha: Float, val dy: Float, val flash: Float, val pouls: Float)

internal fun etatLettre(u: Float, i: Int, ev: EvenementsNerveux): EtatLettre? {
    val d = u - (NV_D0 + i * ev.pas)
    if (d <= 0f) return null
    val pouls = poulsNerveux(u, ev.tMot)
    val dM = u - ev.tMot
    val coupMot = if (dM >= 0f) exp(-dM * 10) else 0f
    val souffle = 1 + 0.05f * pouls + 0.12f * coupMot * cos(dM * 22)
    val ressort = 1 + (NV_ECH0 - 1) * exp(-NV_AMORT * d) * cos(NV_FREQ * d)
    val flash = maxOf(if (d < NV_FLASH) 1 - d / NV_FLASH else 0f, 0.8f * coupMot)
    return EtatLettre(ressort * souffle, (d / 0.05f).coerceIn(0f, 1f), -30f * exp(-18 * d) - 3f * pouls, flash, pouls)
}

private class LettreNom(val c: Char, val mise: TextLayoutResult, val x: Float)
private class LettresNom(val liste: List<LettreNom>, val tailleTexte: Float, val largeur: Float)

/** Dessine [bloc] avec la transformation de la lettre (échelle autour du milieu de ses capitales, saut vertical). */
private inline fun DrawScope.lettre(l: LettreNom, e: EtatLettre, base: Float, cap: Float, bloc: DrawScope.() -> Unit) {
    val pivot = Offset(l.x + l.mise.size.width / 2f, base - cap)
    val dy = e.dy.dp.toPx()
    withTransform({
        translate(0f, dy)
        scale(e.echelle, e.echelle, pivot)
    }) { bloc() }
}

/** Une gerbe d'étoiles à 4 branches qui jaillit du nom vers l'extérieur (positions fixées par le numéro du temps). */
private fun DrawScope.gerbe(temps: Int, k: Float, couleur: Color, largeurNom: Float, centre: Offset) {
    val n = if (temps % 4 == 0) 12 else 7
    val vie = sin(minOf(1f, k * 1.3f) * Math.PI.toFloat())
    for (j in 0 until n) {
        val h1 = ((j * 7919 + temps * 104729) % 1000) / 1000f
        val h2 = ((j * 3571 + temps * 7477) % 1000) / 1000f
        val ox = centre.x - largeurNom / 2 + h1 * largeurNom
        val oy = centre.y + (h2 - 0.5f) * 40.dp.toPx()
        val ang = atan2(oy - centre.y, ox - centre.x + 0.001f) + (h2 - 0.5f)
        val dist = (20f + 65f * (1 - (1 - k) * (1 - k) * (1 - k))).dp.toPx()
        val sx = ox + cos(ang) * dist * (0.6f + h2)
        val sy = oy + sin(ang) * dist * 0.55f - 15.dp.toPx() * k
        val tl = (1.5f + 4f * vie).dp.toPx()
        val p = Path().apply {
            moveTo(sx, sy - tl * 2)
            quadraticBezierTo(sx, sy, sx + tl * 2, sy)
            quadraticBezierTo(sx, sy, sx, sy + tl * 2)
            quadraticBezierTo(sx, sy, sx - tl * 2, sy)
            quadraticBezierTo(sx, sy, sx, sy - tl * 2)
            close()
        }
        drawPath(p, (if (j % 3 == 0) couleur else Color.White).copy(alpha = vie.coerceIn(0f, 1f)))
    }
}

private fun lisse(x: Float): Float {
    val t = x.coerceIn(0f, 1f)
    return t * t * (3 - 2 * t)
}

/** Déborde de [marge] de tous côtés sans changer la place occupée : le calque garde toute la lueur des lettres. */
private fun Modifier.debordement(marge: Dp): Modifier = layout { mesurable, contraintes ->
    val m = marge.roundToPx()
    val p = mesurable.measure(contraintes.offset(2 * m, 2 * m))
    layout((p.width - 2 * m).coerceAtLeast(0), (p.height - 2 * m).coerceAtLeast(0)) { p.place(-m, -m) }
}

/** Place un texte centré horizontalement, sa première ligne de base à [ligne] du haut du parent. */
internal fun Modifier.surLigneDeBase(ligne: Dp): Modifier = layout { mesurable, contraintes ->
    val p = mesurable.measure(contraintes.copy(minWidth = 0, minHeight = 0))
    val b = p[FirstBaseline].takeIf { it != AlignmentLine.Unspecified } ?: p.height
    layout(contraintes.maxWidth, contraintes.maxHeight) { p.place((contraintes.maxWidth - p.width) / 2, ligne.roundToPx() - b) }
}
