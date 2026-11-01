package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.MimeCard
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.GenrePlaque
import com.littlemissparty.quiz.tv.habillage.PlaqueAppel
import com.littlemissparty.quiz.tv.habillage.PoliceGsTitre
import com.littlemissparty.quiz.tv.habillage.RevelationNeon
import com.littlemissparty.quiz.tv.habillage.apparition
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * 🧩 Le Rébus (cedric, 1/11). Toute la largeur de la scène : en haut l'appel « BUZZEZ ! » (puis l'équipe qui a buzzé, puis
 * le mot en néon à la révélation), dessous une rangée de carrés, un par morceau du rébus.
 *
 * Avant d'arriver, chaque morceau est un carré mystère (contour néon, « ? » qui respire) : on sait qu'une image va venir
 * là. Autour du prochain carré, une mèche dorée fait le tour du cadre au fil du chrono (jamais de compteur à l'écran) ;
 * quand elle a fini, le carré se retourne comme une carte (éclair, anneau doré qui s'envole, étincelles, petit rebond).
 * À la révélation, ce que chaque morceau fait entendre s'écrit dessous, l'un après l'autre, puis le mot s'allume en haut.
 * Tout tient de 1 à 8 équipes : les carrés prennent la taille que la place leur laisse.
 */
@Composable
fun RebusBoard(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val remaining = chronoRestant(q, state)
    val revealed = state.phase == Phase.REVEAL || state.phase == Phase.SCORES
    val ecoule = q.durationMs - remaining
    val n = q.cards.size.coerceAtLeast(1)
    val shown = if (revealed || state.phase == Phase.CLOSED) n else q.cluesShown(ecoule)
    val pas = (q.durationMs / n).coerceAtLeast(1)
    // La mèche du prochain carré : la part du pas déjà passée (figée pendant un buzz ou une pause, comme le chrono).
    val meche = if (state.phase == Phase.QUESTION && shown < n) ((ecoule - (shown - 1) * pas).toFloat() / pas).coerceIn(0f, 1f) else 0f
    val buzzer = state.teams.find { it.uid == state.buzzTeam }
    val passees = state.teams.filter { it.uid in state.buzzBlocked }
    val gagnant = state.teams.find { (state.awards[it.uid]?.points ?: 0) > 0 }
    // Les morceaux déjà là quand l'écran se dessine ne rejouent pas leur arrivée (reprise de la box, retour de pause).
    val dejaLa = remember(q.id) { shown }
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.fillMaxWidth().weight(0.30f), contentAlignment = Alignment.Center) {
            when {
                revealed -> RevelationNeon(
                    etiquette = "Le mot :",
                    mot = q.choices.getOrNull(q.correct).orEmpty(),
                    phrase = if (gagnant != null) "Bravo ${gagnant.name} !" else "Personne n'a trouvé, ce n'est pas grave !",
                    teinte = gagnant?.color?.toColor() ?: GS.Rose,
                    cle = q.id,
                    modifier = Modifier.fillMaxSize(),
                )
                buzzer != null -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    TexteAjuste(
                        "${buzzer.name} a buzzé !", color = buzzer.color.toColor(), max = 44.sp, min = 20.sp, lignes = 1, jauge = true,
                        modifier = Modifier.fillMaxWidth().apparition(0, buzzer.uid),
                    )
                    TexteAjuste("On écoute sa réponse…", color = GS.Encre, max = 26.sp, min = 14.sp, lignes = 1, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth())
                }
                state.phase == Phase.CLOSED -> TexteAjuste("Temps écoulé ! Voyons ce mot…", color = GS.Jaune, max = 38.sp, min = 18.sp, lignes = 1, jauge = true, modifier = Modifier.fillMaxWidth())
                else -> PlaqueAppel(GenrePlaque.QUISUIS, "BUZZEZ !", "dès que vous avez\ntrouvé le mot")
            }
        }
        BoxWithConstraints(Modifier.fillMaxWidth().weight(0.70f), contentAlignment = Alignment.Center) {
            val densite = LocalDensity.current
            val ecart = if (n <= 2) 56.dp else if (n <= 4) 28.dp else 18.dp
            // Sous chaque carré : la place du son à la révélation (et de « Déjà essayé » pendant la question).
            val sous = 46.dp
            val largeurDispo = maxWidth - ecart * (n - 1)
            val c: Dp = minOf(largeurDispo / n, maxHeight - sous - 12.dp, 230.dp).coerceAtLeast(40.dp)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Row(horizontalArrangement = Arrangement.spacedBy(ecart), verticalAlignment = Alignment.Top) {
                    q.cards.forEachIndexed { i, carte ->
                        key(q.id, i) {
                            val etat = when {
                                i < shown -> EtatCase.VUE
                                i == shown -> EtatCase.PROCHAINE
                                else -> EtatCase.CACHEE
                            }
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CaseRebus(
                                    carte, photoDe(carte, state), etat, if (etat == EtatCase.PROCHAINE) meche else 0f,
                                    arrivee = i >= dejaLa, cote = c, teinte = TEINTES_REBUS[i % TEINTES_REBUS.size],
                                )
                                Box(Modifier.size(c, sous), contentAlignment = Alignment.BottomCenter) {
                                    if (revealed) SonDuMorceau(carte.word, Modifier.fillMaxWidth().apparition(600L + 450L * i, q.id))
                                }
                            }
                        }
                    }
                }
                if (passees.isNotEmpty() && state.phase == Phase.QUESTION) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Déjà essayé : " + passees.joinToString(", ") { it.name },
                        style = TextStyle(shadow = Shadow(Color.Black, blurRadius = with(densite) { 10.dp.toPx() })),
                        color = GS.PlaqueTexte, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

internal enum class EtatCase { CACHEE, PROCHAINE, VUE }

/** La photo d'un morceau une fois chargée sur la box (null : émoji, lettre ou photo pas encore là). */
@Composable
private fun photoDe(carte: MimeCard, state: UiState.Playing): ImageBitmap? = rememberPhoto(carte.imageId?.let { state.images[it] })

/** Un morceau sans photo ni émoji : une lettre ou un chiffre (« K », « 6 »), écrit en néon. */
internal fun estLettre(carte: MimeCard): Boolean = carte.imageId == null && carte.image.isNullOrBlank()

private val CyanMystere = Color(0xFF33E6FF)

/** Couleur du néon allumé de chaque carré, dans l'ordre (rose, cyan, or, violet), comme sur la maquette v2. */
private val TEINTES_REBUS = listOf(Color(0xFFFF3FA4), Color(0xFF33E6FF), Color(0xFFFFD23F), Color(0xFFB56BFF))
private val OrMeche = Color(0xFFFFD23F)
private val RoseCadre = Color(0xFFFF3FA4)

/**
 * Un carré du rébus, en enseigne de jeu télé (maquette v2 du 1/11, cedric : « du néon, des animations, à la hauteur de tout
 * le reste »). CACHEE : enseigne néon éteinte (tube gris, verre, « ? » en creux), ampoules éteintes. PROCHAINE : les ampoules
 * tournent de plus en plus vite au fil de [meche] (0 à 1), le « ? » s'allume en cyan, puis toutes clignotent ensemble juste
 * avant. VUE : le néon grésille et s'allume, un laser traverse le cadre, la photo sort de la lumière (ouverture en cercle,
 * zoom, blanc qui s'efface), des rayons tournent derrière, deux ondes et des étincelles partent ; sans animation si le
 * morceau était déjà là à l'ouverture de l'écran ([arrivee] faux). [teinte] : la couleur du néon allumé de ce carré.
 */
@Composable
internal fun CaseRebus(carte: MimeCard, photo: ImageBitmap?, etat: EtatCase, meche: Float, arrivee: Boolean, cote: Dp, teinte: Color) {
    val rayon = cote * 0.09f
    // Temps de l'arrivée, de 0 à ARRIVEE_MS ; déjà là à l'ouverture de l'écran : posée d'emblée.
    val t = remember { Animatable(if (etat == EtatCase.VUE && !arrivee) ARRIVEE_MS.toFloat() else 0f) }
    LaunchedEffect(etat) {
        if (etat == EtatCase.VUE && t.value < ARRIVEE_MS) t.animateTo(ARRIVEE_MS.toFloat(), tween((ARRIVEE_MS - t.value).toInt(), easing = LinearEasing))
    }
    val boucle = rememberInfiniteTransition(label = "enseigne")
    val souffle by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(1000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "souffle")
    val balaye by boucle.animateFloat(-1f, 1.6f, infiniteRepeatable(tween(4500, easing = LinearEasing), RepeatMode.Restart), label = "balaye")
    val clignote by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(280, easing = LinearEasing), RepeatMode.Restart), label = "clignote")
    val ms = t.value
    val vue = etat == EtatCase.VUE
    // Le tube : éteint, puis il grésille (allumé / éteint) avant de rester allumé.
    val tubeAllume = vue && neonAllume(ms)
    // Ampoules : éteintes ; la ronde du prochain carré (une sur quatre, qui accélère) ; toutes allumées une fois l'image là.
    val pasS = 12f
    val ronde = (pasS * (3f * meche + 10f * meche * meche * meche)).toInt()
    val ampoules: (Int) -> Boolean = when {
        vue -> { _ -> true }
        etat == EtatCase.PROCHAINE && meche > 0.88f -> { _ -> clignote < 0.5f }
        etat == EtatCase.PROCHAINE -> { j -> (j + ronde) % 4 == 0 }
        else -> { _ -> false }
    }
    val proche = etat == EtatCase.PROCHAINE && meche > 0.55f
    // La « pose » : le carré se tasse un peu puis rebondit quand l'image sort.
    val pose = segment(ms, 500f, 1200f).let { if (it <= 0f || it >= 1f) 1f else 1f - 0.08f * sin(it * Math.PI.toFloat()) * (1f - it) * 2f }
    Box(
        Modifier.size(cote).graphicsLayer { scaleX = pose; scaleY = pose }
            .drawBehind { rayonsArrivee(segment(ms, 500f, 2300f), teinte) },
        contentAlignment = Alignment.Center,
    ) {
        val r = rayon
        // Verre, « ? », photo : à l'intérieur du tube.
        Box(Modifier.size(cote).padding(cote * 0.03f).clip(RoundedCornerShape(r)), contentAlignment = Alignment.Center) {
            VerreEnseigne(balaye)
            if (!vue || ms < 700f) PointMystere(cote, proche, souffle, alpha = if (vue) 1f - segment(ms, 450f, 700f) else 1f)
            if (vue) MorceauQuiSort(carte, photo, cote, ms)
        }
        // Le tube néon, les ampoules, le laser, l'éclair, les ondes, les étincelles : par-dessus.
        Box(
            Modifier.size(cote).drawWithContent {
                drawContent()
                val rp = r.toPx()
                val trait = cote.toPx() * 0.03f
                if (tubeAllume) {
                    drawRoundRect(teinte.copy(alpha = 0.18f), Offset(-trait * 2, -trait * 2), Size(size.width + trait * 4, size.height + trait * 4), CornerRadius(rp + trait * 2), style = Stroke(trait * 3.5f))
                    drawRoundRect(teinte.copy(alpha = 0.45f), Offset(-trait * 0.6f, -trait * 0.6f), Size(size.width + trait * 1.2f, size.height + trait * 1.2f), CornerRadius(rp), style = Stroke(trait * 2f))
                    drawRoundRect(teinte, cornerRadius = CornerRadius(rp), style = Stroke(trait))
                    drawRoundRect(Color.White.copy(alpha = 0.75f), cornerRadius = CornerRadius(rp), style = Stroke(trait * 0.35f))
                } else {
                    drawRoundRect(Color(0xFF3A3358), cornerRadius = CornerRadius(rp), style = Stroke(trait))
                    drawRoundRect(Color.White.copy(alpha = 0.08f), Offset(trait * 0.3f, trait * 0.3f), Size(size.width - trait * 0.6f, size.height - trait * 0.6f), CornerRadius(rp), style = Stroke(trait * 0.25f))
                }
                dessineAmpoules(ampoules)
                if (vue) {
                    laser(segment(ms, 450f, 1050f))
                    eclair(segment(ms, 500f, 1300f))
                    onde(segment(ms, 650f, 1650f), rp, teinte)
                    onde(segment(ms, 850f, 1850f), rp, teinte)
                    etincelles(segment(ms, 600f, 1700f), teinte)
                }
            },
        )
    }
}

