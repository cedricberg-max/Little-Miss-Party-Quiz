package com.littlemissparty.quiz.tv

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.lerp as melange
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.Gerbe
import com.littlemissparty.quiz.tv.habillage.PoliceGsTexte
import com.littlemissparty.quiz.tv.habillage.PoliceGsTitre
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.apres
import com.littlemissparty.quiz.tv.habillage.pointDuTour
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/*
 * Le Juste Chiffre du Game Show, révélation « A puis B » de la planche du 28/10 (validée par cedric) : la machine à
 * sous néon (rouleaux qui s'arrêtent de gauche à droite, tout passe au vert sur le son de la révélation), puis elle
 * monte et rétrécit sous la question ; la règle néon se dessine, un rayon vert descend de la machine jusqu'au bon nombre,
 * les équipes tombent à leur nombre, les écarts des deux plus proches, et « +100 » à côté de la plus proche.
 * Tout est dessiné en direct sur une seule toile (pas de vidéo) ; les textes sont mesurés une fois.
 */

/** Les instants (en secondes depuis la révélation) de la révélation A puis B, pour [chiffres] caractères. */
internal class MinutageJuste(val chiffres: Int, finMs: Long = Tempo.REVELATION_OR) {
    /** Tous les rouleaux arrêtés, la machine passe au vert : avec le son de la bonne réponse. */
    val fin = finMs / 1000f
    /** Le rouleau [i] s'arrête (de gauche à droite, une demi-seconde entre deux, jamais avant 0,35 s). */
    fun arret(i: Int) = (fin - (chiffres - 1 - i) * 0.5f).coerceAtLeast(0.35f + i * 0.12f).coerceAtMost(fin)
    val monte = fin + 0.95f
    val regle = monte + 0.5f
    val rayon = regle + 0.55f
    val pose = rayon + 0.35f
    fun equipe(i: Int) = regle + 1.1f + i * 0.22f
    fun ecart(i: Int) = regle + 2.1f + i * 0.3f
    val bonus = regle + 2.8f
}

/**
 * Le cadre sombre de la règle (choix A de cedric, 29/10) : du haut des noms des équipes du plus haut étage jusque sous
 * le dernier écart, en dp autour de la ligne de la règle ([haut] au-dessus, [bas] en dessous).
 */
internal data class CadreRegle(val haut: Float, val bas: Float)

internal fun cadreRegle(etageMax: Int, ecarts: Int): CadreRegle =
    CadreRegle(haut = 30f + etageMax.coerceAtLeast(0) * 50f + 31f + 22f, bas = if (ecarts <= 0) 62f else 80f + (ecarts.coerceAtMost(2) - 1) * 30f + 22f)

/** Bornes et pas des graduations de la règle : la réponse et tous les nombres dedans, avec un peu de marge. */
internal data class EchelleRegle(val bas: Double, val haut: Double, val pas: Double)

internal fun echelleRegle(valeurs: List<Long>): EchelleRegle {
    val lo = valeurs.minOrNull() ?: 0L
    val hi = valeurs.maxOrNull() ?: 0L
    val etendue = max(1.0, (hi - lo).toDouble())
    val marge = max(1.0, etendue * 0.08)
    val brut = (etendue + 2 * marge) / 9.0
    val p10 = 10.0.pow(floor(log10(brut)))
    val pas = listOf(1.0, 2.0, 5.0, 10.0).map { it * p10 }.first { it >= brut }.coerceAtLeast(1.0)
    return EchelleRegle(lo - marge, hi + marge, pas)
}

/**
 * Étage de chaque équipe au-dessus de la règle (0 = le plus bas) : deux équipes trop proches (leurs étiquettes se
 * toucheraient) ne sont jamais au même étage, tant qu'il en reste ([etages] au plus ; au-delà, le moins chargé).
 * [x] : la place de chaque équipe sur la règle ; [demi] : la demi-largeur de son étiquette.
 */
internal fun etagesEquipes(x: List<Float>, demi: List<Float>, etages: Int = 3): List<Int> {
    val ordre = x.indices.sortedBy { x[it] }
    val etage = IntArray(x.size)
    for (i in ordre) {
        val pris = ordre.takeWhile { it != i }.filter { j -> abs(x[j] - x[i]) < demi[i] + demi[j] }.map { etage[it] }
        etage[i] = (0 until etages).firstOrNull { it !in pris } ?: (0 until etages).minBy { e -> pris.count { it == e } }
    }
    return etage.toList()
}

