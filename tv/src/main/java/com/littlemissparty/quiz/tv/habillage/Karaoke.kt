package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.LigneParole
import com.littlemissparty.quiz.tv.R
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

/*
 * « Tous ensemble, on chante ! » : pendant que le refrain tourne en boucle à la révélation du blind test, la pochette
 * et son vinyle qui tourne à gauche, les paroles à droite. Chaque mot claque en or (il grossit, monte un peu et
 * retombe) à l'instant exact où il est chanté ; la ligne en cours est lisible d'avance en blanc doux, la suivante
 * attend en dessous, la précédente s'efface vers le haut. Chaque mot chanté donne une pulsation à la scène
 * (halo de la pochette, égaliseur) : l'écran bat avec la chanson.
 *
 * Tout se lit sur la position du lecteur du refrain ([positionMs], lue à chaque image) : aucun minuteur à part, donc
 * aucun décalage, et le retour au début de l'extrait (boucle) remet les paroles au début tout seul. Si le lecteur ne
 * donne jamais sa position, une horloge partie avec la révélation prend le relais.
 *
 * Léger pour la Mi Box : pochette, vinyle et mots sont des calques ; à chaque image seuls l'échelle, la position et
 * l'opacité changent. On ne recompose qu'au changement de ligne.
 */

/** Une ligne arrive à l'écran un peu avant son premier mot (le temps de la lire), jamais avant la fin de la précédente. */
private const val AVANCE_MS = 700L
/** Durée du glissement d'une ligne à la suivante. */
private const val GLISSE_MS = 320f

/** Instant d'arrivée de chaque ligne à l'écran (pour la lire d'avance). */
private fun entrees(paroles: List<LigneParole>): LongArray = LongArray(paroles.size) { i ->
    val l = paroles[i]
    val precedente = paroles.getOrNull(i - 1)
    // Pas avant que le dernier mot de la ligne d'avant ait été chanté (et un peu savouré).
    val auPlusTot = precedente?.let { p -> (p.mots.lastOrNull()?.debutMs ?: p.debutMs) + 250L } ?: Long.MIN_VALUE
    maxOf(l.debutMs - AVANCE_MS, auPlusTot).coerceAtMost(l.debutMs)
}

/** Index de la dernière valeur ≤ [x] dans un tableau trié, -1 s'il n'y en a pas. */
private fun dernierAvant(t: LongArray, x: Long): Int {
    var bas = 0
    var haut = t.size - 1
    var r = -1
    while (bas <= haut) {
        val m = (bas + haut) ushr 1
        if (t[m] <= x) { r = m; bas = m + 1 } else haut = m - 1
    }
    return r
}

/**
 * Scène des paroles, à la place de la révélation classique quand le refrain a des paroles. Mêmes informations que la
 * révélation : le titre et l'artiste sous la pochette, l'équipe gagnante et ses points en haut des paroles.
 *
 * @param positionMs position du refrain qu'on entend, en ms depuis le début de l'extrait ; null s'il ne joue pas
 *   (jamais de position : horloge locale depuis l'arrivée de la scène)
 */