/** Durée de l'arrivée d'une image, de l'allumage du néon aux dernières étincelles. */
private const val ARRIVEE_MS = 2_300

/** Avancement de 0 à 1 entre [debut] et [fin] (ms), bloqué aux bords. */
private fun segment(ms: Float, debut: Float, fin: Float): Float = ((ms - debut) / (fin - debut)).coerceIn(0f, 1f)

/** Le néon qui grésille : allumé, éteint, allumé, éteint… puis allumé pour de bon après 550 ms (comme un vrai tube). */
internal fun neonAllume(ms: Float): Boolean = when {
    ms < 66f -> true
    ms < 121f -> false
    ms < 165f -> true
    ms < 247f -> false
    ms < 302f -> true
    ms < 385f -> false
    else -> true
}

/** 24 ampoules de jeu télé tout autour du cadre, un peu en dehors ; [allumee](j) pour chacune. */
private fun DrawScope.dessineAmpoules(allumee: (Int) -> Boolean) {
    val nb = 24
    val par = nb / 4
    val d = size.width * 0.045f
    for (j in 0 until nb) {
        val cote = j / par
        val f = (j % par).toFloat() / par
        val (x, y) = when (cote) { 0 -> f to 0f; 1 -> 1f to f; 2 -> 1f - f to 1f; else -> 0f to 1f - f }
        val c = Offset(-size.width * 0.04f + x * size.width * 1.08f, -size.height * 0.04f + y * size.height * 1.08f)
        if (allumee(j)) {
            drawCircle(Color(0x55FFB000), radius = d * 1.25f, center = c)
            drawCircle(Color(0xAAFFD23F), radius = d * 0.8f, center = c)
            drawCircle(Color(0xFFFFF6C8), radius = d * 0.5f, center = c)
        } else {
            drawCircle(Color(0xFF4A3A1C), radius = d * 0.5f, center = c)
        }
    }
}

