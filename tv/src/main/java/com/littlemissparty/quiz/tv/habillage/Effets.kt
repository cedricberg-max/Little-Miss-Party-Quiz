package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.sin
import kotlinx.coroutines.delay

/** Devient vrai [delaiMs] après l'arrivée de [cle] (ou tout de suite si le délai est nul). */
@Composable
fun apres(delaiMs: Long, cle: Any?, actif: Boolean = true): Boolean {
    val pret by produceState(initialValue = actif && delaiMs <= 0, cle, actif) {
        if (!actif) {
            value = false
            return@produceState
        }
        if (delaiMs > 0) {
            value = false
            delay(delaiMs)
        }
        value = true
    }
    return pret
}

/** Entrée d'un élément sur le rythme : il surgit (échelle et fondu) [delaiMs] après l'arrivée de [cle]. */
fun Modifier.apparition(delaiMs: Long, cle: Any?): Modifier = composed {
    val v = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle) {
        delay(delaiMs)
        v.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow))
    }
    graphicsLayer {
        val x = v.value
        alpha = x.coerceIn(0f, 1f)
        scaleX = 0.82f + 0.18f * x
        scaleY = 0.82f + 0.18f * x
    }
}

/** Petit rebond quand [actif] devient vrai : la carte de la bonne réponse, les points qui tombent. */
fun Modifier.rebond(actif: Boolean, ampleur: Float = 0.08f): Modifier = composed {
    val v = remember { Animatable(0f) }
    LaunchedEffect(actif) {
        if (!actif) {
            v.snapTo(0f)
            return@LaunchedEffect
        }
        v.snapTo(1f)
        v.animateTo(0f, spring(dampingRatio = 0.35f, stiffness = Spring.StiffnessLow))
    }
    graphicsLayer {
        val s = 1f + ampleur * v.value
        scaleX = s
        scaleY = s
    }
}

/**
 * Générique d'ouverture, une fois par partie, calé sur la musique du générique : « Little Miss » s'écrit,
 * « PARTY » tombe lettre par lettre, « QUIZ » claque, puis on salue l'enfant fêté. Il s'efface seul et
 * laisse le salon dessous : aucun bouton, aucune touche de la télécommande n'est bloquée.
 */