private val Vert = GS.Juste
private val Cyan = GS.Cyan
private val Or = Color(0xFFFFC040)
private val Encre = GS.Encre
private val Graduation = Color(0xFF9FF6FF)

private fun lisse(x: Float): Float = x.coerceIn(0f, 1f).let { it * it * (3 - 2 * it) }
private fun dos(x: Float): Float {
    val u = x.coerceIn(0f, 1f) - 1f
    return 1f + 2.9f * u * u * u + 1.9f * u * u
}
private fun lerp(a: Float, b: Float, u: Float) = a + (b - a) * u

/** Une équipe qui a répondu : son nom, sa couleur, son nombre, ses points. */
private class Reponse(val nom: String, val couleur: Color, val nombre: Long, val points: Int, val ecart: Long)

@Composable
fun RevelationJusteChiffreGs(state: UiState.Playing, modifier: Modifier = Modifier) {
    val q = state.question ?: return
    val bonne = q.correct.toLong()
    val reponses = remember(q.id, state.awards, state.teams) {
        state.teams.mapNotNull { t ->
            val a = state.awards[t.uid] ?: return@mapNotNull null
            val n = a.choice?.toLong() ?: return@mapNotNull null
            Reponse(t.name, t.color.toColor(), n, a.points, abs(n - bonne))
        }.sortedBy { it.ecart }
    }
    val texteBonne = q.correct.toString()
    val minutage = remember(texteBonne) { MinutageJuste(texteBonne.length) }
    // L'horloge de la révélation, en secondes ; elle s'arrête une fois tout posé (dernière image tenue).
    val t by produceState(0f, q.id) {
        val debut = withFrameMillis { it }
        while (value < minutage.bonus + 4f) value = (withFrameMillis { it } - debut) / 1000f
    }
    val mesure = rememberTextMeasurer()
    val d = LocalDensity.current.density
    val textes = remember(q.id, reponses, d) { TextesJuste(mesure, texteBonne, reponses) }
    Box(
        // Lu par les tests et l'accessibilité : tout est dessiné sur la toile, le nombre et les écarts sont redits ici.
        modifier.semantics { contentDescription = "Le juste chiffre : $texteBonne" + reponses.joinToString("") { " · ${it.nom} écart ${it.ecart}" } }
            .testTag("juste-chiffre-gs"),
    ) {
        Canvas(Modifier.matchParentSize().clearAndSetSemantics {}) {
            dessineRevelation(t, minutage, textes, reponses, bonne)
        }
        // Une équipe pile sur le nombre : la gerbe de confettis avec ses points (« pile ! » est déjà sous la règle).
        val pile = reponses.any { it.ecart == 0L }
        Gerbe(cle = "pile ${q.id}", actif = apres((minutage.bonus * 1000).toLong(), q.id, actif = pile), modifier = Modifier.matchParentSize())
    }
}

/** Tous les textes de la révélation, mesurés une fois (la Mi Box ne remesure rien pendant l'animation). */
private class TextesJuste(m: TextMeasurer, bonne: String, reponses: List<Reponse>) {
    private fun style(police: androidx.compose.ui.text.font.FontFamily, taille: Float, couleur: Color, lueur: Color? = null, gras: Boolean = false) =
        TextStyle(fontFamily = police, fontSize = taille.sp, color = couleur, fontWeight = if (gras) FontWeight.Bold else null, shadow = lueur?.let { Shadow(it, Offset.Zero, taille * 0.5f) })
    val chiffres: List<TextLayoutResult> = bonne.map { m.measure(it.toString(), style(PoliceGsTitre, 110f, Color.White, Cyan)) }
    val chiffresVerts: List<TextLayoutResult> = bonne.map { m.measure(it.toString(), style(PoliceGsTitre, 110f, Color.White, Vert)) }
    val flous: List<TextLayoutResult> = (0..9).map { m.measure("$it", style(PoliceGsTitre, 110f, Color(0x8CB9C8FF))) }
    val titre = m.measure("LE JUSTE CHIFFRE", style(PoliceGsTitre, 23f, Color.White, Cyan))
    val pastille = m.measure(bonne, style(PoliceGsTitre, 21f, Color(0xFF0A2A05)))
    val noms = reponses.map { m.measure(it.nom, style(PoliceGsTexte, 16f, Encre, gras = true)) }
    val nombres = reponses.map { m.measure("${it.nombre}", style(PoliceGsTitre, if ("${it.nombre}".length > 3) 11f else 14f, Color(0xFF14081F))) }
    val ecarts = reponses.take(2).mapIndexed { i, r -> m.measure(if (r.ecart == 0L) "pile !" else "écart ${r.ecart}", style(PoliceGsTexte, 20f, if (i == 0) Or else Encre, gras = true)) }
    val bonus = reponses.firstOrNull()?.takeIf { it.points > 0 }?.let { m.measure("+${it.points}", style(PoliceGsTitre, 30f, Color.White, Or)) }
    private val mesureur = m
    private val graduations = HashMap<Long, TextLayoutResult>()
    fun graduation(v: Long): TextLayoutResult = graduations.getOrPut(v) { mesureur.measure("$v", style(PoliceGsTexte, 13f, Graduation, gras = true)) }
}

