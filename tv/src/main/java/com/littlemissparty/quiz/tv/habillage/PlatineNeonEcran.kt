package com.littlemissparty.quiz.tv.habillage

import android.os.SystemClock
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/** Le haut de l'image du disque n'a que les lasers : on le laisse déborder au-dessus de la place de la platine. */
private const val HAUT_VIDE = 0.2f

/**
 * Platine néon du Blind test, look Game Show (maquette validée par cedric le 24/10) : le disque est une boucle vidéo
 * calculée en 3D ([LecteurAlpha]), le bras une planche de 9 positions, et toute la lumière qui suit la musique est
 * dessinée en direct ([PlatineNeon]) : couronne d'égaliseur (moitié derrière le disque, moitié devant), ondes de choc,
 * lasers fins sur les temps, hologramme au-dessus de l'axe. Le direct suit le tempo de l'appli, comme l'égaliseur
 * du look Classique.
 *
 * Quand la musique s'arrête, le disque ralentit puis se fige, le bras se relève, la lumière retombe. Vidéo ou planche
 * absente, ou vidéo illisible : [secours] (la platine de toujours). Rien ici ne touche à la partie.
 *
 * Léger pour la Mi Box : un décodage vidéo (comme un clip du robot), deux Canvas redessinés une trentaine de fois par
 * seconde, des traits droits et quelques dégradés ; aucune recomposition pendant l'écoute.
 */
@Composable
internal fun PlatineNeonGs(joue: Boolean, manquant: Boolean, modifier: Modifier = Modifier, secours: @Composable () -> Unit) {
    val context = LocalContext.current
    val disque = remember { context.resources.getIdentifier("gs_bt_disque", "raw", context.packageName) }
    val planche = remember {
        val id = context.resources.getIdentifier("gs_bt_bras", "drawable", context.packageName)
        if (id == 0) null else runCatching { ImageBitmap.imageResource(context.resources, id) }.getOrNull()
    }
    var echec by remember { mutableStateOf(false) }
    if (disque == 0 || planche == null || echec) {
        secours()
        return
    }

    val vie = animateFloatAsState(if (joue) 1f else 0f, tween(400), label = "lumiere")
    val niveau = animateFloatAsState(if (joue) 1f else 0.08f, tween(350), label = "egaliseur")
    val holo = animateFloatAsState(if (joue) 1f else 0f, tween(if (joue) 600 else 450), label = "hologramme")
    val leve = animateFloatAsState(if (joue) 0f else 1f, tween(if (joue) 500 else 300, easing = FastOutSlowInEasing), label = "bras")
    val jouant by rememberUpdatedState(joue)
    val horloge = remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) {
        while (true) {
            horloge.longValue = SystemClock.elapsedRealtime()
            delay(30)
        }
    }
    // Les trois Canvas lisent la même image de lumière : calculée une fois par tic d'horloge.
    val pics = remember { PlatineNeon.Pics() }
    val cache = remember { arrayOfNulls<PlatineNeon.Calques>(1) }
    val cacheMs = remember { longArrayOf(Long.MIN_VALUE) }
    fun calques(): PlatineNeon.Calques {
        val maintenant = horloge.longValue
        val ms = maintenant - Sons.departDesLits
        val etat = PlatineNeon.Etat(ms / 1000f, ms, vie.value, niveau.value, holo.value, leve.value, jouant)
        if (maintenant != cacheMs[0] || cache[0] == null) {
            cache[0] = PlatineNeon.calques(etat, pics)
            cacheMs[0] = maintenant
        }
        return cache[0]!!
    }

    // Le disque ralentit en un peu plus d'une demi-seconde puis se fige ; il repart d'un coup.
    val lecteur = remember { arrayOfNulls<LecteurAlpha>(1) }
    LaunchedEffect(joue) {
        if (joue) lecteur[0]?.vitesse(1f)
        else {
            for (v in floatArrayOf(0.75f, 0.5f, 0.25f)) {
                lecteur[0]?.vitesse(v)
                delay(150)
            }
            lecteur[0]?.vitesse(0f)
        }
    }
    var pret by remember { mutableStateOf(false) }

    Box(modifier) {
        // Image du disque (1012 × 900) aussi large que la place, posée en bas : son haut vide déborde.
        Box(
            Modifier.fillMaxSize().layout { mesurable, contraintes ->
                val l = contraintes.maxWidth.toFloat()
                val h = contraintes.maxHeight.toFloat()
                val w = minOf(l, h / (1 - HAUT_VIDE) * PlatineNeon.LARGEUR / PlatineNeon.HAUTEUR)
                val wi = w.roundToInt()
                val hi = (w * PlatineNeon.HAUTEUR / PlatineNeon.LARGEUR).roundToInt()
                val p = mesurable.measure(Constraints.fixed(wi, hi))
                layout(contraintes.maxWidth, contraintes.maxHeight) { p.place(((l - wi) / 2).roundToInt(), (h - hi).roundToInt()) }
            },
        ) {
            Canvas(Modifier.fillMaxSize()) { dessinerTraits(calques().derriere) }
            AndroidView(
                factory = {
                    LecteurAlpha(it, disque, surDebut = { pret = true }, surEchec = { echec = true }, boucle = true).also { l ->
                        lecteur[0] = l
                        if (!jouant) l.vitesse(0f)
                    }
                },
                onRelease = {
                    lecteur[0] = null
                    it.liberer()
                },
                modifier = Modifier.fillMaxHeight().fillMaxWidth(PlatineNeon.VIDEO_L / PlatineNeon.LARGEUR)
                    .clearAndSetSemantics {}.graphicsLayer { alpha = if (pret) 1f else 0f },
            )
            Canvas(Modifier.fillMaxSize()) {
                val c = calques()
                dessinerTraits(c.milieu)
                dessinerBras(planche, leve.value)
                dessinerTraits(c.devant)
            }
        }
        if (manquant) {
            Text(
                "Extrait indisponible : l'animatrice peut passer.", color = GS.Encre, fontSize = 20.sp, lineHeight = 24.sp,
                fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp)
                    .clip(RoundedCornerShape(14.dp)).background(GS.Noir.copy(alpha = 0.75f)).padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
    }
}