@Composable
fun GeneriqueSalon(partie: String, prenom: String, titre: String) {
    var montrer by remember(partie) { mutableStateOf(partie.isNotEmpty() && Habillage.generiquesVus.add(partie)) }
    if (!montrer) return
    val t = remember(partie) { Animatable(0f) }
    LaunchedEffect(partie) {
        t.animateTo(Tempo.GENERIQUE_ANIMATION.toFloat(), tween(Tempo.GENERIQUE_ANIMATION.toInt(), easing = LinearEasing))
        montrer = false
    }
    // Le temps n'est lu que dans les calques (graphicsLayer) : rien ne se recompose à chaque image, la Mi Box suit.
    val ms = { t.value }
    Box(
        Modifier
            .fillMaxSize()
            .clearAndSetSemantics {}
            .graphicsLayer {
                val sortie = ((ms() - 7_600f) / 1_400f).coerceIn(0f, 1f)
                alpha = 1f - sortie
                scaleX = 1f + 0.08f * sortie
                scaleY = 1f + 0.08f * sortie
            }
            .background(Neon.Nuit.copy(alpha = 0.93f)),
        contentAlignment = Alignment.Center,
    ) {
        Rayons(ms)
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            // « Little Miss » s'écrit de gauche à droite, néon rose.
            Text(
                "Little Miss",
                style = TextStyle(
                    color = Neon.Blanc, fontSize = 96.sp, fontStyle = FontStyle.Italic, fontWeight = FontWeight.Light,
                    shadow = Shadow(Neon.Halo, Offset.Zero, 28f),
                ),
                modifier = Modifier.graphicsLayer {
                    val ecrit = ((ms() - 300f) / 1_200f).coerceIn(0f, 1f)
                    alpha = if (ecrit > 0f) 1f else 0f
                    clip = true
                    shape = DevoileGauche(ecrit)
                },
            )
            // « PARTY » : une lettre par croche, en or.
            Row {
                "PARTY".forEachIndexed { i, c ->
                    val debut = 1_500f + i * 125f
                    Text(
                        c.toString(),
                        style = TextStyle(
                            brush = Brush.verticalGradient(listOf(Neon.OrClair, Neon.OrProfond)),
                            fontSize = 64.sp, fontWeight = FontWeight.Bold, letterSpacing = 14.sp,
                            shadow = Shadow(Neon.Or.copy(alpha = 0.6f), Offset.Zero, 18f),
                        ),
                        modifier = Modifier.graphicsLayer {
                            val x = ((ms() - debut) / 260f).coerceIn(0f, 1f)
                            alpha = x
                            translationY = (1f - x) * -60f
                            rotationX = (1f - x) * 70f
                        },
                    )
                }
            }
            // « QUIZ » claque sur le temps fort.
            Text(
                "QUIZ",
                style = TextStyle(
                    color = Color(0xFFFFF6E6), fontSize = 120.sp, fontWeight = FontWeight.Black, letterSpacing = 18.sp,
                    shadow = Shadow(Neon.Or, Offset.Zero, 40f),
                ),
                modifier = Modifier.graphicsLayer {
                    val q = ((ms() - 2_500f) / 450f).coerceIn(0f, 1f)
                    val claque = if (q <= 0f) 0f else 1f + 0.5f * (1f - q) * (1f - q)
                    alpha = if (q > 0f) 1f else 0f
                    scaleX = claque
                    scaleY = claque
                },
            )
            Spacer(Modifier.height(24.dp))
            Text(
                if (prenom.isNotBlank()) "Joyeux anniversaire" else titre.ifBlank { "Bienvenue sur le plateau !" },
                color = Neon.Blanc, fontSize = 40.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.graphicsLayer {
                    val salut = ((ms() - 4_000f) / 600f).coerceIn(0f, 1f)
                    alpha = salut
                    translationY = (1f - salut) * 40f
                },
            )
            if (prenom.isNotBlank()) {
                Text(
                    "$prenom !",
                    style = TextStyle(
                        color = Color(0xFFFFF6E6), fontSize = 92.sp, fontWeight = FontWeight.Bold,
                        shadow = Shadow(Neon.Or, Offset.Zero, 36f),
                    ),
                    modifier = Modifier.graphicsLayer {
                        val nom = ((ms() - 4_500f) / 700f).coerceIn(0f, 1f)
                        alpha = nom
                        val s = 0.6f + 0.4f * nom
                        scaleX = s
                        scaleY = s
                    },
                )
            }
        }
    }
}

/** Forme qui ne laisse voir que la partie gauche ([part] de 0 à 1) : l'écriture qui avance. */
private class DevoileGauche(private val part: Float) : androidx.compose.ui.graphics.Shape {
    override fun createOutline(
        size: Size,
        layoutDirection: androidx.compose.ui.unit.LayoutDirection,
        density: androidx.compose.ui.unit.Density,
    ) = androidx.compose.ui.graphics.Outline.Rectangle(
        androidx.compose.ui.geometry.Rect(-size.width * 0.2f, -size.height, size.width * 1.2f * part, size.height * 2),
    )
}

/** Rayons dorés qui tournent derrière le logo du générique : dessinés une fois, seul le calque tourne. */
@Composable
private fun Rayons(ms: () -> Float) {
    Box(
        Modifier.fillMaxSize()
            .graphicsLayer { rotationZ = ms() / 1000f * 8f; alpha = (ms() / 800f).coerceIn(0f, 1f) }
            .drawWithCache {
                val c = Offset(size.width / 2, size.height / 2)
                val r = size.maxDimension
                val pinceau = Brush.radialGradient(listOf(Neon.Or.copy(alpha = 0.20f), Color.Transparent), c, r * 0.55f)
                val rayons = (0 until 20).map { i ->
                    val a = Math.toRadians(i * 18.0)
                    val w = 0.07
                    Path().apply {
                        moveTo(c.x, c.y)
                        lineTo(c.x + (r * cos(a - w)).toFloat(), c.y + (r * sin(a - w)).toFloat())
                        lineTo(c.x + (r * cos(a + w)).toFloat(), c.y + (r * sin(a + w)).toFloat())
                        close()
                    }
                }
                onDrawBehind { rayons.forEach { drawPath(it, pinceau) } }
            },
    )
}

