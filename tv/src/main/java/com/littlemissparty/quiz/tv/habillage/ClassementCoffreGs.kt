package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.tv.UneLigneQuiTient
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.littlemissparty.quiz.tv.TexteAjuste
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin

/*
 * Coffres mystères, Game Show : le classement après chaque coffre, version A choisie par cedric le 29/10 (« plus néon,
 * plus rigolo, plus festif »). Des cartes néon sur fond noir, une par équipe ; l'équipe qui vient d'ouvrir un coffre voit
 * son score compter, puis passe PAR-DESSUS les autres jusqu'à sa nouvelle place ; couronne sur le n°1, autocollant
 * « NOUVEAU N°1 ! », « +2 PLACES ! », « AÏE ! »… et confettis quand elle monte. 4 s (CHEST_RANKING_MS dans la partie).
 * Tout est dessiné en direct (aucune image) ; l'animation ne lit l'horloge que dans les couches graphiques.
 * Mesures de la planche (…/propositions-29-octobre/coffres-classement/a-livrer/LISEZMOI.md) divisées par 2 : 960 × 540 dp.
 */

/** Durée du classement A (la partie lui laisse CHEST_RANKING_MS = 4 s). */
const val CLASSEMENT_COFFRE_GS_MS = 3_950L

/** Les instants du classement A, en secondes. */
internal object TempsClassementA {
    const val COMPTE = 0.4f
    const val BOUGE = 1.4f
    const val NOUVEAUX_RANGS = 1.9f
    const val FETE = 2.35f
}

/** Pas d'une ligne (dp), taille relative [f] et haut de la liste (dp) pour [n] équipes : la liste est centrée entre 95 et 495 dp. */
/**
 * Rond du rang (dp à l'échelle 1) et son anneau de lueur : un peu de marge au-dessus et en dessous dans la carte
 * (cedric, 30/10 : le rond 1, 2, 3… touchait le cadre, « ça demande à respirer un tout petit peu »).
 */
internal const val PASTILLE_RANG_A = 30f
internal const val ANNEAU_RANG_A = 3.5f
/** Marge libre (dp à l'échelle 1) entre l'anneau du rang et le bord de la carte, en haut comme en bas. */
internal fun margeRangA(g: GeometrieClassementA): Float = (g.hauteurCarte - (PASTILLE_RANG_A + 2 * ANNEAU_RANG_A) * g.f) / 2f

/** Instant (s, temps du classement) où la carte [i] a fini d'arriver depuis la gauche (apparition en 0,3 s, décalées de 0,05 s). */
internal fun arriveeCarteA(i: Int): Float = 0.35f + i * 0.05f

internal data class GeometrieClassementA(val pas: Float, val f: Float, val haut: Float) {
    val hauteurCarte get() = pas - 7f * f
}

internal fun geometrieClassementA(n: Int): GeometrieClassementA {
    val k = n.coerceAtLeast(1)
    val pas = minOf(56f, 400f / k)
    return GeometrieClassementA(pas, pas / 56f, 95f + (400f - pas * k) / 2f)
}

/** L'autocollant de l'équipe qui a ouvert le coffre, et s'il est rose (elle descend). */
internal fun autocollantClassementA(evo: Evolution, equipes: Int): Pair<String, Boolean> = when {
    equipes <= 1 -> "BIEN JOUÉ !" to false
    evo.recit == Recit.NOUVEAU_PREMIER -> "NOUVEAU N°1 !" to false
    evo.places > 0 -> "+${evo.places} PLACE${if (evo.places > 1) "S" else ""} !" to false
    evo.places < 0 -> "AÏE !" to true
    evo.rangApres == 0 -> "TOUJOURS N°1 !" to false
    else -> "GARDE SA PLACE" to false
}

private fun borne(x: Float) = x.coerceIn(0f, 1f)
private fun lisseA(x: Float) = borne(x).let { it * it * (3 - 2 * it) }
/** Ressort qui dépasse un peu, puis se pose. */
internal fun rebondA(x: Float): Float = borne(x).let { if (it >= 1f) 1f else 1f - 2f.pow(-9f * it) * cos(it * 9.5f) }
/** Gonfle jusqu'à × 1,25 puis revient à × 1. */
private fun gonfleA(x: Float) = borne(x).let { if (it < 0.6f) 1.25f * lisseA(it / 0.6f) else 1.25f - 0.25f * lisseA((it - 0.6f) / 0.4f) }

