package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.sin

/*
 * Révélation des jeux au buzzer du Game Show (Qui a disparu ?, Image floue, Chante le mot, Qui suis-je ?), demandée par
 * cedric le 25/10 au soir : « pas très sexy… plus festif, plus animé, plus néon ». « C'était : » en lettres de néon
 * cyan, le mot qui surgit en néon doré et respire au tempo, entouré d'étincelles, un trait de néon qui se dessine
 * dessous, puis la phrase (« Bravo … ! » dans la couleur de l'équipe, « Personne n'a trouvé… » en rose).
 * Toutes les tailles s'ajustent : un mot n'est jamais coupé en deux, la phrase tient toujours en entier.
 */

private const val MOT_MAX = 96f
private const val MOT_MIN = 26f
private const val PHRASE_MAX = 34f
private const val PHRASE_MIN = 16f
/** Félicitations seules (Chante le mot : le mot est déjà à gauche), en grand au centre du panneau. */
internal const val PHRASE_SEULE_MAX = 64f

/** Chante le mot : le mot reste à gauche ; à droite, seulement « Bravo …, quelle voix ! » (cedric, 28/10 : répétition). */
internal fun revelationAvecMot(chante: Boolean) = !chante

/** Étincelles autour du mot : position (fraction de la zone) et décalage de phase, de gauche à droite. */
private val ETINCELLES = listOf(
    Triple(0.04f, 0.22f, 0.0f), Triple(0.12f, 0.86f, 0.55f), Triple(0.24f, 0.04f, 0.25f), Triple(0.40f, 0.95f, 0.8f),
    Triple(0.60f, 0.02f, 0.4f), Triple(0.76f, 0.92f, 0.1f), Triple(0.88f, 0.10f, 0.65f), Triple(0.97f, 0.70f, 0.35f),
)
private val TEINTES_LETTRES = listOf(GS.Cyan, GS.Rose, GS.Jaune, GS.Vert, GS.Orange)
private val TUBE_MARGE_H = 30.dp
private val TUBE_MARGE_V = 12.dp
private val TEINTES_ETINCELLES = listOf(GS.Jaune, GS.Cyan, GS.Rose, GS.Jaune, GS.Vert, GS.Rose, GS.Cyan, GS.Jaune)

/**
 * [etiquette] : « C'était : » ou « Le mot : » ; [mot] : la réponse ; [phrase] : félicitations ou consolation, écrite en
 * [teinte] ; [cle] relance l'animation (une nouvelle question). [avecMot] faux : la phrase seule, en grand.
 */
