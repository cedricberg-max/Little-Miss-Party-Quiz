package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * Habillage du Pictionary : le dessin en direct sur un tableau encadré, l'équipe qui dessine et son chrono,
 * l'annonce du tour et la révélation du mot. Rien ici ne touche à la partie : ces écrans reçoivent ce qu'il
 * faut montrer, et le tracé arrive tel que la tablette l'a envoyé (même contrat que web/public/ardoise.js).
 */

/** Les 8 feutres de l'ardoise (même ordre que COULEURS_DESSIN du web). */
val COULEURS_DESSIN = listOf(
    Color(0xFF1B1035), Color(0xFFFF2D8A), Color(0xFF2B86C5), Color(0xFF12C957),
    Color(0xFFFFB000), Color(0xFFFF5A1F), Color(0xFF6E28BE), Color(0xFF8B5A2B),
)

/** La gomme de l'ardoise : un trait couleur papier qui recouvre le dessin (couleur « paper » côté tablette). */
const val GOMME_DESSIN = -1
private val PAPIER_DESSIN = Color(0xFFFFFBF0)

/** Épaisseurs du trait, en fraction de la largeur de la feuille (mêmes valeurs que le web). */
val EPAISSEURS_DESSIN = listOf(0.006f, 0.012f, 0.028f)

/** Format de la feuille, identique sur la tablette et à la TV : le dessin ne se déforme jamais. */
const val RATIO_DESSIN = 4f / 3f

/** Un trait de l'ardoise : [points] = x0, y0, x1, y1… entre 0 et 1 sur la feuille. */
class TraitDessin(val id: String, val couleur: Int, val epaisseur: Int, val points: FloatArray)

/**
 * Lit un trait tel que l'ardoise l'écrit ({ c, w, p: [x, y, …] }). Rend null si le trait est illisible ; les valeurs
 * hors bornes sont ramenées dans la feuille, jamais refusées, pour qu'un dessin ne disparaisse pas à l'écran.
 */
fun traitDepuis(id: String, valeur: Any?): TraitDessin? {
    val m = valeur as? Map<*, *> ?: return null
    val p = (m["p"] as? List<*>)?.mapNotNull { (it as? Number)?.toFloat()?.coerceIn(0f, 1f) } ?: return null
    if (p.size < 2) return null
    val n = p.size - p.size % 2
    return TraitDessin(
        id,
        (m["c"] as? Number)?.toInt()?.takeIf { it in COULEURS_DESSIN.indices } ?: 0,
        (m["w"] as? Number)?.toInt()?.takeIf { it in EPAISSEURS_DESSIN.indices } ?: 1,
        FloatArray(n) { p[it] },
    )
}

/** Chemin lissé d'un trait sur une feuille de [l] × [h] pixels (mêmes courbes que l'ardoise). */
internal fun cheminDe(t: TraitDessin, l: Float, h: Float): Path {
    val p = t.points
    val chemin = Path()
    chemin.moveTo(p[0] * l, p[1] * h)
    if (p.size < 4) {
        chemin.lineTo(p[0] * l + 0.01f, p[1] * h)
        return chemin
    }
    var i = 2
    while (i < p.size - 2) {
        chemin.quadraticBezierTo(p[i] * l, p[i + 1] * h, (p[i] + p[i + 2]) / 2 * l, (p[i + 1] + p[i + 3]) / 2 * h)
        i += 2
    }
    chemin.lineTo(p[p.size - 2] * l, p[p.size - 1] * h)
    return chemin
}

/**
 * Le tableau du dessin : cadre doré, papier crème, et le dessin de la tablette en direct. Les chemins ne sont
 * recalculés que quand les traits ou la taille changent ; entre deux traits, rien ne se redessine.
 */