private val NuitA = Color(0xFF05010D)
private val EncreA = Color(0xFFF4F1FF)
private val CyanA = Color(0xFF00F0FF)
private val JauneA = Color(0xFFFFE600)
private val RoseA = Color(0xFFFF2D95)
private val VertA = Color(0xFF39FF14)
private val RougeA = Color(0xFFFF3B5C)

private val jouerSonClassement: (Son) -> Unit = { Sons.executer(listOf(Ordre.Jouer(it))) }

/**
 * Le classement A entre deux coffres. [lignes] : scores et rangs calculés par la partie ; [joue] : l'index (dans [lignes])
 * de l'équipe qui a ouvert le coffre (−1 si elle n'est plus là : les lignes s'affichent sans animation de jeu).
 */
@Composable
fun ClassementCoffreGs(lignes: List<LigneClassement>, joue: Int, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSonClassement) {
    val evo = remember(lignes) { evolutions(lignes) }
    val ej = evo.getOrNull(joue)
    val renverse = ej?.recit == Recit.NOUVEAU_PREMIER
    val monte = ej != null && ej.places > 0
    val bouge = evo.any { it.rangAvant != it.rangApres }
    val t = remember(lignes) { Animatable(0f) }
    val sonne by rememberUpdatedState(jouer)
    LaunchedEffect(lignes) {
        sonne(Son.WHOOSH)
        t.animateTo(TempsClassementA.COMPTE, tween((TempsClassementA.COMPTE * 1000).toInt(), easing = LinearEasing))
        sonne(Son.COMPTEUR)
        t.animateTo(TempsClassementA.BOUGE, tween(((TempsClassementA.BOUGE - TempsClassementA.COMPTE) * 1000).toInt(), easing = LinearEasing))
        if (bouge) sonne(Son.WHOOSH)
        t.animateTo(TempsClassementA.FETE, tween(((TempsClassementA.FETE - TempsClassementA.BOUGE) * 1000).toInt(), easing = LinearEasing))
        if (renverse) sonne(Son.PORTES_RENVERSEMENT) else if (monte) sonne(Son.pop(0))
        val fin = CLASSEMENT_COFFRE_GS_MS / 1000f
        t.animateTo(fin, tween(((fin - TempsClassementA.FETE) * 1000).toInt(), easing = LinearEasing))
    }
    val g = geometrieClassementA(lignes.size)
    val x0 = 110f
    val largeur = 560f
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        // Le plateau reste derrière, sous un voile plus sombre sur les bords.
        Box(
            Modifier.fillMaxSize().clearAndSetSemantics {}.drawBehind {
                drawRect(
                    Brush.radialGradient(
                        listOf(NuitA.copy(alpha = 0.62f), NuitA.copy(alpha = 0.86f)),
                        center = Offset(size.width * 0.5f, size.height * 0.55f), radius = size.width * 0.62f,
                    ),
                )
            },
        )
        TitreClassementA { t.value }
        lignes.forEachIndexed { i, l -> CarteClassementA(l, evo[i], i, i == joue, g, x0, largeur) { t.value } }
        if (ej != null) {
            AutocollantA(ej, lignes.size, x0 + largeur + AUTOCOLLANT_ECART_DP, g.haut + ej.rangApres * g.pas + g.pas / 2f) { t.value }
            if (renverse) {
                val exPremier = evo.indexOfFirst { it.rangAvant == 0 }
                if (exPremier >= 0) DetroneA(x0 + largeur + AUTOCOLLANT_ECART_DP, g.haut + evo[exPremier].rangApres * g.pas + g.pas / 2f) { t.value }
            }
            if (renverse || monte) {
                val source = Offset(x0 + largeur / 2f, g.haut + ej.rangApres * g.pas + g.pas / 2f)
                ConfettisA(source, lignes[joue].couleur) { t.value }
            }
        }
    }
}

@Composable
private fun TitreClassementA(t: () -> Float) {
    val style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 32.sp, letterSpacing = 0.04.em, color = Color.White, textAlign = TextAlign.Center)
    Box(
        Modifier.fillMaxWidth().padding(top = 23.dp).graphicsLayer { translationY = (1f - rebondA(t() / 0.5f)) * -80f * density },
        contentAlignment = Alignment.TopCenter,
    ) {
        Text("LE CLASSEMENT", maxLines = 1, softWrap = false, style = style.copy(color = Color.Transparent, shadow = Shadow(CyanA, Offset.Zero, 60f)))
        Text("LE CLASSEMENT", maxLines = 1, softWrap = false, style = style.copy(shadow = Shadow(CyanA, Offset.Zero, 22f)))
    }
}