/** Reflet doré qui traverse l'écran à chaque changement de [cle] (question suivante, classement…). */
@Composable
fun BalayageDore(cle: Any?) {
    val x = remember { Animatable(2f) }
    var premier by remember { mutableStateOf(true) }
    LaunchedEffect(cle) {
        if (premier) {
            premier = false
            return@LaunchedEffect
        }
        x.snapTo(-0.3f)
        x.animateTo(1.3f, tween(750, easing = FastOutSlowInEasing))
    }
    Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        val v = x.value
        if (v < -0.3f || v > 1.29f) return@Canvas
        val w = size.width
        val h = size.height
        val cx = w * v
        val demi = w * 0.14f
        rotate(-16f, Offset(cx, h / 2)) {
            drawRect(
                Brush.horizontalGradient(
                    listOf(Color.Transparent, Neon.Or.copy(alpha = 0.22f), Neon.Blanc.copy(alpha = 0.42f), Neon.Or.copy(alpha = 0.22f), Color.Transparent),
                    startX = cx - demi, endX = cx + demi,
                ),
                topLeft = Offset(cx - demi, -h),
                size = Size(demi * 2, h * 3),
            )
        }
    }
}

/** Couronne dorée du premier du classement, qui tombe sur le temps. */
@Composable
fun Couronne(visible: Boolean, modifier: Modifier = Modifier) {
    val v = remember { Animatable(0f) }
    LaunchedEffect(visible) {
        if (visible) v.animateTo(1f, spring(dampingRatio = 0.4f, stiffness = Spring.StiffnessMediumLow)) else v.snapTo(0f)
    }
    Canvas(
        modifier.graphicsLayer {
            alpha = v.value.coerceIn(0f, 1f)
            translationY = (1f - v.value) * -24f
            rotationZ = -10f
        },
    ) {
        val w = size.width
        val h = size.height
        val p = Path().apply {
            moveTo(0f, h)
            lineTo(0f, h * 0.25f)
            lineTo(w * 0.28f, h * 0.6f)
            lineTo(w * 0.5f, 0f)
            lineTo(w * 0.72f, h * 0.6f)
            lineTo(w, h * 0.25f)
            lineTo(w, h)
            close()
        }
        drawCircle(Brush.radialGradient(listOf(Neon.Or.copy(alpha = 0.5f), Color.Transparent), Offset(w / 2, h / 2), w * 0.6f), w * 0.6f, Offset(w / 2, h / 2))
        drawPath(p, Brush.verticalGradient(listOf(Neon.OrClair, Neon.OrProfond)))
    }
}

/** Pluie de confettis de la victoire, lâchée [delaiMs] après l'arrivée sur l'écran final. */
@Composable
fun Confettis(delaiMs: Long, modifier: Modifier = Modifier) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(delaiMs)
        while (true) t.animateTo(t.value + 14f, tween(14_000, easing = LinearEasing))
    }
    val morceaux = remember {
        val couleurs = listOf(Neon.Or, Neon.OrClair, Neon.Halo, Color(0xFF7CFF3A), Color(0xFFFF2D8A), Color(0xFFFFE61F), Color(0xFFFF5A1F), Neon.Blanc)
        List(90) { i ->
            val r = java.util.Random(i * 7919L)
            Confetti(r.nextFloat(), r.nextFloat() * 1.2f, 0.12f + r.nextFloat() * 0.18f, r.nextFloat() * 6.28f, 2f + r.nextFloat() * 5f, couleurs[i % couleurs.size])
        }
    }
    Canvas(modifier.fillMaxSize().clearAndSetSemantics {}) {
        val s = t.value
        if (s <= 0f) return@Canvas
        val w = size.width
        val h = size.height
        val taille = h * 0.016f
        morceaux.forEach { m ->
            // Chaque confetti tombe en boucle, en se balançant et en tournant sur lui-même.
            val y = ((m.depart + s * m.vitesse) % 1.25f) - 0.1f
            val x = m.x + 0.03f * sin(s * 2f + m.phase)
            val largeur = taille * (0.4f + 0.6f * kotlin.math.abs(cos(s * m.tour + m.phase)))
            rotate(s * 90f * m.tour + m.phase * 57f, Offset(x * w, y * h)) {
                drawRect(m.couleur, Offset(x * w - largeur / 2, y * h - taille * 0.3f), Size(largeur, taille * 0.6f))
            }
        }
    }
}

private class Confetti(val x: Float, val depart: Float, val vitesse: Float, val phase: Float, val tour: Float, val couleur: Color)