/** Le laser : un trait blanc à halo rose qui traverse le cadre de gauche à droite ([p] de 0 à 1). */
private fun DrawScope.laser(p: Float) {
    if (p <= 0f || p >= 1f) return
    val a = if (p < 0.1f) p / 0.1f else if (p > 0.9f) (1f - p) / 0.1f else 1f
    val x = -size.width * 0.08f + size.width * 1.16f * p
    val haut = -size.height * 0.12f
    val bas = size.height * 1.12f
    drawLine(RoseCadre.copy(alpha = 0.25f * a), Offset(x, haut), Offset(x, bas), strokeWidth = size.width * 0.08f, cap = StrokeCap.Round)
    drawLine(RoseCadre.copy(alpha = 0.6f * a), Offset(x, haut), Offset(x, bas), strokeWidth = size.width * 0.025f, cap = StrokeCap.Round)
    drawLine(Color.White.copy(alpha = a), Offset(x, haut), Offset(x, bas), strokeWidth = size.width * 0.008f, cap = StrokeCap.Round)
}

/** L'éclair blanc au centre au moment où la photo sort ([p] de 0 à 1). */
private fun DrawScope.eclair(p: Float) {
    if (p <= 0f || p >= 1f) return
    val a = if (p < 0.2f) p / 0.2f else 1f - (p - 0.2f) / 0.8f
    val r = size.minDimension * (0.35f + 0.6f * p)
    drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = a), Color.White.copy(alpha = 0.5f * a), RoseCadre.copy(alpha = 0.4f * a), Color.Transparent), center, r), radius = r)
}