@Composable
internal fun SceneParoles(
    cle: Any?,
    pochette: ImageBitmap?,
    titre: String,
    artiste: String?,
    gagnant: Pair<String, Color>?,
    points: Int,
    double: Boolean,
    paroles: List<LigneParole>,
    positionMs: () -> Long?,
    gagnants: List<Pair<String, Color>>? = null,
) {
    val ms = horloge(cle)
    val lecteur by rememberUpdatedState(positionMs)
    val pos = remember(cle) { mutableLongStateOf(-1L) }
    LaunchedEffect(cle) {
        // Tant que le lecteur n'a jamais donné sa position (refrain pas encore parti, ou lecteur muet), les paroles
        // défilent sur une horloge partie avec la révélation ; ensuite on suit le lecteur, et un trou passager
        // (changement de boucle) garde la dernière position au lieu de sauter.
        var debut = -1L
        var suivi = false
        while (true) withFrameMillis { t ->
            if (debut < 0) debut = t
            val p = lecteur()
            when {
                p != null -> { suivi = true; pos.longValue = p }
                !suivi -> pos.longValue = t - debut
            }
        }
    }
    val arrivees = remember(paroles) { entrees(paroles) }
    // Tous les mots, dans l'ordre, pour la pulsation : chaque mot chanté fait battre la scène.
    val coups = remember(paroles) { paroles.flatMap { l -> l.mots.map { it.debutMs } }.sorted().toLongArray() }
    val battement: () -> Float = {
        val p = pos.longValue
        val k = if (p < 0) -1 else dernierAvant(coups, p)
        if (k < 0) 0f else exp(-(p - coups[k]).toFloat() / 220f)
    }
    val ligne by remember(paroles) { derivedStateOf { if (pos.longValue < 0) -1 else dernierAvant(arrivees, pos.longValue) } }

    val entree = remember(cle) { Animatable(0f) }
    val sortie = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle) {
        entree.animateTo(1f, tween(600, easing = FastOutSlowInEasing))
        sortie.animateTo(1f, tween(800, easing = FastOutSlowInEasing))
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
    // Pochette à la taille de la scène (plus basse avec 8 équipes) : la place sous elle reste pour le titre et l'artiste.
    val c = (maxHeight - 52.dp - 130.dp).coerceIn(220.dp, 500.dp)
    Row(Modifier.fillMaxSize().padding(start = 48.dp, end = 40.dp, top = 28.dp, bottom = 24.dp), verticalAlignment = Alignment.CenterVertically) {
        // À gauche : la pochette, son vinyle qui sort et tourne, le titre et l'artiste.
        Column(Modifier.width(c * 1.42f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Box(Modifier.width(c * 1.42f).height(c), contentAlignment = Alignment.CenterStart) {
                // Halo derrière la pochette : il bat à chaque mot chanté.
                Box(
                    Modifier.size(c * 1.3f).offset(x = c * 0.06f).graphicsLayer { alpha = 0.35f + 0.5f * battement() }
                        .background(Brush.radialGradient(listOf(Color(0xFFB56BFF).copy(alpha = 0.40f), Color.Transparent))),
                )
                if (pochette != null) {
                    Vinyle(
                        angle = { ms() / 1000f * 198f },
                        modifier = Modifier.size(c * 0.94f).align(Alignment.CenterEnd).graphicsLayer {
                            // Il sort de derrière la pochette une fois celle-ci en place.
                            translationX = -(1f - sortie.value) * size.width * 0.45f
                            alpha = entree.value
                        },
                    )
                    Image(
                        pochette, contentDescription = null, contentScale = ContentScale.Crop,
                        modifier = Modifier.size(c).graphicsLayer {
                            val e = 0.7f + 0.3f * entree.value
                            scaleX = e; scaleY = e
                            alpha = entree.value
                            rotationY = (1f - entree.value) * 60f
                            cameraDistance = 16f * density
                        }.clip(RoundedCornerShape(16.dp)).border(5.dp, Neon.Or, RoundedCornerShape(16.dp)),
                    )
                } else {
                    // Pas de pochette : le vinyle à l'étiquette dorée, seul et plus grand.
                    Vinyle(angle = { ms() / 1000f * 198f }, modifier = Modifier.size(c).align(Alignment.Center).graphicsLayer { alpha = entree.value })
                }
            }
            Spacer(Modifier.height(14.dp))
            val tailleTitre = when {
                titre.length <= 22 -> 40.sp
                titre.length <= 34 -> 34.sp
                else -> 28.sp
            }
            Text(
                titre, color = Neon.Or, fontSize = tailleTitre, lineHeight = tailleTitre * 1.12f, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().apparition(400, cle),
            )
            if (!artiste.isNullOrBlank()) {
                Text(
                    artiste, color = Neon.Blanc.copy(alpha = 0.85f), fontSize = 28.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().apparition(700, cle),
                )
            }
        }
        Spacer(Modifier.width(36.dp))
        // À droite : qui a trouvé, puis les paroles, puis l'égaliseur qui bat avec la voix.
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Gagnant(cle, gagnant, points, double, gagnants)
            Spacer(Modifier.height(10.dp))
            Text(
                "🎤 TOUS ENSEMBLE, ON CHANTE !", color = Neon.OrClair, fontSize = 26.sp, fontWeight = FontWeight.Black, letterSpacing = 0.06.em,
                maxLines = 1, softWrap = false, modifier = Modifier.apparition(900, cle),
            )
            Box(Modifier.weight(1f).fillMaxWidth()) {
                Paroles(paroles, arrivees, ligne, pos, battement)
            }
            Pulsation(battement, ms, Modifier.fillMaxWidth().height(46.dp))
        }
    }
    }
}

