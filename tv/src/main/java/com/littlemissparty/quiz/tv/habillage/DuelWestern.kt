package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Image
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.R
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/*
 * 🤠 Le Duel des robots, Game Show : ce que la TV écrit en direct par-dessus le film du western, d'après la maquette
 * validée par cedric le 27/10 (planche du duel, sources/ecran.html du design) : pastille en haut à gauche, annonce
 * « X contre Y » en lettre western néon (Rye), plaques d'équipe dans les coins, PAN en enseigne néon avec ses éclats et
 * ses étoiles de shérif, bandeau du résultat. Tout est placé sur une scène de 1920 × 1080, comme la maquette.
 */

/** Ce que la TV écrit sur le film du duel. */
class TextesDuel(
    /** La pastille du haut : « 🤠 LE DUEL DES ROBOTS · 2 / 8 ». */
    val pastille: String,
    /** Au-dessus des noms de l'annonce : « DUEL N° 2 ». */
    val annonce: String,
    /** La ligne d'aide en bas, entre les plaques (aucune : rien). */
    val consigne: String?,
    val resultat: ResultatDuel?,
)

/** Le bandeau du résultat : [haut] en petit (à la couleur [hautCouleur] s'il y en a une), [titre] en western néon. */
class ResultatDuel(val haut: String, val hautCouleur: Color?, val titre: String, val couleur: Color, val points: String?)

internal val SCENE_L = 1920.dp
internal val SCENE_H = 1080.dp
private val Creme = Color(0xFFFFE2B8)
private val NuitBandeau = Color(0xD60E061A)

/** Les textes du duel sur le film, à l'échelle de la scène de la maquette. */
@Composable
internal fun HabillageDuelWestern(equipes: List<EquipeDuel>, etape: EtapeDuel, gagnante: Int?, textes: TextesDuel, cle: Any?) {
    // Voile du bas : les plaques et la consigne se lisent sur n'importe quel plan.
    if (etape != EtapeDuel.PAN) Box(
        Modifier.fillMaxSize().clearAndSetSemantics {}.drawBehind {
            val h = size.height * 360f / 1080f
            drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color(0xD908020E)), startY = size.height - h, endY = size.height), topLeft = Offset(0f, size.height - h))
        },
    )
    // L'annonce assombrit le film autour des noms.
    if (etape == EtapeDuel.PRET) Box(
        Modifier.fillMaxSize().clearAndSetSemantics {}.background(Brush.radialGradient(listOf(Color(0x4008020E), Color(0xB308020E)))),
    )
    if (etape == EtapeDuel.PAN) VoilePan()
    EchelleSansCoupe(SCENE_L, SCENE_H, Modifier.fillMaxSize()) {
        Pastille(textes.pastille, Modifier.align(Alignment.TopStart).padding(start = 72.dp, top = 64.dp))
        when (etape) {
            EtapeDuel.PRET -> if (equipes.size == 2) Annonce(equipes, textes.annonce, cle)
            EtapeDuel.PAN -> PanWestern(cle)
            else -> {}
        }
        if (etape != EtapeDuel.PRET && equipes.size == 2) equipes.forEachIndexed { i, e ->
            PlaqueWestern(
                e, gagne = gagnante == i && etape in setOf(EtapeDuel.GAGNE, EtapeDuel.TROP_TOT),
                modifier = Modifier.align(if (i == 0) Alignment.BottomStart else Alignment.BottomEnd).padding(horizontal = 72.dp, vertical = 56.dp),
            )
        }
        textes.consigne?.let {
            Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 70.dp).widthIn(max = if (etape == EtapeDuel.PRET) 1700.dp else 560.dp)) {
                TexteNeon(it, GS.Orange, 46f, PoliceGsTexte, largeurMax = if (etape == EtapeDuel.PRET) 1700.dp else 560.dp, force = 0.5f, graisse = FontWeight.Bold)
            }
        }
        textes.resultat?.let { BandeauWestern(it, cle, Modifier.align(Alignment.TopCenter).padding(start = 140.dp, end = 140.dp, top = 150.dp)) }
    }
}

/**
 * Un texte néon : le cœur blanc, la lueur à la couleur [couleur] ([force] : 1 pour un grand titre), sur une seule ligne
 * réduite autant qu'il faut pour tenir dans [largeurMax] (jamais coupé).
 */