@Composable
internal fun RevelationNeon(
    etiquette: String, mot: String, phrase: String, teinte: Color, cle: Any?, modifier: Modifier = Modifier, avecMot: Boolean = true,
) {
    val boucle = rememberInfiniteTransition(label = "revelation")
    // Une mesure à 120 BPM (2 s) : le halo du mot respire, les étincelles scintillent.
    val t by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(2_000, easing = LinearEasing), RepeatMode.Restart), label = "t")
    val surgit = remember(cle) { Animatable(0f) }
    val allume = remember(cle) { Animatable(0f) }
    val trait = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle) {
        // Le mot jaillit (un peu trop grand, puis se pose) en s'allumant comme un néon qui grésille.
        launch { surgit.animateTo(1f, keyframes { durationMillis = 560; 0.55f at 0; 1.1f at 240; 0.97f at 400 }) }
        launch { allume.animateTo(1f, keyframes { durationMillis = 520; 0.9f at 80; 0.25f at 150; 1f at 250; 0.6f at 330 }) }
        trait.animateTo(1f, tween(650, delayMillis = 280))
    }
    val mesure = rememberTextMeasurer()
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val largeur = constraints.maxWidth
        val hauteur = constraints.maxHeight
        // Place pour le mot : la marge absorbe le rebond (×1,1) sans jamais sortir du panneau.
        val margeH = with(LocalDensity.current) { TUBE_MARGE_H.toPx() * 2 }
        val margeV = with(LocalDensity.current) { TUBE_MARGE_V.toPx() * 2 }
        val densite = LocalDensity.current
        val lignesPhrase = if (avecMot) 2 else 3
        // Le mot et la phrase se partagent la hauteur : le mot cède de la place tant que la phrase ne tient pas en
        // entier (test du 30/10, 8 équipes : « PERSONNE N'A TROUVÉ, CE N'EST » coupé en bas du panneau).
        // Panneau trop bas (Qui suis-je ? à 4 équipes, pastilles sur deux rangs, CI du 31/10) : si la phrase ne tient pas
        // en entier, « C'était : » et le trait de néon laissent leur place, le mot et la phrase restent tous les deux.
        val (tailleMot, taillePhrase, compacte) = remember(mot, phrase, largeur, hauteur, avecMot, densite.density) {
            if (!avecMot) {
                Triple(0f, mesure.tailleQuiTient(phrase, styleNeon(PoliceGsTitre), PHRASE_SEULE_MAX, PHRASE_MIN, (largeur * 0.88f).toInt(), (hauteur * 0.7f).toInt(), 3), false)
            } else {
                fun essai(fixe: Float) = partageMotPhraseTient(hauteur, fixe) { partMot ->
                    val tm = mesure.tailleQuiTient(
                        mot, styleNeon(PoliceGsTitre), MOT_MAX, MOT_MIN, (largeur * 0.84f - margeH).toInt(), (hauteur * partMot - margeV).toInt(), 2,
                    )
                    // Le rebond du mot (× 1,1) garde sa place.
                    val hMot = mesure.measure(mot, styleMot(tm, Color.White), constraints = Constraints(maxWidth = (largeur * 0.84f - margeH).toInt().coerceAtLeast(1))).size.height * 1.1f + margeV
                    val reste = (hauteur - fixe - hMot).toInt()
                    val tp = mesure.tailleQuiTient(phrase, styleNeon(PoliceGsTitre), PHRASE_MAX, PHRASE_MIN, (largeur * 0.92f).toInt(), reste, 2)
                    Triple(tm, tp, mesure.tient(phrase, styleNeon(PoliceGsTitre), tp, (largeur * 0.92f).toInt(), reste, 2))
                }
                val complet = essai(with(densite) { (22.sp.toPx() * 1.4f) + (10 + 12 + 10 + 16).dp.toPx() })
                if (complet.third) Triple(complet.first, complet.second, false)
                else essai(with(densite) { ESPACE_COMPACT.toPx() }).let { Triple(it.first, it.second, true) }
            }
        }
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            if (avecMot) {
                if (!compacte) Text(
                    etiquette, maxLines = 1, softWrap = false, modifier = Modifier.apparition(0, cle),
                    style = TextStyle(
                        fontFamily = PoliceGsChiffres, fontSize = 22.sp, letterSpacing = 6.sp, color = GS.CyanClair,
                        shadow = Shadow(GS.Cyan, Offset.Zero, 16f),
                    ),
                )
                if (!compacte) Spacer(Modifier.height(10.dp))
                Box(contentAlignment = Alignment.Center) {
                    Etincelles({ t }, { allume.value }, Modifier.matchParentSize())
                    // Le mot dans son tube de néon, comme « Quel est ce titre ? » (cedric, 25/10 : « très joli »).
                    Box(
                        Modifier.graphicsLayer { scaleX = surgit.value; scaleY = surgit.value; alpha = allume.value }
                            .drawBehind {
                                val respire = 0.5f + 0.5f * sin(t * 2f * PI.toFloat() * 2f)
                                val e = 3.dp.toPx()
                                val r = CornerRadius(size.height / 2f)
                                drawRoundRect(GS.Cyan.copy(alpha = 0.10f + 0.06f * respire), cornerRadius = r, style = Stroke(e * 9f))
                                drawRoundRect(GS.Cyan.copy(alpha = 0.30f + 0.08f * respire), cornerRadius = r, style = Stroke(e * 4f))
                                drawRoundRect(GS.CyanClair, cornerRadius = r, style = Stroke(e * 1.6f))
                                drawRoundRect(Color.White.copy(alpha = 0.75f), cornerRadius = r, style = Stroke(e * 0.5f))
                            }
                            .padding(horizontal = TUBE_MARGE_H, vertical = TUBE_MARGE_V),
                        contentAlignment = Alignment.Center,
                    ) {
                        // Une couleur de néon par lettre, lettres au cœur blanc ; le halo respire sur son propre calque.
                        Text(
                            arcEnCiel(mot, tailleMot * 0.9f), maxLines = 2, style = styleMot(tailleMot, Color.White.copy(alpha = 0.7f)),
                            modifier = Modifier.clearAndSetSemantics {}.graphicsLayer { alpha = 0.6f + 0.4f * sin(t * PI.toFloat()) * sin(t * PI.toFloat()) },
                        )
                        Text(arcEnCiel(mot, tailleMot * 0.3f), maxLines = 2, style = styleMot(tailleMot, Color.White), modifier = Modifier.clearAndSetSemantics {})
                        Text(mot, maxLines = 2, style = styleMot(tailleMot, Color.White).copy(shadow = Shadow(Color.White.copy(alpha = 0.9f), Offset.Zero, tailleMot * 0.06f)))
                    }
                }
                if (compacte) Spacer(Modifier.height(ESPACE_COMPACT))
                else Spacer(Modifier.height(12.dp))
                // Le trait de néon se dessine de gauche à droite sous le mot.
                if (!compacte) Canvas(Modifier.width(with(LocalDensity.current) { (largeur * 0.6f).toDp() }).height(10.dp).clearAndSetSemantics {}) {
                    val y = size.height / 2f
                    val fin = size.width * trait.value
                    if (fin <= 0f) return@Canvas
                    val degrade = Brush.horizontalGradient(listOf(GS.Cyan, GS.Rose, GS.Jaune), endX = size.width)
                    drawLine(degrade, Offset(0f, y), Offset(fin, y), strokeWidth = size.height, cap = StrokeCap.Round, alpha = 0.25f)
                    drawLine(degrade, Offset(0f, y), Offset(fin, y), strokeWidth = size.height * 0.45f, cap = StrokeCap.Round)
                    drawLine(Color.White.copy(alpha = 0.8f), Offset(0f, y), Offset(fin, y), strokeWidth = size.height * 0.12f, cap = StrokeCap.Round)
                }
                if (!compacte) Spacer(Modifier.height(16.dp))
            }
            // Filigrane A derrière la phrase : elle est posée sur le décor (cedric, 30/10).
            Box(Modifier.fillMaxWidth().apparition(if (avecMot) 450 else 0, cle).filigraneGs(10f), contentAlignment = Alignment.Center) {
                if (!avecMot) Etincelles({ t }, { 1f }, Modifier.matchParentSize())
                TexteNeon(phrase, taillePhrase, teinte.copy(alpha = 0.85f), taillePhrase * 0.45f, teinte, lignesPhrase, Modifier.clearAndSetSemantics {})
                TexteNeon(phrase, taillePhrase, Color.White, taillePhrase * 0.1f, teinte, lignesPhrase)
            }
        }
    }
}