/** Une onde : le cadre lumineux qui s'agrandit et s'efface ([p] de 0 à 1). */
private fun DrawScope.onde(p: Float, r: Float, teinte: Color) {
    if (p <= 0f || p >= 1f) return
    val s = 1f + 0.6f * p
    val w = size.width * s
    val h = size.height * s
    drawRoundRect(teinte.copy(alpha = (1f - p) * 0.35f), Offset((size.width - w) / 2, (size.height - h) / 2), Size(w, h), CornerRadius(r * s), style = Stroke(size.width * 0.05f))
    drawRoundRect(teinte.copy(alpha = 1f - p), Offset((size.width - w) / 2, (size.height - h) / 2), Size(w, h), CornerRadius(r * s), style = Stroke(size.width * 0.018f))
}

/** Seize étincelles qui jaillissent du centre puis retombent un peu ([p] de 0 à 1). */
private fun DrawScope.etincelles(p: Float, teinte: Color) {
    if (p <= 0f || p >= 1f) return
    val va = 1f - (1f - p) * (1f - p) * (1f - p)
    val a = if (p < 0.7f) 1f else (1f - p) / 0.3f
    for (j in 0 until 16) {
        val ang = j / 16f * 6.2832f
        val d = size.minDimension * (0.48f + (j % 4) * 0.12f) * va
        val c = center + Offset(cos(ang) * d, sin(ang) * d + size.height * 0.14f * p * p)
        val couleur = if (j % 2 == 0) OrMeche else teinte
        drawCircle(couleur.copy(alpha = 0.45f * a), radius = size.width * 0.03f * (1f - 0.6f * p), center = c)
        drawCircle(Color.White.copy(alpha = a), radius = size.width * 0.012f * (1f - 0.6f * p), center = c)
    }
}