@Composable
internal fun TexteNeon(
    texte: String,
    couleur: Color,
    tailleMax: Float,
    police: FontFamily = PoliceGsWestern,
    largeurMax: Dp = 1700.dp,
    force: Float = 1f,
    tailleMin: Float = 24f,
    graisse: FontWeight = FontWeight.Normal,
    modifier: Modifier = Modifier,
) {
    val mesure = rememberTextMeasurer()
    val d = LocalDensity.current
    fun style(t: Float) = TextStyle(fontFamily = police, fontWeight = graisse, fontSize = t.sp, lineHeight = 1.15.em, textAlign = TextAlign.Center)
    val taille = remember(texte, largeurMax, police, d.density, d.fontScale) {
        val max = with(d) { largeurMax.toPx() }
        var t = tailleMax
        while (t > tailleMin && mesure.measure(texte, style(t), maxLines = 1, softWrap = false).size.width > max) t *= 0.94f
        t
    }
    // Lueurs de la maquette (pensées pour un texte de 150 px), à l'échelle du texte.
    val px = with(d) { 1.dp.toPx() } * taille / 150f
    Box(modifier, contentAlignment = Alignment.Center) {
        // Trois couches : la grande lueur, la lueur proche, le tube blanc qui brille.
        Text(texte, maxLines = 1, softWrap = false, overflow = TextOverflow.Clip, style = style(taille).copy(color = couleur, shadow = Shadow(couleur, Offset.Zero, 56f * px * force)))
        Text(texte, maxLines = 1, softWrap = false, overflow = TextOverflow.Clip, style = style(taille).copy(color = Color.White, shadow = Shadow(couleur, Offset.Zero, 24f * px * force)))
        Text(texte, maxLines = 1, softWrap = false, overflow = TextOverflow.Clip, style = style(taille).copy(color = Color.White, shadow = Shadow(Color.White.copy(alpha = 0.9f), Offset.Zero, 6f * px)))
    }
}

/** « 🤠 LE DUEL DES ROBOTS · 2 / 8 » : tube blanc et orange, en haut à gauche. */
@Composable
private fun Pastille(texte: String, modifier: Modifier) {
    Box(
        modifier
            .drawBehind { lueur(GS.Orange, 60.dp.toPx(), 3) }
            .background(Color(0x991E0A1E), RoundedCornerShape(60.dp))
            .border(4.dp, Color.White, RoundedCornerShape(60.dp))
            .padding(4.dp)
            .border(4.dp, Color(0xFFFF9A3A), RoundedCornerShape(60.dp))
            .padding(horizontal = 30.dp, vertical = 10.dp),
    ) {
        Text(
            texte, maxLines = 1, softWrap = false,
            style = TextStyle(
                fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = 28.sp, letterSpacing = 0.14.em,
                color = Color(0xFFFFF3E6), shadow = Shadow(Color(0xFFFF9A3A), Offset.Zero, 14f),
            ),
        )
    }
}

/** « DUEL N° 2 », puis les deux équipes en grand, « contre » entre les deux, et le joueur appelé sous chaque nom. */
@Composable
private fun BoxScope.Annonce(equipes: List<EquipeDuel>, annonce: String, cle: Any?) {
    Column(
        Modifier.align(Alignment.Center).padding(top = 30.dp).fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            annonce, maxLines = 1, softWrap = false, modifier = Modifier.apparition(0, cle),
            style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = 40.sp, letterSpacing = 0.3.em, color = Creme, shadow = Shadow(Color(0xFFFF8A3A), Offset.Zero, 24f)),
        )
        equipes.forEachIndexed { i, e ->
            if (i == 1) TexteNeon("contre", GS.Orange, 62f, largeurMax = 600.dp, force = 0.5f, modifier = Modifier.padding(vertical = 6.dp).apparition(350, cle))
            Column(Modifier.apparition(if (i == 0) 150L else 550L, cle), horizontalAlignment = Alignment.CenterHorizontally) {
                TexteNeon(e.nom.ifBlank { "Équipe" }, e.couleur, 150f, largeurMax = 1640.dp)
                Text(
                    "JOUEUR N° ${e.joueur}", maxLines = 1, softWrap = false,
                    style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 36.sp, letterSpacing = 0.12.em, color = Color.White, shadow = Shadow(e.couleur, Offset.Zero, 18f)),
                )
            }
        }
    }
}