@Composable
private fun CarteClassementA(
    e: LigneClassement, evo: Evolution, i: Int, joue: Boolean, g: GeometrieClassementA, x0: Float, largeur: Float, t: () -> Float,
) {
    val f = g.f
    val forme = RoundedCornerShape((13f * f).dp)
    val nouveauxRangs by remember(evo) { derivedStateOf { t() >= TempsClassementA.NOUVEAUX_RANGS } }
    val premierFete by remember(evo) { derivedStateOf { evo.rangApres == 0 && t() > TempsClassementA.FETE } }
    // Tant que la carte glisse depuis la gauche (ou attend, transparente, pendant l'ouverture du coffre), ses textes ne
    // sont pas encore à l'écran : ils n'y entrent qu'une fois la carte arrivée à sa place.
    val arrivee by remember(evo) { derivedStateOf { t() >= arriveeCarteA(i) } }
    Box(
        Modifier
            .zIndex(if (joue) 5f else 1f)
            .offset(x = x0.dp, y = g.haut.dp)
            .size(largeur.dp, g.hauteurCarte.dp)
            .graphicsLayer {
                val s = t()
                val b = borne((s - TempsClassementA.BOUGE) / 1f)
                // L'équipe qui joue passe par-dessus les autres en arc ; les autres s'écartent avec un rebond, un peu après.
                val u = if (joue) lisseA(b) else rebondA((s - TempsClassementA.BOUGE - 0.25f) / 0.9f)
                val rang = evo.rangAvant + (evo.rangApres - evo.rangAvant) * u
                val arc = if (joue) sin(PI.toFloat() * b) else 0f
                val app = lisseA((s - arriveeCarteA(i) + 0.3f) / 0.3f)
                val boing = if (joue && s > TempsClassementA.FETE) 0.03f * sin((s - TempsClassementA.FETE) * 10f) * exp(-(s - TempsClassementA.FETE) * 2f) else 0f
                translationX = (arc * 35f + (1f - app) * -150f) * density
                translationY = rang * g.pas * density
                scaleX = 1f + arc * 0.07f + boing
                scaleY = scaleX
                alpha = app
            }
            .drawBehind {
                val s = t()
                // La lueur néon de la carte : plus forte et qui « respire » pour l'équipe qui joue pendant que son score compte.
                val brille = when {
                    joue -> 1.4f + 0.6f * sin(s * 14f) * borne((s - TempsClassementA.COMPTE) * 3f) * (1f - borne((s - TempsClassementA.FETE) * 2f))
                    evo.rangApres == 0 && s > TempsClassementA.FETE -> 1.2f
                    else -> 0.8f
                }
                val coin = CornerRadius(13f * f * density)
                drawRoundRect(e.couleur.copy(alpha = (0.22f * brille).coerceAtMost(0.6f)), cornerRadius = coin, style = Stroke(9f * f * brille * density))
                drawRoundRect(e.couleur.copy(alpha = (0.45f * brille).coerceAtMost(0.9f)), cornerRadius = coin, style = Stroke(5f * f * density))
            }
            .background(NuitA.copy(alpha = 0.88f), forme)
            .drawBehind {
                // Lueur intérieure.
                val coin = CornerRadius(13f * f * density)
                drawRoundRect(e.couleur.copy(alpha = 0.25f), topLeft = Offset(2f * f * density, 2f * f * density),
                    size = Size(size.width - 4f * f * density, size.height - 4f * f * density), cornerRadius = coin, style = Stroke(5f * f * density))
            }
            .border((2f * f).dp, e.couleur, forme)
            .then(if (arrivee) Modifier.semantics { contentDescription = "${e.nom} : ${evo.rangApres + 1}" } else Modifier.clearAndSetSemantics { }),
    ) {
        Row(
            Modifier.fillMaxSize().padding(start = (9f * f).dp, end = (17f * f).dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy((11f * f).dp),
        ) {
            Box(
                Modifier.size((PASTILLE_RANG_A * f).dp).drawBehind { drawCircle(e.couleur.copy(alpha = 0.45f), radius = size.minDimension / 2f + ANNEAU_RANG_A * f * density) }
                    .background(e.couleur, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "${(if (nouveauxRangs) evo.rangApres else evo.rangAvant) + 1}", maxLines = 1, softWrap = false,
                    style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = (17f * f).sp, color = NuitA),
                )
            }
            // Le nom prend toute la place libre et rétrécit plutôt que d'être coupé (règle de l'appli).
            CompositionLocalProvider(LocalTextStyle provides TextStyle(fontFamily = PoliceGsTexte)) {
                TexteAjuste(
                    e.nom, EncreA, max = (30f * f).sp, min = (12f * f).sp, lignes = 1, fontWeight = FontWeight.Bold, textAlign = TextAlign.Start,
                    modifier = Modifier.weight(1f),
                )
            }
            val score by remember(e) { derivedStateOf { valeurCompteur(e.avant, e.apres, (t() - TempsClassementA.COMPTE) / 0.9f) } }
            Text(
                espaceMilliers(score), maxLines = 1, softWrap = false, textAlign = TextAlign.End,
                style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = (25f * f).sp, color = EncreA),
                modifier = Modifier.widthIn(min = (70f * f).dp),
            )
        }
        if (joue) PastilleGainA(e.apres - e.avant, f, Modifier.align(Alignment.CenterEnd), t)
        if (premierFete) CouronneA(f, Modifier.align(Alignment.TopStart), t)
    }
}