private fun styleNeon(police: FontFamily) = TextStyle(fontFamily = police, textAlign = TextAlign.Center)

private fun styleMot(taille: Float, couleur: Color) =
    styleNeon(PoliceGsTitre).copy(color = couleur, fontSize = taille.sp, lineHeight = (taille * 1.08f).sp)

/** Les lettres du mot, chacune dans une couleur de néon (cyan, rose, jaune, vert, orange…), lueur de rayon [flou]. */
private fun arcEnCiel(mot: String, flou: Float): AnnotatedString = buildAnnotatedString {
    var k = 0
    mot.forEach { c ->
        if (c.isWhitespace()) { append(c); return@forEach }
        val teinte = TEINTES_LETTRES[k++ % TEINTES_LETTRES.size]
        withStyle(SpanStyle(color = teinte, shadow = Shadow(teinte, Offset.Zero, flou))) { append(c) }
    }
}

/** Une couche de texte néon : [couleur] des lettres, lueur [lueur] de rayon [flou]. */
@Composable
private fun TexteNeon(texte: String, taille: Float, couleur: Color, flou: Float, lueur: Color, lignes: Int, modifier: Modifier = Modifier) {
    Text(
        texte, maxLines = lignes, modifier = modifier,
        style = styleNeon(PoliceGsTitre).copy(
            color = couleur, fontSize = taille.sp, lineHeight = (taille * 1.08f).sp, shadow = Shadow(lueur, Offset.Zero, flou),
        ),
    )
}

/**
 * Part de la hauteur laissée au mot : de 38 % à 16 %, la plus grande où la phrase tient encore en entier dessous.
 * [essai] rend (taille du mot, taille de la phrase, la phrase tient) pour une part donnée.
 */