/** Le nom de l'équipe et le joueur appelé, dans un coin, en néon à sa couleur. */
@Composable
private fun PlaqueWestern(e: EquipeDuel, gagne: Boolean, modifier: Modifier) {
    Column(
        modifier
            .drawBehind { lueur(e.couleur, 20.dp.toPx(), if (gagne) 4 else 2) }
            .background(Color(0xB80A0414), RoundedCornerShape(20.dp))
            .border(if (gagne) 6.dp else 4.dp, e.couleur, RoundedCornerShape(20.dp))
            .padding(horizontal = 30.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        TexteNeon(e.nom.ifBlank { "Équipe" }, e.couleur, 44f, PoliceGsTexte, largeurMax = 520.dp, force = 0.6f, graisse = FontWeight.Bold)
        Text("JOUEUR N° ${e.joueur}", maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 26.sp, letterSpacing = 0.1.em, color = Creme))
    }
}

/** Le voile du PAN : une lueur orange au centre, la nuit autour. */
@Composable
private fun VoilePan() {
    Box(Modifier.fillMaxSize().clearAndSetSemantics {}.background(Brush.radialGradient(0f to Color(0x2EFF5A14), 0.7f to Color(0x8C08020E))))
}

/**
 * Le PAN en enseigne néon western (même lettre que l'annonce) : lettres blanches au cœur, double tube orange et rouge,
 * éclats de néon qui rayonnent, deux étoiles de shérif ; il claque à l'heure du PAN avec un éclair blanc.
 */
@Composable
private fun BoxScope.PanWestern(cle: Any?) {
    val eclair = remember(cle) { Animatable(0.75f) }
    val rayons = remember(cle) { Animatable(0.55f) }
    LaunchedEffect(cle) { eclair.animateTo(0f, tween(350)) }
    LaunchedEffect(cle) { rayons.animateTo(1f, tween(260, easing = FastOutSlowInEasing)) }
    Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        val c = Offset(size.width / 2, size.height / 2)
        val k = size.width / 1920f
        for (i in 0 until 18) {
            val a = i / 18.0 * PI * 2 + 0.09
            val r1 = (300 + (i % 3) * 26) * rayons.value
            val r2 = r1 + (120 + (i % 2) * 70) * rayons.value
            val p1 = c + Offset((cos(a) * r1).toFloat() * k, (sin(a) * r1 * 0.62).toFloat() * k)
            val p2 = c + Offset((cos(a) * r2).toFloat() * k, (sin(a) * r2 * 0.62).toFloat() * k)
            drawLine(Color(0x26FF6A00), p1, p2, strokeWidth = 34f * k, cap = StrokeCap.Round)
            drawLine(Color(0x66FFB020), p1, p2, strokeWidth = 16f * k, cap = StrokeCap.Round)
            drawLine(Color(0xFFFFF6E0), p1, p2, strokeWidth = 7f * k, cap = StrokeCap.Round)
        }
    }
    Row(
        Modifier.align(Alignment.Center).graphicsLayer { rotationZ = -4f; translationY = -0.04f * size.height }.apparition(0, cle),
        horizontalArrangement = Arrangement.spacedBy(40.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Etoile()
        Box(contentAlignment = Alignment.Center) {
            val base = TextStyle(fontFamily = PoliceGsWestern, fontSize = 330.sp, lineHeight = 1.em, letterSpacing = 0.02.em)
            Text("PAN !", maxLines = 1, softWrap = false, style = base.copy(color = Color(0xFFFF2D20), shadow = Shadow(Color(0xFFFF2D20), Offset.Zero, 120f)))
            Text("PAN !", maxLines = 1, softWrap = false, style = base.copy(color = Color(0xFFFF5A00), shadow = Shadow(Color(0xFFFF5A00), Offset.Zero, 48f)))
            Text("PAN !", maxLines = 1, softWrap = false, style = base.copy(color = Color.White, shadow = Shadow(Color(0xFFFF8A1A), Offset.Zero, 22f)))
            Text("PAN !", maxLines = 1, softWrap = false, style = base.copy(color = Creme, drawStyle = Stroke(width = 4f)))
        }
        Etoile()
    }
    Box(Modifier.fillMaxSize().graphicsLayer { alpha = eclair.value }.background(Color.White))
}

/** Une étoile de shérif en néon. */
@Composable
private fun Etoile() {
    Text(
        "★", maxLines = 1, softWrap = false, modifier = Modifier.padding(bottom = 40.dp),
        style = TextStyle(fontSize = 110.sp, color = Color(0xFFFFF3C4), shadow = Shadow(Color(0xFFFFC040), Offset.Zero, 40f)),
    )
}