private fun DrawScope.texte(l: TextLayoutResult, centre: Offset, echelle: Float = 1f, alpha: Float = 1f) {
    if (alpha <= 0.01f) return
    scale(echelle, echelle, centre) { drawText(l, topLeft = Offset(centre.x - l.size.width / 2f, centre.y - l.size.height / 2f), alpha = alpha.coerceIn(0f, 1f)) }
}

private fun DrawScope.dessineRevelation(t: Float, m: MinutageJuste, x: TextesJuste, reponses: List<Reponse>, bonne: Long) {
    val dp = density
    val W = size.width
    val H = size.height
    val n = m.chiffres
    // --- A : la machine à sous ---
    val cw = 105f * dp
    val ch = 145f * dp
    val gap = 13f * dp
    val tw = n * cw + (n - 1) * gap
    val bord = 25f * dp
    val e0 = min(1f, min(W * 0.9f / (tw + 2 * bord), H * 0.62f / (ch + 2 * bord)))
    val mt = lisse((t - m.monte) / 0.6f)
    val echelle = lerp(0.55f, 1f, dos(t / 0.5f)) * e0 * lerp(1f, 0.42f, mt)
    val hautFinal = (ch + 2 * bord) * e0 * 0.42f
    val cx = W / 2f
    val cy = lerp(H * 0.5f, hautFinal / 2f + 2f * dp, mt)
    val fini = t >= m.fin + 0.05f
    val vert = lisse((t - m.fin) / 0.25f)
    // Rayons verts derrière la machine, une fois le nombre trouvé.
    val aRayons = vert * (1f - 0.6f * mt)
    if (aRayons > 0f) rotate(t * 20f, Offset(cx, cy)) {
        val l = max(W, H) * 0.7f
        for (k in 0 until 12) {
            val a = k * (2f * PI.toFloat() / 12f)
            val p = Path().apply {
                moveTo(cx, cy)
                lineTo(cx + cos(a - 0.06f) * l, cy + sin(a - 0.06f) * l)
                lineTo(cx + cos(a + 0.06f) * l, cy + sin(a + 0.06f) * l)
                close()
            }
            drawPath(p, Brush.radialGradient(listOf(Vert.copy(alpha = 0.32f * aRayons), Color.Transparent), Offset(cx, cy), l))
        }
    }
    translate(cx, cy) {
        scale(echelle, echelle, Offset.Zero) {
            val bx = -tw / 2f - bord
            val by = -ch / 2f - bord
            val bw = tw + 2 * bord
            val bh = ch + 2 * bord
            drawRoundRect(Color(0xE6060212), Offset(bx, by), Size(bw, bh), CornerRadius(20f * dp))
            val couleurBord = if (fini) Vert else Cyan
            val eclat = if (fini) 1f + 1.2f * exp(-(t - m.fin) * 3f) else 1f
            drawRoundRect(couleurBord.copy(alpha = (0.28f * eclat).coerceAtMost(0.7f)), Offset(bx, by), Size(bw, bh), CornerRadius(20f * dp), style = Stroke(12f * dp))
            drawRoundRect(couleurBord, Offset(bx, by), Size(bw, bh), CornerRadius(20f * dp), style = Stroke(3.5f * dp))
            // Ampoules qui courent autour pendant le roulement, puis clignotent toutes ensemble.
            val tour = 2 * (bw + bh + 44f * dp)
            for (k in 0 until 34) {
                val p = pointDuTour(k * tour / 34f, bw + 22f * dp, bh + 22f * dp)
                val allume = if (fini) (if (floor(t * 6).toInt() % 2 == 0) 1f else 0.25f) else if ((k + floor(t * 18).toInt()) % 4 == 0) 1f else 0.2f
                val c = Offset(bx - 11f * dp + p.x, by - 11f * dp + p.y)
                drawCircle(if (fini) Vert else Or, 7f * dp, c, alpha = 0.35f * allume)
                drawCircle(if (fini) Color(0xFFD8FFC8) else Color(0xFFFFE9A8), 3.5f * dp, c, alpha = allume)
            }
            for (i in 0 until n) {
                val x0 = -tw / 2f + i * (cw + gap)
                val y0 = -ch / 2f
                val s = m.arret(i)
                val arrete = t >= s
                drawRoundRect(Color(0xFF0B0620), Offset(x0, y0), Size(cw, ch), CornerRadius(11f * dp))
                clipRect(x0, y0, x0 + cw, y0 + ch) {
                    if (!arrete) {
                        // Le rouleau qui file : des chiffres flous qui défilent.
                        val v = 26f + 10f * i
                        val decal = (t * v * ch) % ch
                        for (k in -1..2) {
                            val chiffre = ((floor(t * v).toInt() + k + i * 3) % 10 + 10) % 10
                            for (trait in 0 until 3) texte(x.flous[chiffre], Offset(x0 + cw / 2f, y0 + ch / 2f + k * ch - decal + trait * 9f * dp))
                        }
                        drawRect(Brush.verticalGradient(listOf(Color(0xFF0B0620), Color.Transparent, Color.Transparent, Color(0xFF0B0620)), y0, y0 + ch), Offset(x0, y0), Size(cw, ch))
                    } else {
                        // Le chiffre se pose avec un petit rebond.
                        val u = t - s
                        val rebond = exp(-u * 9f) * cos(u * 30f) * 20f * dp
                        texte(if (fini) x.chiffresVerts[i] else x.chiffres[i], Offset(x0 + cw / 2f, y0 + ch / 2f + 4f * dp - rebond))
                    }
                }
                drawRoundRect(if (arrete) (if (fini) Vert else Or) else Color(0xFF5A4C9A), Offset(x0, y0), Size(cw, ch), CornerRadius(11f * dp), style = Stroke(2f * dp), alpha = if (arrete) 0.9f else 0.4f)
                if (arrete) {
                    val f = exp(-(t - s) * 7f)
                    if (f > 0.02f) drawRoundRect(Color.White, Offset(x0, y0), Size(cw, ch), CornerRadius(11f * dp), alpha = f * 0.7f, blendMode = BlendMode.Plus)
                }
            }
        }
        val titreA = lisse(t / 0.45f) * (1f - lisse((t - m.monte) / 0.3f))
        texte(x.titre, Offset(0f, -(ch / 2f + bord + 30f * dp) * echelle), alpha = titreA)
    }
    for (i in 0 until n) etincelles(Offset(cx + (-tw / 2f + (i + 0.5f) * (cw + gap)) * echelle, cy), t - m.arret(i), 22, Or, 0.6f, 5 + i)
    onde(Offset(cx, cy), t - m.fin, Vert, 400f * dp)
    etincelles(Offset(cx, cy), t - m.fin, 60, Vert, 1.1f, 17)

    // --- B : la règle des écarts ---
    if (t < m.regle) return
    val tb = t - m.regle
    val ech = echelleRegle(reponses.map { it.nombre } + bonne)
    val x0 = W * 0.06f
    val x1 = W * 0.94f
    val y = H * 0.62f
    fun px(v: Double) = x0 + ((v - ech.bas) / (ech.haut - ech.bas)).toFloat() * (x1 - x0)
    val xs = reponses.map { px(it.nombre.toDouble()) }
    val demis = x.noms.map { max(it.size.width / 2f, 18f * dp) + 4f * dp }
    val etages = etagesEquipes(xs, demis)
    val arr = px(bonne.toDouble())
    val ur = tb - (m.rayon - m.regle)
    // Le cadre sombre au contour néon autour de toute la zone (comme la question) : il s'ouvre depuis le centre avec la
    // règle, et son contour passe au vert quand le rayon touche le bon nombre.
    val cadre = cadreRegle(etages.maxOrNull() ?: 0, minOf(2, reponses.size))
    val ouvre = dos(tb / 0.45f)
    if (ouvre > 0f) {
        val demiL = (W * 0.465f) * ouvre
        // Jamais par-dessus la machine remontée sous la question : au pire, un étage de noms dépasse du cadre.
        val haut = max(y - cadre.haut * dp, cy + hautFinal / 2f + 10f * dp)
        val hCadre = y + cadre.bas * dp - haut
        val coin = CornerRadius(22f * dp)
        val bordVert = if (ur > 0.35f) exp(-(ur - 0.35f) * 2.2f) else 0f
        val bord = melange(Cyan, Vert, bordVert)
        drawRoundRect(Color(0xC80A0618), Offset(cx - demiL, haut), Size(2 * demiL, hCadre), coin, alpha = ouvre.coerceAtMost(1f))
        drawRoundRect(bord.copy(alpha = 0.22f + 0.4f * bordVert), Offset(cx - demiL, haut), Size(2 * demiL, hCadre), coin, style = Stroke(9f * dp))
        drawRoundRect(bord.copy(alpha = 0.75f + 0.25f * bordVert), Offset(cx - demiL, haut), Size(2 * demiL, hCadre), coin, style = Stroke(2f * dp))
    }
    val trace = lerp(x0, x1, lisse(tb / 0.5f))
    drawLine(Cyan.copy(alpha = 0.35f), Offset(x0, y), Offset(trace, y), 10f * dp)
    drawLine(Cyan, Offset(x0, y), Offset(trace, y), 4f * dp)
    drawLine(Color.White, Offset(x0, y), Offset(trace, y), 1.5f * dp)
    var v = kotlin.math.ceil(ech.bas / ech.pas) * ech.pas
    while (v <= ech.haut) {
        val gx = px(v)
        if (gx > trace) break
        drawLine(Graduation.copy(alpha = 0.7f), Offset(gx, y - 7f * dp), Offset(gx, y + 7f * dp), 1.5f * dp)
        texte(x.graduation(v.toLong()), Offset(gx, y + 19f * dp), alpha = 0.8f)
        v += ech.pas
    }
    // Le rayon vert descend de la machine jusqu'au bon nombre sur la règle.
    if (ur > 0f) {
        // Du bas de la machine (au centre) jusqu'au nombre sur la règle, en biais si le nombre n'est pas au milieu.
        val depart = Offset(cx, cy + hautFinal / 2f)
        val u = lisse(ur / 0.35f)
        val tete = Offset(lerp(depart.x, arr, u), lerp(depart.y, y, u))
        val lar = (5f + 13f * exp(-max(0f, ur - 0.35f) * 4f)) * dp
        val faisceau = Path().apply {
            moveTo(depart.x - lar * 1.6f, depart.y)
            lineTo(depart.x + lar * 1.6f, depart.y)
            lineTo(tete.x + lar * 0.6f, tete.y)
            lineTo(tete.x - lar * 0.6f, tete.y)
            close()
        }
        drawPath(faisceau, Brush.linearGradient(listOf(Vert.copy(alpha = 0.25f), Color(0xE6D2FFC8)), depart, tete), blendMode = BlendMode.Plus)
        drawLine(Color.White.copy(alpha = 0.85f), depart, tete, 1.5f * dp, blendMode = BlendMode.Plus)
        if (ur > 0.35f) {
            onde(Offset(arr, y), ur - 0.35f, Vert, 210f * dp)
            etincelles(Offset(arr, y), ur - 0.35f, 50, Vert, 0.9f, 21)
            val p = dos((ur - 0.35f) / 0.35f)
            val lp = max(x.pastille.size.width + 22f * dp, 70f * dp) * p
            drawRoundRect(Vert.copy(alpha = 0.35f), Offset(arr - lp / 2f - 4f * dp, y + 27f * dp), Size(lp + 8f * dp, 39f * dp), CornerRadius(20f * dp))
            drawRoundRect(Vert, Offset(arr - lp / 2f, y + 31f * dp), Size(lp, 31f * dp), CornerRadius(16f * dp))
            if (p > 0.5f) texte(x.pastille, Offset(arr, y + 46.5f * dp))
        }
    }
    // Les équipes tombent sur la règle, chacune à son nombre ; trop proches, elles montent d'un étage.
    reponses.forEachIndexed { i, r ->
        val t0 = m.equipe(i)
        val u = dos((t - t0) / 0.4f)
        if (u <= 0f) return@forEachIndexed
        val a = ((t - t0) / 0.15f).coerceIn(0f, 1f)
        val gagne = i == 0 && r.points > 0 && t > m.bonus - 0.2f
        val py = y - 30f * dp - etages[i] * 50f * dp - (1f - u) * 100f * dp
        drawLine(r.couleur.copy(alpha = 0.5f * a), Offset(xs[i], py + 12f * dp), Offset(xs[i], y), 5f * dp)
        drawLine(r.couleur.copy(alpha = a), Offset(xs[i], py + 12f * dp), Offset(xs[i], y), 2f * dp)
        val rayon = if (gagne) (19f + 2.5f * sin(t * 9f)) * dp else 17f * dp
        drawCircle(r.couleur.copy(alpha = (if (gagne) 0.55f else 0.3f) * a), rayon + 6f * dp, Offset(xs[i], py))
        drawCircle(r.couleur.copy(alpha = a), rayon, Offset(xs[i], py))
        texte(x.nombres[i], Offset(xs[i], py + 1f * dp), alpha = a)
        texte(x.noms[i], Offset(xs[i], py - 31f * dp), alpha = a)
    }
    // Les écarts des deux plus proches, puis les points de la plus proche.
    reponses.take(2).forEachIndexed { i, r ->
        val a = lisse((t - m.ecart(i)) / 0.4f)
        if (a <= 0f) return@forEachIndexed
        val xe = lerp(arr, xs[i], a)
        val yy = y + 80f * dp + i * 30f * dp
        val accolade = Path().apply { moveTo(arr, yy - 9f * dp); lineTo(arr, yy); lineTo(xe, yy); lineTo(xe, yy - 9f * dp) }
        drawPath(accolade, r.couleur.copy(alpha = 0.35f * a), style = Stroke(6f * dp))
        drawPath(accolade, r.couleur.copy(alpha = a), style = Stroke(2f * dp))
        val l = x.ecarts[i]
        val droite = xs[i] >= arr
        val cxTexte = if (droite) xe + 9f * dp + l.size.width / 2f else xe - 9f * dp - l.size.width / 2f
        texte(l, Offset(cxTexte.coerceIn(W * 0.045f + l.size.width / 2f, W * 0.955f - l.size.width / 2f), yy - 2f * dp), alpha = a)
    }
    val b = x.bonus
    if (b != null && reponses.isNotEmpty()) {
        val p = dos((t - m.bonus) / 0.4f)
        if (p > 0f) {
            val xg = xs[0]
            val py = y - 30f * dp - etages[0] * 50f * dp
            // Du côté opposé au bon nombre (le rayon vert arrive de l'autre côté), sauf s'il n'y a pas la place.
            val aGauche = xg - 40f * dp - b.size.width >= W * 0.035f
            val aDroite = xg + 40f * dp + b.size.width <= W * 0.965f
            val gauche = if (xg <= arr) aGauche || !aDroite else !aDroite && aGauche
            val cxb = if (gauche) xg - 30f * dp - b.size.width / 2f else xg + 30f * dp + b.size.width / 2f
            texte(b, Offset(cxb, py), echelle = p)
            etincelles(Offset(xg, py), t - m.bonus, 34, Or, 0.5f, 9)
        }
    }
}