/** Les rayons qui tournent derrière le carré pendant l'arrivée ([p] de 0 à 1). */
private fun DrawScope.rayonsArrivee(p: Float, teinte: Color) {
    if (p <= 0f || p >= 1f) return
    val a = if (p < 0.25f) p / 0.25f else 1f - (p - 0.25f) / 0.75f
    val r = size.minDimension * (0.55f + 0.55f * p)
    val rot = 60f * p
    val pinceau = Brush.radialGradient(listOf(teinte.copy(alpha = 0.55f * a), teinte.copy(alpha = 0.25f * a), Color.Transparent), center, r)
    for (j in 0 until 20) {
        val debut = j * 18f + rot
        drawArc(pinceau, debut, 6f, useCenter = true, topLeft = center - Offset(r, r), size = Size(r * 2, r * 2))
    }
}

/** Le verre de l'enseigne : sombre, une pointe de rose, un reflet qui passe lentement en diagonale. */
@Composable
private fun VerreEnseigne(balaye: Float) {
    Box(
        Modifier.fillMaxSize()
            .background(Brush.linearGradient(listOf(Color(0x1AFFFFFF), Color(0x08FFFFFF), Color(0x14FF3FA4))))
            .drawBehind {
                val x = size.width * balaye
                drawRect(
                    Brush.linearGradient(
                        listOf(Color.Transparent, Color.White.copy(alpha = 0.09f), Color.Transparent),
                        start = Offset(x - size.width * 0.25f, 0f), end = Offset(x + size.width * 0.05f, size.height),
                    ),
                )
            },
    )
}