@Composable
fun TableauDessin(traits: List<TraitDessin>, modifier: Modifier = Modifier, vide: String? = null) {
    Box(
        modifier
            .aspectRatio(RATIO_DESSIN + 0.06f)
            .background(
                Brush.linearGradient(listOf(Neon.OrClair, Neon.Or, Color(0xFFC9974F), Neon.Or, Neon.OrClair)),
                RoundedCornerShape(22.dp),
            )
            .border(3.dp, Neon.Halo.copy(alpha = 0.7f), RoundedCornerShape(22.dp))
            .padding(12.dp),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Brush.verticalGradient(listOf(Color(0xFFFFFDF6), Color(0xFFFFF8EA))), RoundedCornerShape(12.dp))
                .drawWithCache {
                    // La feuille garde exactement le format de l'ardoise, centrée dans le cadre.
                    val l = minOf(size.width, size.height * RATIO_DESSIN)
                    val h = l / RATIO_DESSIN
                    val o = Offset((size.width - l) / 2, (size.height - h) / 2)
                    val chemins = traits.map { t ->
                        Triple(cheminDe(t, l, h), COULEURS_DESSIN.getOrNull(t.couleur) ?: PAPIER_DESSIN, EPAISSEURS_DESSIN[t.epaisseur] * l)
                    }
                    val pointilles = Color(0xFF6E28BE).copy(alpha = 0.07f)
                    val pas = l / 40f
                    onDrawBehind {
                        var y = o.y + pas / 2
                        while (y < o.y + h) {
                            var x = o.x + pas / 2
                            while (x < o.x + l) {
                                drawCircle(pointilles, 1.2f, Offset(x, y))
                                x += pas
                            }
                            y += pas
                        }
                        translate(o.x, o.y) {
                            chemins.forEach { (chemin, couleur, largeur) ->
                                drawPath(chemin, couleur, style = Stroke(largeur, cap = StrokeCap.Round, join = StrokeJoin.Round))
                            }
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            if (traits.isEmpty() && vide != null) CrayonQuiAttend(vide)
        }
    }
}

/** Feuille encore blanche : un crayon qui gigote et un petit texte, pour dire que le dessin va arriver. */
@Composable
private fun CrayonQuiAttend(texte: String) {
    val t by rememberInfiniteTransition(label = "crayon").animateFloat(
        -1f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "gigote",
    )
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text("✏️", fontSize = 56.sp, modifier = Modifier.graphicsLayer { rotationZ = 12f * t; translationX = 10f * t })
        Spacer(Modifier.height(8.dp))
        Text(texte, color = Neon.Violet.copy(alpha = 0.75f), fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
    }
}

/**
 * La scène du Pictionary pendant qu'une équipe dessine : en haut l'équipe et son chrono, au centre le tableau.
 * [secondes] et [fraction] (temps restant / temps total) viennent du chrono de la partie.
 */
@Composable
fun ScenePictionary(
    equipe: String,
    couleur: Color,
    secondes: Int,
    fraction: Float,
    traits: List<TraitDessin>,
    modifier: Modifier = Modifier,
) {
    Echelle(960.dp, 540.dp, modifier) {
        Column(Modifier.fillMaxSize().padding(horizontal = 28.dp, vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                MotPictionary(30.sp)
                Spacer(Modifier.width(18.dp))
                Box(Modifier.weight(1f)) { PastilleEquipe(equipe, couleur, "dessine !") }
                Spacer(Modifier.width(18.dp))
                ChronoPictionary(secondes, fraction)
            }
            Spacer(Modifier.height(10.dp))
            TableauDessin(traits, Modifier.weight(1f), vide = "Le dessin arrive…")
        }
    }
    GrattementCrayon(traits)
}

/** Boucle du grattement de crayon (res/raw). */
const val FICHIER_CRAYON = "lmp_pictio_crayon"

/** Le crayon se tait quand plus aucun point n'arrive pendant ce délai : le dessinateur a levé le doigt. */
const val CRAYON_SILENCE_MS = 450L

/** Points reçus en tout : ce nombre grandit tant que le trait avance et retombe quand la feuille est effacée. */
fun pointsDessines(traits: List<TraitDessin>): Int = traits.sumOf { it.points.size / 2 }

/** Le trait avance ? Pas à l'arrivée d'un dessin déjà commencé (TV relancée en plein tour), ni quand on efface. */
fun crayonAvance(avant: Int, apres: Int): Boolean = avant >= 0 && apres > avant

/**
 * Grattement de crayon à papier sur la TV, calé sur le dessin en direct : il démarre quand de nouveaux points
 * arrivent et s'arrête [CRAYON_SILENCE_MS] après le dernier. La tablette, elle, reste muette.
 */
@Composable
fun GrattementCrayon(traits: List<TraitDessin>, jouer: (Boolean) -> Unit = Sons::crayon) {
    val total = pointsDessines(traits)
    val avant = remember { intArrayOf(-1) }
    LaunchedEffect(total) {
        val avance = crayonAvance(avant[0], total)
        avant[0] = total
        if (!avance) {
            jouer(false)
            return@LaunchedEffect
        }
        jouer(true)
        delay(CRAYON_SILENCE_MS)
        jouer(false)
    }
    DisposableEffect(Unit) { onDispose { jouer(false) } }
}

/** « PICTIONARY » en lettres dorées. */
@Composable
fun MotPictionary(taille: TextUnit, modifier: Modifier = Modifier) {
    Text(
        "PICTIONARY",
        maxLines = 1,
        modifier = modifier,
        style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP,
            brush = Brush.verticalGradient(listOf(Neon.OrClair, Neon.Or, Neon.OrProfond)),
            fontSize = taille, fontWeight = FontWeight.Black, letterSpacing = taille * 0.12f,
            shadow = Shadow(Neon.Halo.copy(alpha = 0.6f), Offset.Zero, 18f),
        ),
    )
}