/** Le bandeau du résultat : cadre blanc et couleur de la gagnante, le titre en western néon, les points. */
@Composable
private fun BandeauWestern(r: ResultatDuel, cle: Any?, modifier: Modifier) {
    val forme = RoundedCornerShape(40.dp)
    Column(
        modifier
            .fillMaxWidth()
            .apparition(0, cle)
            .drawBehind { lueur(r.couleur, 40.dp.toPx(), 4) }
            .background(NuitBandeau, forme)
            .border(5.dp, Color.White, forme)
            .padding(5.dp)
            .border(6.dp, r.couleur, RoundedCornerShape(35.dp))
            .padding(start = 40.dp, end = 40.dp, top = 24.dp, bottom = 30.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (r.hautCouleur != null) TexteNeon(r.haut, r.hautCouleur, 54f, PoliceGsTexte, largeurMax = 1500.dp, force = 0.5f, graisse = FontWeight.Bold)
        else Text(r.haut, maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 46.sp, color = Creme))
        TexteNeon(r.titre, r.couleur, 96f, largeurMax = 1500.dp)
        r.points?.let {
            Text(
                it, maxLines = 1, softWrap = false,
                modifier = Modifier.padding(top = 12.dp)
                    .drawBehind { lueur(r.couleur, 50.dp.toPx(), 2) }
                    .background(r.couleur, RoundedCornerShape(50.dp)).padding(horizontal = 34.dp, vertical = 6.dp),
                style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 44.sp, color = Color(0xFF120818)),
            )
        }
    }
}

/** Halo d'un cadre arrondi ([rayon] : son arrondi) : [n] contours de plus en plus larges et pâles autour du bord. */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.lueur(couleur: Color, rayon: Float, n: Int) {
    for (i in 1..n) {
        val e = i * 10.dp.toPx()
        drawRoundRect(
            couleur.copy(alpha = 0.28f / i), topLeft = Offset(-e / 2, -e / 2), size = size.copy(width = size.width + e, height = size.height + e),
            cornerRadius = CornerRadius(rayon + e / 2), style = Stroke(e),
        )
    }
}

/** Une affiche WANTED du classement du duel : l'équipe, sa couleur, ses duels gagnés, le portrait de son robot. */
class AfficheWanted(val nom: String, val couleur: Color, val duels: Int, val portrait: String)

/** Les portraits du robot livrés par le design, un par couleur d'équipe proposée (TEAM_COLORS, même ordre). */
internal val PORTRAITS_DUEL = listOf(
    "rose" to Color(0xFFFF2D95), "orange" to Color(0xFFFF6B1A), "vert" to Color(0xFF39FF14), "jaune" to Color(0xFFFFE600),
    "bleu" to Color(0xFF2B86C5), "violet" to Color(0xFF9B5DE5), "rouge" to Color(0xFFF94144), "turquoise" to Color(0xFF2EE8E0),
)

/** Le portrait (nom de couleur) le plus proche de la couleur d'équipe [c] : une couleur choisie à la main tombe sur la plus proche. */
internal fun portraitDuel(c: Color): String = PORTRAITS_DUEL.minBy { (_, p) ->
    val r = c.red - p.red
    val g = c.green - p.green
    val b = c.blue - p.blue
    r * r + g * g + b * b
}.first

private fun portraitRes(nom: String): Int = when (nom) {
    "orange" -> R.drawable.gs_duel_portrait_orange
    "vert" -> R.drawable.gs_duel_portrait_vert
    "jaune" -> R.drawable.gs_duel_portrait_jaune
    "bleu" -> R.drawable.gs_duel_portrait_bleu
    "violet" -> R.drawable.gs_duel_portrait_violet
    "rouge" -> R.drawable.gs_duel_portrait_rouge
    "turquoise" -> R.drawable.gs_duel_portrait_turquoise
    else -> R.drawable.gs_duel_portrait_rose
}

/**
 * « Les meilleurs tireurs » : une affiche WANTED par équipe, déjà rangées (la première en premier), légèrement de
 * travers comme clouées au mur ; les premières à égalité brillent en or (« ★ CHAMPIONS ★ »). Jusqu'à 4 équipes sur une
 * rangée, au-delà sur deux rangées d'affiches plus petites.
 */