/**
 * L'équipe qui a trouvé et ses points, dans un bandeau compact ; sans gagnant, une ligne plus discrète. Quiz musical
 * ([gagnants] non nul) : toutes les équipes qui ont trouvé, chacune dans sa couleur (leurs points sont sous la scène).
 */
@Composable
private fun Gagnant(cle: Any?, gagnant: Pair<String, Color>?, points: Int, double: Boolean, gagnants: List<Pair<String, Color>>? = null) {
    if (!gagnants.isNullOrEmpty()) {
        BravoEquipes(gagnants, 38.sp, Modifier.padding(vertical = 8.dp).apparition(500, cle))
    } else if (gagnants == null && gagnant != null && points > 0) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.apparition(500, cle)) {
            Box(Modifier.size(88.dp).rebond(apres(500, cle), 0.08f).clip(CircleShape).background(gagnant.second), contentAlignment = Alignment.Center) {
                val chiffres = "+$points".length
                Text(
                    "+$points", color = Neon.Nuit, fontSize = if (chiffres > 4) 24.sp else if (chiffres > 3) 30.sp else 36.sp,
                    fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                )
            }
            Spacer(Modifier.width(20.dp))
            Column {
                Text(
                    "Bravo ${gagnant.first} !", color = gagnant.second, fontSize = 38.sp, lineHeight = 42.sp, fontWeight = FontWeight.Black,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    when {
                        points > 1 && double -> "$points points (points doublés !)"
                        points > 1 -> "$points points"
                        else -> "1 point"
                    },
                    color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 24.sp, fontWeight = FontWeight.Bold, maxLines = 1,
                )
            }
        }
    } else {
        Text(
            "Personne n'a trouvé, ce n'est pas grave !", color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 30.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, softWrap = false, modifier = Modifier.padding(vertical = 8.dp).apparition(500, cle),
        )
    }
}

/** « Bravo les Licornes et les Dragons ! » : chaque équipe qui a trouvé écrite dans sa couleur, sur deux lignes au plus. */
@Composable
internal fun BravoEquipes(equipes: List<Pair<String, Color>>, taille: TextUnit, modifier: Modifier = Modifier) {
    val texte = buildAnnotatedString {
        append("Bravo ")
        equipes.forEachIndexed { k, (nom, couleur) ->
            if (k > 0) append(if (k == equipes.lastIndex) " et " else ", ")
            withStyle(SpanStyle(color = couleur)) { append(nom) }
        }
        append(" !")
    }
    Text(
        texte, color = Neon.Blanc, fontSize = taille, lineHeight = taille * 1.12f, fontWeight = FontWeight.Black,
        maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = modifier,
    )
}

/**
 * Trois emplacements : la ligne d'avant (petite, qui s'efface vers le haut), la ligne chantée (grande, au centre) et la
 * suivante (petite, en dessous). Au changement de ligne, tout glisse d'un cran vers le haut.
 */