@Composable
private fun PastilleEquipe(nom: String, couleur: Color, suite: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .background(couleur.copy(alpha = 0.22f), RoundedCornerShape(50))
            .border(3.dp, couleur, RoundedCornerShape(50))
            .padding(horizontal = 18.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(16.dp).background(couleur, CircleShape).border(2.dp, Neon.Blanc, CircleShape))
        Spacer(Modifier.width(10.dp))
        Text(
            nom, color = Neon.Blanc, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1,
            overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
        )
        Text(" $suite", color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 22.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** Chrono en anneau, comme aux mimes : or, puis orange et battant sur les dix dernières secondes. */
@Composable
fun ChronoPictionary(secondes: Int, fraction: Float, modifier: Modifier = Modifier) {
    val urgent = secondes in 0..10
    val battement = remember { Animatable(1f) }
    LaunchedEffect(secondes) {
        if (!urgent || secondes == 0) return@LaunchedEffect
        battement.snapTo(1.18f)
        battement.animateTo(1f, tween(400))
    }
    Box(
        modifier.size(78.dp).graphicsLayer { scaleX = battement.value; scaleY = battement.value }.drawBehind {
            val trait = 8.dp.toPx()
            val boite = Size(size.width - trait, size.height - trait)
            val coin = Offset(trait / 2, trait / 2)
            drawArc(Color.White.copy(alpha = 0.2f), 0f, 360f, false, style = Stroke(trait), topLeft = coin, size = boite)
            drawArc(if (urgent) Neon.Chaud else Neon.Or, -90f, 360f * fraction.coerceIn(0f, 1f), false, style = Stroke(trait, cap = StrokeCap.Round), topLeft = coin, size = boite)
        },
        contentAlignment = Alignment.Center,
    ) {
        Text("${secondes.coerceAtLeast(0)}", color = if (urgent) Neon.Chaud else Neon.Blanc, fontSize = 32.sp, fontWeight = FontWeight.Black)
    }
}

/**
 * Avant que l'équipe dessine : le titre du jeu, l'équipe dont c'est le tour, et la consigne du moment.
 * [motMontre] = faux : on demande à l'équipe de se retourner ; vrai : le dessinateur découvre son mot en secret.
 */
@Composable
fun IntroPictionary(equipe: String, couleur: Color, motMontre: Boolean, modifier: Modifier = Modifier) {
    val crayon by rememberInfiniteTransition(label = "intro").animateFloat(
        0f, 1f, infiniteRepeatable(tween(2400), RepeatMode.Restart), label = "trace",
    )
    Echelle(960.dp, 540.dp, modifier) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            MotPictionary(78.sp, Modifier.apparition(0, "titre"))
            // Un trait de feutre qui se dessine sous le titre, en boucle.
            Box(
                Modifier.width(520.dp).height(16.dp).drawBehind {
                    val avance = (crayon * 1.3f).coerceAtMost(1f)
                    val c = Path().apply {
                        moveTo(0f, size.height * 0.6f)
                        var x = 0f
                        while (x <= size.width * avance) {
                            lineTo(x, size.height * (0.5f + 0.3f * kotlin.math.sin(x / size.width * 18f)))
                            x += 6f
                        }
                    }
                    drawPath(c, Neon.Halo, style = Stroke(7f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                },
            )
            Spacer(Modifier.height(30.dp))
            Text(
                "Au tour de",
                color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 28.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.apparition(300, equipe),
            )
            Text(
                equipe,
                color = couleur, fontSize = 60.sp, fontWeight = FontWeight.Black, maxLines = 1, overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, shadow = Shadow(couleur.copy(alpha = 0.7f), Offset.Zero, 26f)),
                modifier = Modifier.widthIn(max = 880.dp).apparition(450, equipe),
            )
            Spacer(Modifier.height(30.dp))
            Box(
                Modifier
                    .background(Neon.Nuit.copy(alpha = 0.45f), RoundedCornerShape(24.dp))
                    .border(2.dp, Neon.Or.copy(alpha = 0.6f), RoundedCornerShape(24.dp))
                    .padding(horizontal = 30.dp, vertical = 14.dp)
                    .apparition(700, motMontre),
            ) {
                Text(
                    if (motMontre) "🤫  Chut… le dessinateur découvre son mot secret" else "🙈  Toute l'équipe se retourne, sauf le dessinateur !",
                    color = Neon.Blanc, fontSize = 28.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/**
 * Fin du tour : « TROUVÉ ! » (avec confettis) ou « Temps écoulé » (doux, jamais vexant), puis le mot et son image
 * à côté du dessin de l'équipe. [image] est fourni par l'écran (photo du catalogue ou émoji) ; [points] s'affiche
 * seulement s'il est donné. Le texte « TROUVÉ ! » reste lisible par les tests.
 */
@Composable
fun RevelationPictionary(
    mot: String,
    trouve: Boolean,
    equipe: String,
    couleur: Color,
    traits: List<TraitDessin>,
    modifier: Modifier = Modifier,
    points: Int? = null,
    image: (@Composable () -> Unit)? = null,
) {
    Box(modifier.fillMaxSize()) {
        if (trouve) Gerbe(mot)
        Echelle(960.dp, 540.dp) {
            Column(Modifier.fillMaxSize().padding(horizontal = 28.dp, vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    if (trouve) "TROUVÉ !" else "Temps écoulé !",
                    maxLines = 1,
                    modifier = Modifier.rebond(trouve, 0.06f).apparition(0, trouve),
                    style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP,
                        color = if (trouve) Neon.JusteClair else Neon.Or,
                        fontSize = if (trouve) 64.sp else 50.sp, fontWeight = FontWeight.Black, letterSpacing = 3.sp,
                        shadow = Shadow((if (trouve) Neon.JusteClair else Neon.Or).copy(alpha = 0.7f), Offset.Zero, 26f),
                    ),
                )
                Text(
                    if (trouve) "Bravo $equipe !" else "Ce n'est pas grave, le mot était…",
                    color = if (trouve) couleur else Neon.Blanc.copy(alpha = 0.85f),
                    fontSize = 26.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 880.dp).apparition(250, trouve),
                )
                Spacer(Modifier.height(14.dp))
                Row(Modifier.weight(1f).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                    TableauDessin(traits, Modifier.weight(1f, fill = false).apparition(150, "dessin"))
                    Spacer(Modifier.width(26.dp))
                    Column(
                        Modifier
                            .width(330.dp)
                            .apparition(600, mot)
                            .background(Neon.Nuit.copy(alpha = 0.5f), RoundedCornerShape(28.dp))
                            .border(3.dp, Brush.linearGradient(listOf(Neon.OrClair, couleur, Neon.Or)), RoundedCornerShape(28.dp))
                            .padding(22.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("Le mot", color = Neon.Or, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                        if (image != null) {
                            Spacer(Modifier.height(10.dp))
                            // L'image prend la place qui reste (170 dp au plus) : le mot et les points restent toujours visibles.
                            Box(
                                Modifier.weight(1f, fill = false).sizeIn(maxWidth = 170.dp, maxHeight = 170.dp).aspectRatio(1f)
                                    .background(Color.White, RoundedCornerShape(20.dp)).padding(10.dp).clearAndSetSemantics {},
                                contentAlignment = Alignment.Center,
                            ) { image() }
                        }
                        Spacer(Modifier.height(12.dp))
                        Text(
                            mot.uppercase(),
                            color = Neon.Blanc, fontSize = if (mot.length > 12) 34.sp else 44.sp, fontWeight = FontWeight.Black,
                            textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
                            style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, shadow = Shadow(Neon.Halo.copy(alpha = 0.6f), Offset.Zero, 18f)),
                        )
                        if (points != null && points > 0) {
                            Spacer(Modifier.height(10.dp))
                            Text("+$points points", color = Neon.JusteClair, fontSize = 30.sp, fontWeight = FontWeight.Black)
                        }
                    }
                }
            }
        }
    }
}