@Composable
internal fun AffichesWanted(affiches: List<AfficheWanted>, cle: Any?) {
    Box(Modifier.fillMaxSize().clearAndSetSemantics {}.background(Brush.radialGradient(listOf(Color(0x4008020E), Color(0xB308020E)))))
    EchelleSansCoupe(SCENE_L, SCENE_H, Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(top = 80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            TexteNeon("Les meilleurs tireurs", GS.Orange, 76f, largeurMax = 1600.dp, force = 0.6f, modifier = Modifier.apparition(0, cle))
            val k = if (affiches.size <= 4) 1f else 0.62f
            val meilleur = affiches.maxOfOrNull { it.duels } ?: 0
            val rangees = if (affiches.size <= 4) listOf(affiches) else affiches.chunked((affiches.size + 1) / 2)
            Column(
                Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy((40 * k).dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                var rang = 0
                rangees.forEach { rangee ->
                    Row(horizontalArrangement = Arrangement.spacedBy((36 * k).dp)) {
                        rangee.forEach { a ->
                            val i = rang++
                            Affiche(a, k, champion = meilleur > 0 && a.duels == meilleur, penche = listOf(-3f, 2f, -1f, 3f)[i % 4], modifier = Modifier.apparition(250L + 180L * i, cle))
                        }
                    }
                }
            }
        }
    }
}

private val Papier = Color(0xFF3A1A08)

@Composable
private fun Affiche(a: AfficheWanted, k: Float, champion: Boolean, penche: Float, modifier: Modifier) {
    val forme = RoundedCornerShape((10 * k).dp)
    Box(
        modifier
            .graphicsLayer { rotationZ = penche }
            .drawBehind {
                if (champion) lueur(Color(0xFFFFB020), (10 * k).dp.toPx(), 4)
                drawRoundRect(Color(0x99000000), topLeft = Offset(0f, 20 * k * density), size = size, cornerRadius = CornerRadius(10 * k * density))
            }
            .border(((if (champion) 10 else 5) * k).dp, if (champion) Color(0xFFFFD34A) else Color(0xFF1A0A20), forme)
            .background(Brush.linearGradient(listOf(Color(0xFFF8E2B0), Color(0xFFE9C27A), Color(0xFFD6A35A))), forme)
            .padding(horizontal = (22 * k).dp, vertical = (26 * k).dp)
            .widthIn(min = (316 * k).dp, max = (316 * k).dp)
            .height((508 * k).dp),
    ) {
        // Le clou.
        Box(Modifier.align(Alignment.TopCenter).padding(top = 0.dp).graphicsLayer { translationY = -16 * k * density }.background(Color(0xFF555555), RoundedCornerShape(50)).padding((8 * k).dp))
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("WANTED", maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsWestern, fontSize = (72 * k).sp, lineHeight = 1.em, color = Papier))
            Text(
                if (champion) "★ CHAMPIONS ★" else "RECHERCHÉS", maxLines = 1, softWrap = false, modifier = Modifier.padding(top = (6 * k).dp, bottom = (14 * k).dp),
                style = TextStyle(fontFamily = PoliceGsWestern, fontSize = (24 * k).sp, letterSpacing = 0.1.em, color = Papier),
            )
            Box(
                Modifier.fillMaxWidth().padding(horizontal = (10 * k).dp).height((200 * k).dp)
                    .clip(RoundedCornerShape((6 * k).dp)).background(Color(0xFF1A0A24))
                    .border((4 * k).dp, Papier, RoundedCornerShape((6 * k).dp)),
            ) {
                Image(painterResource(portraitRes(a.portrait)), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Box(Modifier.padding(top = (14 * k).dp)) {
                val nom = a.nom.ifBlank { "Équipe" }
                NomAffiche(nom, a.couleur, k)
            }
            Text(
                "${a.duels} DUEL" + if (a.duels > 1) "S" else "", maxLines = 1, softWrap = false, modifier = Modifier.padding(top = (6 * k).dp),
                style = TextStyle(fontFamily = PoliceGsTitre, fontSize = (40 * k).sp, color = Papier),
            )
        }
    }
}

/** Le nom de l'équipe sur l'affiche : à sa couleur, cerclé de brun pour se lire sur le papier, sur une ligne. */
@Composable
private fun NomAffiche(nom: String, couleur: Color, k: Float) {
    val mesure = rememberTextMeasurer()
    val d = LocalDensity.current
    fun style(t: Float) = TextStyle(fontFamily = PoliceGsWestern, fontSize = t.sp, lineHeight = 1.1.em, textAlign = TextAlign.Center)
    val taille = remember(nom, k, d.density) {
        val max = with(d) { (272 * k).dp.toPx() }
        var t = 46f * k
        while (t > 14f && mesure.measure(nom, style(t), maxLines = 1, softWrap = false).size.width > max) t *= 0.92f
        t
    }
    Box(contentAlignment = Alignment.Center) {
        Text(nom, maxLines = 1, softWrap = false, style = style(taille).copy(color = Papier, drawStyle = Stroke(width = taille * 0.16f * d.density, join = androidx.compose.ui.graphics.StrokeJoin.Round)))
        Text(nom, maxLines = 1, softWrap = false, style = style(taille).copy(color = couleur))
    }
}