@Composable
private fun Paroles(paroles: List<LigneParole>, arrivees: LongArray, ligne: Int, pos: State<Long>, battement: () -> Float) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val h = maxHeight
        val haut = h * 0.20f
        val milieu = h * 0.56f
        // Avancée du glissement vers la ligne en cours (0 → 1), lue au dessin.
        val glisse: () -> Float = {
            if (ligne < 0) 1f else {
                val x = ((pos.value - arrivees[ligne]).toFloat() / GLISSE_MS).coerceIn(0f, 1f)
                1f - (1f - x) * (1f - x)
            }
        }
        val pas = with(androidx.compose.ui.platform.LocalDensity.current) { milieu.toPx() * 0.62f }
        val precedente = paroles.getOrNull(ligne - 1)
        val courante = paroles.getOrNull(ligne)
        val suivante = paroles.getOrNull(ligne + 1)
        // La ligne d'avant : elle monte et s'éteint.
        if (precedente != null && precedente.mots.isNotEmpty()) {
            Box(
                Modifier.fillMaxWidth().height(haut).align(Alignment.TopCenter).graphicsLayer {
                    val g = glisse()
                    translationY = (1f - g) * pas
                    alpha = 0.30f * (1f - 0.4f * g)
                },
                contentAlignment = Alignment.Center,
            ) {
                LigneSimple(precedente.texte, 30.sp, Neon.Or)
            }
        }
        // La ligne chantée.
        Box(
            Modifier.fillMaxWidth().height(milieu).align(Alignment.TopCenter).offset(y = haut).graphicsLayer {
                val g = glisse()
                translationY = (1f - g) * pas
                val s = 0.62f + 0.38f * g + 0.025f * battement()
                scaleX = s; scaleY = s
                alpha = 0.5f + 0.5f * g
            },
            contentAlignment = Alignment.Center,
        ) {
            if (courante == null || courante.mots.isEmpty()) {
                Notes(pos)
            } else {
                key(ligne) { LigneChantee(courante, pos) }
            }
        }
        // La suivante, en attente.
        if (suivante != null) {
            Box(
                Modifier.fillMaxWidth().height(h - haut - milieu).align(Alignment.BottomCenter).graphicsLayer {
                    alpha = 0.42f * glisse()
                },
                contentAlignment = Alignment.Center,
            ) {
                if (suivante.mots.isEmpty()) LigneSimple("♪  ♪  ♪", 30.sp, Neon.Blanc) else LigneSimple(suivante.texte, 30.sp, Neon.Blanc)
            }
        }
    }
}

/** Une ligne au repos (d'avant ou suivante) : deux lignes au plus, la taille baisse si elle est longue. */
@Composable
private fun LigneSimple(texte: String, taille: TextUnit, couleur: Color) {
    val t = if (texte.length > 70) taille * 0.8f else taille
    Text(
        texte, color = couleur, fontSize = t, lineHeight = t * 1.15f, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
        maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
    )
}

private val TAILLES = listOf(72, 64, 56, 50, 44, 38, 32)

/**
 * La ligne chantée, mot par mot. La taille est la plus grande qui tient en deux lignes (trois pour les très longues)
 * dans la largeur : rien n'est jamais coupé. Chaque mot reste en blanc doux jusqu'à son instant, puis claque en or.
 */