/**
 * Tampon qui claque au centre de son parent quand [cle] change (« TOP DÉPART ! », « TROUVÉ ! ») : il tombe
 * de haut en tournant, tient un instant puis s'efface. Rien d'autre ne bouge, aucune touche n'est bloquée.
 */
@Composable
fun Tampon(
    texte: String,
    cle: Any?,
    couleur: Color = Neon.Or,
    actif: Boolean = true,
    tailleSp: Int = 72,
    dureeMs: Int = 1_200,
    modifier: Modifier = Modifier.fillMaxSize(),
) {
    val t = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle, actif) {
        if (!actif) return@LaunchedEffect
        t.snapTo(0f)
        t.animateTo(1f, tween(dureeMs, easing = LinearEasing))
    }
    // Lu à travers derivedStateOf : l'effet ne se recompose qu'en apparaissant et en disparaissant, pas à chaque image.
    val enCours by remember(t) { derivedStateOf { t.value > 0f && t.value < 1f } }
    if (!actif || !enCours) return
    Box(modifier.clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
        Text(
            texte,
            maxLines = 1,
            softWrap = false,
            style = TextStyle(
                color = couleur, fontSize = tailleSp.sp, lineHeight = (tailleSp + 6).sp, fontWeight = FontWeight.Black,
                letterSpacing = 4.sp, shadow = Shadow(couleur.copy(alpha = 0.8f), Offset.Zero, 28f),
            ),
            modifier = Modifier
                .graphicsLayer {
                    val ms = t.value * dureeMs
                    // 0-180 ms : tombe et se pose ; puis tient ; les 300 dernières ms : s'efface en grossissant.
                    val pose = (ms / 180f).coerceIn(0f, 1f)
                    val fin = ((ms - (dureeMs - 300)) / 300f).coerceIn(0f, 1f)
                    val s = 2.2f - 1.2f * pose + 0.25f * fin
                    scaleX = s
                    scaleY = s
                    rotationZ = -8f * pose
                    alpha = pose * (1f - fin)
                }
                .background(Neon.Nuit.copy(alpha = 0.55f), RoundedCornerShape(20.dp))
                .border(4.dp, couleur, RoundedCornerShape(20.dp))
                .padding(horizontal = 28.dp, vertical = 6.dp),
        )
    }
}

/** Gerbe de confettis d'une seconde et demie quand [cle] change : elle part du centre puis retombe. */
@Composable
fun Gerbe(cle: Any?, actif: Boolean = true, modifier: Modifier = Modifier) {
    val t = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle, actif) {
        if (!actif) return@LaunchedEffect
        t.snapTo(0f)
        t.animateTo(1f, tween(1_500, easing = LinearEasing))
    }
    val morceaux = remember {
        val couleurs = listOf(Neon.Or, Neon.OrClair, Neon.Halo, Color(0xFF7CFF3A), Color(0xFFFF2D8A), Color(0xFFFFE61F), Neon.Blanc)
        List(40) { i ->
            val r = java.util.Random(i * 104729L)
            val angle = (r.nextFloat() - 0.5f) * 2.6f
            Confetti(angle, 0.55f + r.nextFloat() * 0.6f, 0f, r.nextFloat() * 6.28f, 2f + r.nextFloat() * 5f, couleurs[i % couleurs.size])
        }
    }
    // Lu à travers derivedStateOf : l'effet ne se recompose qu'en apparaissant et en disparaissant, pas à chaque image.
    val enCours by remember(t) { derivedStateOf { t.value > 0f && t.value < 1f } }
    if (!actif || !enCours) return
    Canvas(modifier.fillMaxSize().clearAndSetSemantics {}) {
        val s = t.value
        val w = size.width
        val h = size.height
        val taille = h * 0.018f
        morceaux.forEach { m ->
            // m.x = angle de départ, m.depart = force : trajectoire en cloche, la gravité les ramène.
            val x = w / 2 + sin(m.x) * m.depart * w * 0.45f * s
            val y = h * 0.45f - cos(m.x) * m.depart * h * 0.9f * s + h * 1.1f * s * s
            val largeur = taille * (0.4f + 0.6f * kotlin.math.abs(cos(s * 12f * m.tour + m.phase)))
            rotate(s * 360f * m.tour + m.phase * 57f, Offset(x, y)) {
                drawRect(m.couleur.copy(alpha = 1f - s * s), Offset(x - largeur / 2, y - taille * 0.3f), Size(largeur, taille * 0.6f))
            }
        }
    }
}