/** Le gain (ou le malus) de l'équipe qui joue, à droite de sa carte : il gonfle, penche et se balance, puis s'en va. */
@Composable
private fun PastilleGainA(gain: Int, f: Float, modifier: Modifier, t: () -> Float) {
    val fond = if (gain < 0) RougeA else VertA
    Box(
        modifier.offset(x = (85f * f).dp)
            .graphicsLayer {
                val s = t()
                val p = gonfleA((s - 0.25f) / 0.4f)
                scaleX = p; scaleY = p
                rotationZ = -6f + 3f * sin(s * 8f)
                alpha = borne(p * 3f) * (1f - borne((s - TempsClassementA.FETE - 0.3f) * 3f))
            }
            .drawBehind { drawRoundRect(fond.copy(alpha = 0.45f), topLeft = Offset(-6f * density, -6f * density), size = Size(size.width + 12f * density, size.height + 12f * density), cornerRadius = CornerRadius(size.height)) }
            .background(fond, RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 2.dp),
    ) {
        Text(
            if (gain < 0) "−${-gain}" else "+$gain", maxLines = 1, softWrap = false,
            style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = (22f * f).sp, color = if (gain < 0) Color.White else Color(0xFF031A00)),
        )
    }
}

/** La couronne du n°1, qui tombe sur le coin gauche de sa carte avec un rebond. */
@Composable
private fun CouronneA(f: Float, modifier: Modifier, t: () -> Float) {
    Canvas(
        modifier.offset(x = (1f * f).dp, y = (-27f * f).dp).size((35f * f).dp, (26f * f).dp)
            .graphicsLayer {
                val s = t() - TempsClassementA.FETE
                translationY = (1f - rebondA(s / 0.6f)) * -60f * density
                rotationZ = -14f
                alpha = borne(s * 5f)
            },
    ) {
        val k = size.width / 40f
        scale(k, k, Offset.Zero) {
            val p = Path().apply {
                moveTo(3f, 26f); lineTo(1f, 7f); lineTo(12f, 15f); lineTo(20f, 2f); lineTo(28f, 15f); lineTo(39f, 7f); lineTo(37f, 26f); close()
            }
            drawPath(p, JauneA)
            drawPath(p, NuitA, style = Stroke(2.5f))
            drawCircle(RoseA, 3f, Offset(20f, 18f))
        }
    }
}

/**
 * Place de l'autocollant à droite des cartes (x0 110 + largeur 560) : au plus [AUTOCOLLANT_MAX_DP] de large, même au
 * plus fort du ressort (× 1,16), il reste dans l'écran de 960 (tour des écrans à 3 équipes, 31/10 : « GARDE SA PLACE »
 * touchait le bord).
 */
internal const val AUTOCOLLANT_ECART_DP = 12f
internal const val AUTOCOLLANT_MAX_DP = 235f