@Composable
private fun LigneChantee(ligne: LigneParole, pos: State<Long>) {
    val mesure = rememberTextMeasurer()
    BoxWithConstraints(Modifier.fillMaxSize().padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
        val densite = androidx.compose.ui.platform.LocalDensity.current
        val largeur = with(densite) { maxWidth.toPx() }
        val hauteur = with(densite) { maxHeight.toPx() }
        val base = TextStyle(fontFamily = PoliceLmp, fontWeight = FontWeight.Black, fontSize = 100.sp)
        // Largeur de chaque mot à 100 sp : la largeur d'un texte suit sa taille, on en déduit la bonne taille sans re-mesurer.
        val mots = remember(ligne, densite) { ligne.mots.map { mesure.measure(it.texte, base).size.width.toFloat() } }
        val espace = remember(densite) { (mesure.measure("a a", base).size.width - mesure.measure("aa", base).size.width).toFloat() }
        val taille = remember(mots, largeur, hauteur) {
            TAILLES.firstOrNull { t ->
                val k = t / 100f
                val lignes = rangees(mots.map { it * k * 1.16f }, espace * k, largeur)
                val maxi = if (t >= 50) 2 else 3
                lignes <= maxi && lignes * with(densite) { (t * 1.18f).sp.toPx() } <= hauteur
            } ?: TAILLES.last()
        }
        val style = TextStyle(fontFamily = PoliceLmp, fontWeight = FontWeight.Black, fontSize = taille.sp, lineHeight = (taille * 1.12f).sp)
        val brille = style.copy(color = Neon.Or, shadow = Shadow(Neon.Or.copy(alpha = 0.7f), Offset.Zero, 22f))
        // Le mot qu'on chante en ce moment : blanc chauffé à blanc, cerné d'un néon doré.
        val vif = style.copy(color = Color.White, shadow = Shadow(Neon.OrClair, Offset.Zero, 36f))
        val doux = style.copy(color = Neon.Blanc.copy(alpha = 0.42f))
        Mots(espace * taille / 100f, with(densite) { (taille * 0.18f).sp.toPx() }) {
            ligne.mots.forEachIndexed { k, m ->
                // Le mot reste « en cours » jusqu'au mot suivant de la ligne (le dernier, jusqu'à la fin de la ligne).
                val fin = ligne.mots.getOrNull(k + 1)?.debutMs ?: ligne.finMs
                Box(
                    Modifier
                        .drawBehind { eclatMot(pos.value, m.debutMs, fin, k) }
                        .graphicsLayer {
                            val e = (pos.value - m.debutMs).toFloat()
                            if (pos.value >= 0 && e >= 0f) {
                                // Le pop : gros d'un coup, petit rebond, puis il se pose.
                                val s = 1f + 0.30f * exp(-e / 140f) * cos(e / 80f)
                                scaleX = s; scaleY = s
                                translationY = -0.32f * size.height * exp(-e / 160f)
                            }
                        },
                ) {
                    Text(m.texte, style = doux, maxLines = 1, softWrap = false, modifier = Modifier.graphicsLayer { alpha = if (allume(pos, m.debutMs)) 0f else 1f })
                    Text(m.texte, style = brille, maxLines = 1, softWrap = false, modifier = Modifier.graphicsLayer {
                        alpha = if (allume(pos, m.debutMs) && pos.value >= fin) 1f else 0f
                    })
                    Text(m.texte, style = vif, maxLines = 1, softWrap = false, modifier = Modifier.graphicsLayer {
                        alpha = if (allume(pos, m.debutMs) && pos.value < fin) 1f else 0f
                    })
                }
            }
        }
    }
}