/** Une onde qui part d'un point et s'efface, [u] secondes après son départ (0,7 s). */
private fun DrawScope.onde(c: Offset, u: Float, couleur: Color, rayonMax: Float) {
    val p = u / 0.7f
    if (p <= 0f || p >= 1f) return
    drawCircle(couleur.copy(alpha = (1f - p) * 0.8f), rayonMax * lisse(p), c, style = Stroke((6f - 5f * p) * density))
}

/** Une gerbe d'étincelles qui retombent, [u] secondes après son départ (graine fixe : la même à chaque image). */
private fun DrawScope.etincelles(c: Offset, u: Float, nombre: Int, couleur: Color, force: Float, graine: Int) {
    if (u < 0f || u > 1.3f) return
    val r = java.util.Random(graine * 7919L)
    repeat(nombre) { i ->
        val a = r.nextFloat() * 2f * PI.toFloat()
        val v = (125f + r.nextFloat() * 300f) * force * density
        val vie = 0.5f + r.nextFloat() * 0.8f
        if (u > vie) return@repeat
        val al = 1f - u / vie
        drawCircle(if (i % 3 == 0) Color.White else couleur, (1.2f + 1.5f * al) * density, Offset(c.x + cos(a) * v * u, c.y + sin(a) * v * u + 250f * density * u * u), alpha = al)
    }
}