/**
 * Comme [Echelle], sans couper ce qui dépasse : les lasers de la platine néon montent au-dessus de la scène, jusqu'au
 * haut de l'écran comme dans la maquette.
 */
@Composable
internal fun EchelleSansCoupe(largeur: Dp, hauteur: Dp, modifier: Modifier = Modifier, contenu: @Composable BoxScope.() -> Unit) {
    BoxWithConstraints(modifier) {
        val k = minOf(maxWidth / largeur, maxHeight / hauteur).coerceIn(0.2f, 1.25f)
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density * k, d.fontScale)) {
            Box(Modifier.fillMaxSize(), content = contenu)
        }
    }
}

private fun couleur(c: Long, alpha: Float) = Color(0xFF000000L or c).copy(alpha = alpha.coerceIn(0f, 1f))

/** Bras : la position la plus proche de [leve] sur la planche, à sa place dans l'image du disque. */
private fun DrawScope.dessinerBras(planche: ImageBitmap, leve: Float) {
    val (k, f) = PlatineNeon.imageBras(leve)
    val i = if (f >= 0.5f) k + 1 else k
    val s = size.width / PlatineNeon.LARGEUR
    with(PlatineNeon) {
        drawImage(
            planche,
            IntOffset(i % 3 * BRAS_L, i / 3 * BRAS_H), IntSize(BRAS_L, BRAS_H),
            IntOffset((BRAS_X * s).roundToInt(), (BRAS_Y * s).roundToInt()), IntSize((BRAS_L * s).roundToInt(), (BRAS_H * s).roundToInt()),
        )
    }
}

/**
 * Dessine des traits de [PlatineNeon] (coordonnées 0..1 de l'image du disque ; épaisseurs et rayons en fraction de sa
 * largeur). Chaque trait de lumière a son halo : un trait large et pâle sous le trait net, comme la lueur du rendu 3D.
 */