/**
 * Lumière du mot chanté, dessinée derrière lui : au moment où il tombe, un éclat d'étoile (rayons dorés qui
 * jaillissent) et quatre petites étoiles ✦ qui s'envolent ; tant qu'on le chante, un halo doré qui respire et une
 * barre de lumière dessous, qui passe de mot en mot comme un projecteur. Or, blanc et une pointe de violet néon :
 * jamais de rose terne.
 */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.eclatMot(pos: Long, debut: Long, fin: Long, rang: Int) {
    if (pos < 0 || pos < debut) return
    val e = (pos - debut).toFloat()
    val r = size.maxDimension
    val c = center
    val enCours = pos < fin
    if (enCours) {
        // Halo qui respire tant que le mot est chanté.
        val souffle = 0.75f + 0.25f * sin(e / 140f)
        drawCircle(Brush.radialGradient(listOf(Neon.OrClair.copy(alpha = 0.38f * souffle), Neon.Violet.copy(alpha = 0.10f), Color.Transparent), c, r * 0.85f), r * 0.85f, c)
        // Barre de lumière sous le mot : elle s'étire en 120 ms (on la voit glisser d'un mot à l'autre).
        val l = size.width * (0.2f + 0.8f * (e / 120f).coerceIn(0f, 1f))
        val h = size.height * 0.07f
        val y = size.height * 0.98f
        drawRoundRect(
            Brush.horizontalGradient(listOf(Color.Transparent, Neon.Or, Color.White, Neon.Or, Color.Transparent), c.x - l / 2, c.x + l / 2),
            Offset(c.x - l / 2, y), Size(l, h), CornerRadius(h / 2),
        )
        drawRoundRect(Neon.Or.copy(alpha = 0.25f), Offset(c.x - l / 2, y - h), Size(l, h * 3), CornerRadius(h * 1.5f))
    }
    if (e <= 650f) {
        val p = e / 650f
        val a = (1f - p) * (1f - p)
        // Éclat : douze rayons fins qui jaillissent et s'effacent, un peu tournés à chaque mot.
        val tourne = rang * 0.45f
        for (k in 0 until 12) {
            val ang = tourne + k * (2f * PI.toFloat() / 12f)
            val dedans = r * (0.30f + 0.25f * p)
            val dehors = r * (0.45f + (if (k % 2 == 0) 0.55f else 0.35f) * p)
            drawLine(
                if (k % 3 == 0) Color.White.copy(alpha = 0.9f * a) else Neon.Or.copy(alpha = 0.85f * a),
                Offset(c.x + cos(ang) * dedans, c.y + sin(ang) * dedans * 0.7f),
                Offset(c.x + cos(ang) * dehors, c.y + sin(ang) * dehors * 0.7f),
                strokeWidth = size.height * 0.035f, cap = androidx.compose.ui.graphics.StrokeCap.Round,
            )
        }
        // Quatre étoiles ✦ qui s'envolent en scintillant.
        for (k in 0 until 4) {
            val ang = tourne + 0.6f + k * (PI.toFloat() / 2f)
            val d = r * (0.35f + 0.55f * p)
            val o = Offset(c.x + cos(ang) * d, c.y + sin(ang) * d * 0.75f - size.height * 0.4f * p)
            val t = size.height * (0.16f - 0.08f * p)
            drawPath(etoile(o, t), if (k % 2 == 0) Color.White.copy(alpha = a) else Neon.OrClair.copy(alpha = a))
        }
        // Flash blanc-doré au tout début.
        if (e < 220f) {
            val f = 1f - e / 220f
            drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.55f * f), Neon.Or.copy(alpha = 0.25f * f), Color.Transparent), c, r * 0.7f), r * 0.7f, c)
        }
    }
}

/** Étoile fine à quatre branches (✦), comme les paillettes du plateau. */
private fun etoile(c: Offset, r: Float) = androidx.compose.ui.graphics.Path().apply {
    val m = r * 0.18f
    moveTo(c.x, c.y - r)
    quadraticBezierTo(c.x + m, c.y - m, c.x + r, c.y)
    quadraticBezierTo(c.x + m, c.y + m, c.x, c.y + r)
    quadraticBezierTo(c.x - m, c.y + m, c.x - r, c.y)
    quadraticBezierTo(c.x - m, c.y - m, c.x, c.y - r)
    close()
}

private fun allume(pos: State<Long>, debut: Long) = pos.value >= 0 && pos.value >= debut

/** Nombre de rangées quand on pose les mots de gauche à droite dans [largeur], en passant à la ligne quand ça ne tient plus. */
private fun rangees(mots: List<Float>, espace: Float, largeur: Float): Int {
    var n = 1
    var x = 0f
    for (w in mots) {
        val besoin = if (x == 0f) w else x + espace + w
        if (besoin > largeur && x > 0f) { n++; x = w } else x = besoin
    }
    return n
}