/** Le gros autocollant de l'équipe qui joue, à droite de sa nouvelle ligne : il arrive en ressort et se balance. */
@Composable
private fun AutocollantA(evo: Evolution, equipes: Int, x: Float, centreY: Float, t: () -> Float) {
    val visible by remember(evo) { derivedStateOf { t() > TempsClassementA.FETE } }
    if (!visible) return
    val (texte, rose) = autocollantClassementA(evo, equipes)
    val fond = if (rose) RoseA else JauneA
    Box(
        Modifier.offset(x = x.dp, y = (centreY - 20f).coerceIn(4f, 496f).dp)
            .graphicsLayer {
                val s = t() - TempsClassementA.FETE
                val k = rebondA(s / 0.55f)
                scaleX = k; scaleY = k
                rotationZ = -8f + 2.5f * sin(s * 7f)
                transformOrigin = TransformOrigin(0f, 0.5f)
            }
            .drawBehind { drawRoundRect(fond.copy(alpha = 0.35f), topLeft = Offset(-10f * density, -10f * density), size = Size(size.width + 20f * density, size.height + 20f * density), cornerRadius = CornerRadius(16f * density)) }
            .border(2.dp, fond, RoundedCornerShape(11.dp))
            .padding(2.dp)
            .border(2.5.dp, NuitA, RoundedCornerShape(10.dp))
            .padding(2.5.dp)
            .background(fond, RoundedCornerShape(8.dp))
            .padding(start = 13.dp, end = 13.dp, top = 5.dp, bottom = 3.dp)
            .widthIn(max = (AUTOCOLLANT_MAX_DP - 2f * (2f + 2.5f + 13f)).dp),
    ) {
        UneLigneQuiTient(echelleMin = 0.7f) {
            Text(texte, maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 23.sp, color = if (rose) Color.White else NuitA))
        }
    }
}

/** Le petit « détrôné ! » à droite de l'ancienne n°1, 0,35 s après l'autocollant. */
@Composable
private fun DetroneA(x: Float, centreY: Float, t: () -> Float) {
    val visible by remember { derivedStateOf { t() > TempsClassementA.FETE + 0.35f } }
    if (!visible) return
    Box(
        Modifier.offset(x = x.dp, y = (centreY - 13f).coerceIn(4f, 510f).dp)
            .graphicsLayer {
                val k = rebondA((t() - TempsClassementA.FETE - 0.35f) / 0.5f)
                scaleX = k; scaleY = k
                rotationZ = 5f
                transformOrigin = TransformOrigin(0f, 0.5f)
            }
            .drawBehind { drawRoundRect(RougeA.copy(alpha = 0.4f), topLeft = Offset(-5f * density, -5f * density), size = Size(size.width + 10f * density, size.height + 10f * density), cornerRadius = CornerRadius(size.height)) }
            .background(NuitA.copy(alpha = 0.9f), RoundedCornerShape(50))
            .border(1.5.dp, RougeA, RoundedCornerShape(50))
            .padding(start = 9.dp, end = 9.dp, top = 3.dp, bottom = 1.dp),
    ) {
        Text("détrôné !", maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 15.sp, color = Color.White))
    }
}

/** Un confetti : direction, vitesse (dp/s), couleur, rotation, taille (dp) et départ, tirés une fois (graine fixe). */
private class ConfettiA(val angle: Float, val vitesse: Float, val couleur: Color, val rotation: Float, val taille: Float, val depart: Float)

/** 160 confettis qui partent de la carte de l'équipe qui joue, seulement quand elle monte ou prend la tête. */
@Composable
private fun ConfettisA(source: Offset, couleurEquipe: Color, t: () -> Float) {
    val confettis = remember(couleurEquipe) {
        var graine = 7L
        fun hasard(): Float { graine = graine * 16807L % 2147483647L; return graine / 2147483647f }
        val couleurs = listOf(couleurEquipe, JauneA, Color.White, CyanA, RoseA)
        List(160) {
            ConfettiA(
                angle = -PI.toFloat() / 2f + (hasard() - 0.5f) * 2.6f, vitesse = 350f + hasard() * 450f,
                couleur = couleurs[(hasard() * 5).toInt().coerceAtMost(4)], rotation = hasard() * 6f, taille = 5f + hasard() * 5f, depart = hasard() * 0.15f,
            )
        }
    }
    Canvas(Modifier.fillMaxSize().zIndex(10f)) {
        val u = t() - TempsClassementA.FETE
        if (u < 0f) return@Canvas
        val d = density
        for (p in confettis) {
            val s = u - p.depart
            if (s < 0f) continue
            val a = borne(1.6f - s * 0.6f)
            if (a <= 0f) continue
            val amorti = s * exp(-s * 0.8f)
            val x = (source.x + cos(p.angle) * p.vitesse * amorti) * d
            val y = (source.y + sin(p.angle) * p.vitesse * amorti + 260f * s * s) * d
            translate(x, y) {
                rotate((p.rotation + s * 9f) * 180f / PI.toFloat(), Offset.Zero) {
                    scale(1f, cos(s * 12f + p.rotation), Offset.Zero) {
                        drawRect(p.couleur, Offset(-p.taille * d / 2f, -p.taille * d / 4f), Size(p.taille * d, p.taille * d / 2f), alpha = a)
                    }
                }
            }
        }
    }
}