private fun DrawScope.dessinerTraits(traits: List<PlatineNeon.Trait>) {
    val w = size.width
    val h = size.height
    fun pt(p: FloatArray, i: Int) = Offset(p[i] * w, p[i + 1] * h)
    fun chemin(t: PlatineNeon.Trait) = Path().apply {
        moveTo(t.points[0] * w, t.points[1] * h)
        var i = 2
        while (i < t.points.size) {
            lineTo(t.points[i] * w, t.points[i + 1] * h)
            i += 2
        }
        if (t.ferme) close()
    }
    for (t in traits) {
        if (t.alpha <= 0.004f) continue
        val e = max(1f, t.largeur * w)
        when (t.genre) {
            PlatineNeon.Genre.LIGNE -> if (t.points.size == 4) {
                val a = pt(t.points, 0)
                val b = pt(t.points, 2)
                drawLine(couleur(t.couleur, t.alpha * 0.22f), a, b, e * 2.5f, StrokeCap.Butt)
                drawLine(couleur(t.couleur, t.alpha), a, b, e, StrokeCap.Butt)
            } else {
                val p = chemin(t)
                drawPath(p, couleur(t.couleur, t.alpha * 0.22f), style = Stroke(e * 2.5f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                drawPath(p, couleur(t.couleur, t.alpha), style = Stroke(e, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            PlatineNeon.Genre.BARRE -> {
                val a = pt(t.points, 0)
                val b = pt(t.points, 2)
                drawLine(Brush.linearGradient(listOf(couleur(t.couleur, t.alpha * 0.1f), couleur(t.couleur, t.alpha * 0.3f)), a, b), a, b, e * 2.5f, StrokeCap.Butt)
                drawLine(Brush.linearGradient(listOf(couleur(t.couleur, t.alpha * 0.35f), couleur(t.couleur, t.alpha)), a, b), a, b, e, StrokeCap.Butt)
            }
            PlatineNeon.Genre.DEGRADE -> {
                val a = pt(t.points, 0)
                val b = pt(t.points, 2)
                drawLine(
                    Brush.linearGradient(listOf(couleur(t.couleur, t.alpha), couleur(t.couleur, 0f)), a, b),
                    a, b, e, StrokeCap.Round,
                )
            }
            PlatineNeon.Genre.REMPLI -> drawPath(chemin(t), couleur(t.couleur, t.alpha))
            PlatineNeon.Genre.LUEUR -> {
                val c = pt(t.points, 0)
                val rx = max(1f, t.points[2] * w)
                val ry = max(1f, t.points[3] * w)
                withTransform({ scale(1f, ry / rx, c) }) {
                    drawCircle(
                        Brush.radialGradient(
                            listOf(couleur(t.couleur, t.alpha), couleur(t.couleur, t.alpha * 0.35f), couleur(t.couleur, 0f)), c, rx,
                        ),
                        rx, c,
                    )
                }
            }
            PlatineNeon.Genre.NOTE -> {
                // Croche : tête ovale, hampe, crochet ; [etirement] la fait tourner sur elle-même.
                val c = pt(t.points, 0)
                val s = e
                val col = couleur(t.couleur, t.alpha)
                withTransform({ scale(t.etirement.coerceIn(-1f, 1f).let { if (it in -0.08f..0.08f) 0.08f else it }, 1f, c) }) {
                    drawLine(couleur(t.couleur, t.alpha * 0.25f), Offset(c.x + s * 0.18f, c.y + s * 0.3f), Offset(c.x + s * 0.18f, c.y - s * 0.45f), s * 0.3f, StrokeCap.Round)
                    withTransform({ rotate(-20f, Offset(c.x - s * 0.02f, c.y + s * 0.32f)) }) {
                        drawOval(col, Offset(c.x - s * 0.24f, c.y + s * 0.2f), Size(s * 0.44f, s * 0.26f))
                    }
                    drawLine(col, Offset(c.x + s * 0.18f, c.y + s * 0.3f), Offset(c.x + s * 0.18f, c.y - s * 0.45f), s * 0.07f, StrokeCap.Round)
                    drawLine(col, Offset(c.x + s * 0.18f, c.y - s * 0.45f), Offset(c.x + s * 0.42f, c.y - s * 0.2f), s * 0.07f, StrokeCap.Round)
                }
            }
        }
    }
}