/** Pose les mots comme un texte centré : de gauche à droite, à la ligne quand ça ne tient plus, chaque rangée centrée. */
@Composable
private fun Mots(espace: Float, interligne: Float, contenu: @Composable () -> Unit) {
    Layout(contenu) { mesurables, contraintes ->
        val libres = contraintes.copy(minWidth = 0, minHeight = 0)
        val places = mesurables.map { it.measure(libres) }
        val largeur = contraintes.maxWidth
        val rangs = mutableListOf<MutableList<Int>>()
        var x = 0f
        places.forEachIndexed { i, p ->
            val besoin = if (rangs.isEmpty() || x == 0f) p.width.toFloat() else x + espace + p.width
            if (rangs.isEmpty() || (besoin > largeur && x > 0f)) { rangs.add(mutableListOf(i)); x = p.width.toFloat() } else { rangs.last().add(i); x = besoin }
        }
        val hauteurs = rangs.map { r -> r.maxOf { places[it].height } }
        val total = (hauteurs.sum() + interligne * (rangs.size - 1).coerceAtLeast(0)).toInt().coerceAtMost(contraintes.maxHeight)
        layout(largeur, total) {
            var y = 0f
            rangs.forEachIndexed { k, r ->
                val w = r.sumOf { places[it].width } + espace * (r.size - 1)
                var xx = (largeur - w) / 2f
                r.forEach { i ->
                    places[i].place(xx.toInt(), (y + (hauteurs[k] - places[i].height) / 2f).toInt())
                    xx += places[i].width + espace
                }
                y += hauteurs[k] + interligne
            }
        }
    }
}

/** Passage sans paroles (intro, pont instrumental) : trois notes qui dansent. */
@Composable
private fun Notes(pos: State<Long>) {
    Row(horizontalArrangement = Arrangement.spacedBy(36.dp), verticalAlignment = Alignment.CenterVertically) {
        for (k in 0 until 3) {
            Text(
                "♪", color = Neon.Or, fontSize = 72.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                modifier = Modifier.graphicsLayer {
                    val t = (if (pos.value >= 0) pos.value else 0L) / 1000f
                    translationY = -abs(sin((t * 2.2f + k * 0.33f) * PI.toFloat())) * 26.dp.toPx()
                    alpha = 0.6f + 0.4f * abs(sin((t * 2.2f + k * 0.33f) * PI.toFloat()))
                },
            )
        }
    }
}

/** Égaliseur sous les paroles : il saute à chaque mot chanté et ondule doucement entre deux. */
@Composable
private fun Pulsation(battement: () -> Float, ms: () -> Float, modifier: Modifier) {
    val barres = 28
    Canvas(modifier) {
        val b = battement()
        val t = ms() / 1000f
        val l = size.width / (barres * 1.5f)
        for (k in 0 until barres) {
            val vague = 0.3f + 0.25f * sin(t * 3.4f + k * 0.8f) + 0.2f * sin(t * 6.1f + k * 2.3f)
            // Plus haut au centre, comme une voix.
            val centre = 1f - abs(k - (barres - 1) / 2f) / barres
            val h = size.height * (0.12f + 0.88f * (0.65f * b * centre + 0.35f * abs(vague)).coerceIn(0f, 1f))
            val x = k * l * 1.5f + l * 0.25f
            drawRoundRect(if (k % 2 == 0) Neon.Or else Color(0xFFB56BFF), Offset(x, size.height - h), Size(l, h.coerceAtLeast(4f)), CornerRadius(l / 2))
        }
    }
}

/** Le vinyle seul (sans bras ni socle), à l'étiquette dorée, qui tourne : derrière la pochette ou à sa place. */
@Composable
internal fun Vinyle(angle: () -> Float, modifier: Modifier = Modifier) {
    Box(modifier.aspectRatio(1f).graphicsLayer { rotationZ = angle() }, contentAlignment = Alignment.Center) {
        Image(painterResource(R.drawable.lmp_bt_vinyle), contentDescription = null, modifier = Modifier.fillMaxSize())
        Image(painterResource(R.drawable.lmp_bt_label_or), contentDescription = null, modifier = Modifier.fillMaxSize(0.331f))
    }
}