/** Le « ? » : en creux (tube éteint) puis allumé en cyan qui respire quand l'image approche. */
@Composable
private fun PointMystere(cote: Dp, proche: Boolean, souffle: Float, alpha: Float) {
    val taille = with(LocalDensity.current) { (cote * 0.42f).toSp() }
    val trait = with(LocalDensity.current) { (cote * 0.012f).toPx() }
    Text(
        "?", fontFamily = PoliceGsTitre, fontSize = taille,
        color = if (proche) CyanMystere else Color(0xFF4B4470),
        style = if (proche) TextStyle(shadow = Shadow(CyanMystere, blurRadius = 28f))
        else TextStyle(drawStyle = androidx.compose.ui.graphics.drawscope.Stroke(width = trait)),
        modifier = Modifier.graphicsLayer {
            this.alpha = alpha
            val s = if (proche) 1f + 0.08f * souffle else 1f
            scaleX = s; scaleY = s
        },
    )
}

/**
 * Le morceau qui sort de la lumière : ouverture en cercle depuis le centre (550 → 1250 ms), zoom de 1,35 à 1 (→ 1950 ms),
 * voile blanc qui s'efface (→ 1550 ms). Photo, émoji sur carte blanche, ou lettre / chiffre en néon cyan.
 */
@Composable
private fun MorceauQuiSort(carte: MimeCard, photo: ImageBitmap?, cote: Dp, ms: Float) {
    val iris = segment(ms, 550f, 1250f).let { 1f - (1f - it) * (1f - it) * (1f - it) }
    val zoom = 1.35f - 0.35f * segment(ms, 550f, 1950f).let { 1f - (1f - it) * (1f - it) * (1f - it) }
    val voile = 1f - segment(ms, 550f, 1550f)
    val lettre = estLettre(carte)
    val densite = LocalDensity.current
    Box(
        Modifier.fillMaxSize().drawWithContent {
            val chemin = Path().apply { addOval(androidx.compose.ui.geometry.Rect(center, size.maxDimension * 0.75f * iris)) }
            clipPath(chemin) {
                drawContent()
                if (voile > 0f) drawRect(Color.White.copy(alpha = voile))
            }
        }.background(if (lettre) Color(0xFF140B2E) else Color.White),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom }, contentAlignment = Alignment.Center) {
            when {
                photo != null -> Image(photo, contentDescription = carte.word, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                !carte.image.isNullOrBlank() -> Text(carte.image!!, fontSize = with(densite) { (cote * 0.56f).toSp() })
                lettre -> Text(
                    carte.word.uppercase(), color = Color.White, fontFamily = PoliceGsTitre, maxLines = 1,
                    fontSize = with(densite) { (cote * if (carte.word.length <= 1) 0.58f else if (carte.word.length == 2) 0.42f else 0.28f).toSp() },
                    style = TextStyle(shadow = Shadow(CyanMystere, blurRadius = 30f)),
                )
                // Photo pas encore arrivée sur la box : le mot écrit, jamais un carré vide.
                else -> Text(carte.word, color = GS.Nuit, fontSize = with(densite) { (cote * 0.16f).toSp() }, fontWeight = FontWeight.Black, textAlign = TextAlign.Center)
            }
        }
    }
}

/**
 * À la révélation : ce que le morceau fait entendre (« PAIN »), en cyan détaché du décor par un halo sombre ; il rapetisse
 * pour tenir sous son carré, même à six morceaux et huit équipes, jamais coupé.
 */
@Composable
private fun SonDuMorceau(son: String, modifier: Modifier = Modifier) {
    androidx.compose.runtime.CompositionLocalProvider(
        androidx.compose.material3.LocalTextStyle provides TextStyle(fontFamily = PoliceGsTitre, shadow = Shadow(Color.Black, blurRadius = 22f)),
    ) {
        TexteAjuste(son.uppercase(), color = Color(0xFF8CF9FF), max = 26.sp, min = 11.sp, lignes = 1, fontWeight = FontWeight.Normal, modifier = modifier)
    }
}

/** Taille d'un carré : la plus grande qui laisse tous les morceaux sur une ligne (utile aux tests). */
internal fun coteRebus(largeur: Float, hauteur: Float, n: Int, ecart: Float, sous: Float): Float =
    min(min((largeur - ecart * (n - 1)) / n, hauteur - sous - 12f), 230f).coerceAtLeast(40f)