internal fun partageMotPhrase(hauteur: Int, fixe: Float, essai: (Float) -> Triple<Float, Float, Boolean>): Pair<Float, Float> {
    var part = PART_MOT_MAX
    while (true) {
        val (tm, tp, tient) = essai(part)
        if (tient || part <= PART_MOT_MIN + 1e-3f || hauteur <= fixe) return tm to tp
        part -= 0.02f
    }
}

/** Comme [partageMotPhrase], et dit en plus si la phrase tient en entier avec ce partage. */
internal fun partageMotPhraseTient(hauteur: Int, fixe: Float, essai: (Float) -> Triple<Float, Float, Boolean>): Triple<Float, Float, Boolean> {
    var part = PART_MOT_MAX
    while (true) {
        val r = essai(part)
        if (r.third || part <= PART_MOT_MIN + 1e-3f || hauteur <= fixe) return r
        part -= 0.02f
    }
}

/** Écart entre le mot et la phrase quand « C'était : » et le trait laissent leur place (panneau trop bas). */
internal val ESPACE_COMPACT = 6.dp

internal const val PART_MOT_MAX = 0.38f
internal const val PART_MOT_MIN = 0.16f

/** Le texte tient-il en entier à [taille] dans [largeur] × [hauteur] pixels, en [lignes] lignes au plus, sans mot coupé ? */
private fun TextMeasurer.tient(texte: String, style: TextStyle, taille: Float, largeur: Int, hauteur: Int, lignes: Int): Boolean {
    if (largeur <= 0 || hauteur <= 0) return false
    val st = style.copy(fontSize = taille.sp, lineHeight = (taille * 1.08f).sp)
    if (texte.split(' ').filter { it.isNotBlank() }.any { measure(it, st, softWrap = false, maxLines = 1).size.width > largeur }) return false
    val r = measure(texte, st, constraints = Constraints(maxWidth = largeur))
    return r.lineCount <= lignes && r.size.height <= hauteur
}

/**
 * Plus grande taille (pas de 2 sp) où chaque mot tient sur une ligne, sans jamais être coupé, et où le texte entier
 * tient en [lignes] lignes dans [largeur] × [hauteur] pixels.
 */
private fun TextMeasurer.tailleQuiTient(
    texte: String, style: TextStyle, max: Float, min: Float, largeur: Int, hauteur: Int, lignes: Int,
): Float {
    if (largeur <= 0 || hauteur <= 0) return min
    val mots = texte.split(' ').filter { it.isNotBlank() }
    var taille = max
    while (taille > min) {
        val st = style.copy(fontSize = taille.sp, lineHeight = (taille * 1.08f).sp)
        if (mots.all { measure(it, st, softWrap = false, maxLines = 1).size.width <= largeur }) {
            val r = measure(texte, st, constraints = Constraints(maxWidth = largeur))
            if (r.lineCount <= lignes && r.size.height <= hauteur) return taille
        }
        taille -= 2f
    }
    return min
}

/** Petites étoiles néon à quatre branches qui scintillent autour du mot, chacune à son rythme. */
@Composable
private fun Etincelles(t: () -> Float, allume: () -> Float, modifier: Modifier) {
    Canvas(modifier.clearAndSetSemantics {}) {
        val base = size.minDimension.coerceAtMost(220f) * 0.09f
        ETINCELLES.forEachIndexed { k, (fx, fy, phase) ->
            val v = sin(((t() + phase) % 1f) * PI.toFloat())
            val r = base * (0.45f + 0.55f * v)
            val c = Offset(size.width * fx, size.height * fy)
            val etoile = Path().apply {
                moveTo(c.x, c.y - r); quadraticBezierTo(c.x, c.y, c.x + r, c.y); quadraticBezierTo(c.x, c.y, c.x, c.y + r)
                quadraticBezierTo(c.x, c.y, c.x - r, c.y); quadraticBezierTo(c.x, c.y, c.x, c.y - r); close()
            }
            val teinte = TEINTES_ETINCELLES[k]
            drawCircle(teinte.copy(alpha = 0.25f * v * allume()), r * 1.4f, c)
            drawPath(etoile, Color.White.copy(alpha = (0.35f + 0.65f * v) * allume()))
        }
    }
}
