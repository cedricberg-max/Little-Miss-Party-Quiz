package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.matchParentSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.UiState
import com.littlemissparty.quiz.tv.toColor
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/*
 * Statues musicales du Game Show, propositions S1 à S4 (cedric, 24/10 : « DANSEZ ! » et « STATUE ! » plats, balayage
 * pauvre, fin « L'animatrice désigne… » inutile). S1 : DANSEZ ! en lettres de couleur qui rebondissent sur un égaliseur ;
 * S2 : STATUE ! gelé dans la glace, qui claque et se fend ; S3 : « QUI A GAGNÉ ? » avec un compte 3, 2, 1 dans un anneau
 * pendant que Sarah choisit ; S4 : la statue d'or, le nom de l'équipe couronné, ses vrais points. Aucun cadre ; tout est
 * dessiné en calques légers (pas de vidéo en plus de celle du plateau).
 */

private val LARGEUR = 1600.dp
private val HAUTEUR = 700.dp
private val GLACE = listOf(Color.White, Color(0xFFC9F7FF), Color(0xFF5FDcFF), Color(0xFF2C7DFF))
private val OR = listOf(Color(0xFFFFF7B0), Color(0xFFFFE600), Color(0xFFFFA51F))
private val BARRES = listOf(GS.Rose, GS.Jaune, GS.Cyan, GS.Vert, GS.Orange, Color(0xFFB56BFF))

/** Le plateau des statues en Game Show ; [danse] : la musique joue. La musique elle-même reste dans StatuesBoard. */
@Composable
internal fun StatuesGameShow(state: UiState.Playing, danse: Boolean, modifier: Modifier = Modifier) {
    val enCours = state.phase == Phase.QUESTION
    EchelleSansCoupe(LARGEUR, HAUTEUR, modifier) {
        PastilleJeu("STATUES MUSICALES", Modifier.align(Alignment.TopCenter).padding(top = 6.dp))
        val centre = Modifier.align(Alignment.Center).padding(top = 40.dp)
        when {
            enCours && danse -> Dansez(centre)
            enCours -> StatueGlace(centre)
            state.phase == Phase.CLOSED -> QuiAGagne(centre)
            else -> {
                val gagnant = state.teams.find { state.awards[it.uid]?.correct == true }
                StatueDOr(gagnant?.name, gagnant?.color?.toColor(), gagnant?.let { state.awards[it.uid]?.points } ?: 0, centre)
            }
        }
    }
}

/** Petite étiquette du jeu, en tube cyan. */
@Composable
private fun PastilleJeu(texte: String, modifier: Modifier = Modifier) {
    Text(
        texte, maxLines = 1, softWrap = false,
        modifier = modifier.border(2.dp, GS.Cyan, RoundedCornerShape(50)).background(GS.Noir.copy(alpha = 0.55f), RoundedCornerShape(50))
            .padding(horizontal = 22.dp, vertical = 6.dp),
        style = TextStyle(
            fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = 5.sp, color = GS.CyanClair,
            shadow = Shadow(GS.Cyan, Offset.Zero, 12f),
        ),
    )
}

/** S1 : DANSEZ ! qui rebondit sur la mesure, un égaliseur qui bat, la consigne en dessous. */
@Composable
private fun Dansez(modifier: Modifier) {
    val ms = horloge(Unit)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.graphicsLayer {
            // Un petit saut sur chaque temps (120 BPM) : le mot entier rebondit, chaque lettre danse en plus.
            val temps = (ms() % 500f) / 500f
            val saut = 1f - temps
            translationY = -14f * density * saut * saut
            val s = 1f + 0.03f * saut * saut
            scaleX = s
            scaleY = s
        }) { LettresQuiDansent("DANSEZ !", 170.sp) }
        Spacer(Modifier.height(18.dp))
        Egaliseur(ms, Modifier.width(560.dp).height(96.dp))
        Spacer(Modifier.height(22.dp))
        LigneBuzz("BOUGEZ TANT QUE LA MUSIQUE JOUE", 26.sp)
    }
}

/** Seize barres de couleur qui montent et descendent au tempo, chacune à sa façon. */
@Composable
private fun Egaliseur(ms: () -> Float, modifier: Modifier) {
    Canvas(modifier.clearAndSetSemantics {}) {
        val n = 16
        val pas = size.width / n
        val l = pas * 0.62f
        val t = ms() / 1000f
        for (k in 0 until n) {
            val h = 0.25f + 0.75f * abs(sin(t * PI.toFloat() * 2f * (0.9f + 0.13f * (k % 5)) + k * 1.7f))
            val haut = size.height * h
            val c = BARRES[k % BARRES.size]
            val x = k * pas + (pas - l) / 2
            drawRoundRect(c.copy(alpha = 0.28f), Offset(x - l * 0.3f, size.height - haut - l * 0.3f), Size(l * 1.6f, haut + l * 0.3f), CornerRadius(l))
            drawRoundRect(c, Offset(x, size.height - haut), Size(l, haut), CornerRadius(l / 2))
            drawRoundRect(Color.White.copy(alpha = 0.55f), Offset(x + l * 0.3f, size.height - haut + l * 0.3f), Size(l * 0.4f, (haut - l * 0.6f).coerceAtLeast(0f)), CornerRadius(l / 4))
        }
    }
}

/** S2 : STATUE ! en glace, qui claque à l'arrêt de la musique, se fend, et des éclats de givre qui flottent. */
@Composable
private fun StatueGlace(modifier: Modifier) {
    val ms = horloge(Unit)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.graphicsLayer {
                val p = (ms() / 180f).coerceIn(0f, 1f)
                val s = 1.55f - 0.55f * (1f - (1f - p) * (1f - p))
                scaleX = s
                scaleY = s
                alpha = p
                // Secousse brève au contact, comme un bloc de glace qui tombe.
                val choc = ((ms() - 180f) / 220f).coerceIn(0f, 1f)
                translationX = if (choc in 0.001f..0.999f) sin(choc * 30f) * (1f - choc) * 10f * density else 0f
            },
        ) {
            // Halo cyan, puis la glace ; les fêlures se dessinent par-dessus.
            Text(
                "STATUE !", maxLines = 1, softWrap = false,
                style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 180.sp, color = Color(0xFF0B3C7A), shadow = Shadow(GS.Cyan, Offset.Zero, 60f)),
                modifier = Modifier.clearAndSetSemantics {}.graphicsLayer { translationY = 7f * density },
            )
            Text(
                "STATUE !", maxLines = 1, softWrap = false,
                style = TextStyle(brush = Brush.verticalGradient(GLACE), fontFamily = PoliceGsTitre, fontSize = 180.sp, shadow = Shadow(Color(0xFF7FE9FF), Offset.Zero, 24f)),
            )
            Canvas(Modifier.matchParentSize().clearAndSetSemantics {}) {
                val a = ((ms() - 200f) / 250f).coerceIn(0f, 1f)
                if (a <= 0f) return@Canvas
                val w = size.width
                val h = size.height
                val trait = Stroke(2.5f * density, cap = StrokeCap.Round)
                val c = Color.White.copy(alpha = 0.85f * a)
                // Trois fêlures, chacune en zigzag, qui s'allongent.
                for ((x0, y0, dx) in listOf(Triple(0.18f, 0.22f, 1f), Triple(0.55f, 0.8f, -1f), Triple(0.78f, 0.3f, -1f))) {
                    var x = x0 * w
                    var y = y0 * h
                    for (k in 0 until 4) {
                        val nx = x + dx * w * 0.035f * (1 + k % 2)
                        val ny = y + (if (y0 < 0.5f) 1f else -1f) * h * 0.12f
                        drawLine(c, Offset(x, y), Offset(x + (nx - x) * a, y + (ny - y) * a), trait.width, StrokeCap.Round)
                        x = nx
                        y = ny
                    }
                }
                // Givre : quelques éclats qui scintillent autour des lettres.
                val t = ms() / 1000f
                for (k in 0 until 14) {
                    val px = w * ((k * 0.137f + 0.05f) % 1f)
                    val py = h * (0.1f + 0.8f * ((k * 0.311f) % 1f)) - (t * 12f * density * (1 + k % 3)) % (h * 0.3f)
                    val eclat = 0.4f + 0.6f * abs(sin(t * 3f + k))
                    drawCircle(Color.White.copy(alpha = 0.7f * a * eclat), (1.5f + k % 3) * density, Offset(px, py))
                }
            }
        }
        Spacer(Modifier.height(26.dp))
        LigneBuzz("PLUS PERSONNE NE BOUGE", 30.sp, Modifier.apparition(300, "statue"))
    }
}

/** S3 : fin de la musique, Sarah choisit sur la régie : « QUI A GAGNÉ ? », compte 3, 2, 1 dans un anneau, puis « ? » qui bat. */
@Composable
private fun QuiAGagne(modifier: Modifier) {
    val ms = horloge(Unit)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "QUI A GAGNÉ ?", maxLines = 1, softWrap = false, modifier = Modifier.apparition(0, "qui"),
            style = TextStyle(brush = Brush.verticalGradient(OR), fontFamily = PoliceGsTitre, fontSize = 110.sp, shadow = Shadow(Color(0xFFFFB000), Offset.Zero, 40f)),
        )
        Spacer(Modifier.height(18.dp))
        Box(Modifier.size(230.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
                // L'anneau bat à 120 BPM ; un arc fait le tour de chaque seconde du compte.
                val battement = 1f - (ms() % 500f) / 500f
                val r = size.minDimension / 2 * (0.86f + 0.04f * battement * battement)
                val c = Offset(size.width / 2, size.height / 2)
                drawCircle(GS.Rose.copy(alpha = 0.22f), r, c, style = Stroke(26f * density))
                drawCircle(GS.Rose, r, c, style = Stroke(7f * density))
                drawCircle(Color.White.copy(alpha = 0.6f), r, c, style = Stroke(2.5f * density))
                val p = (ms() % 1000f) / 1000f
                if (ms() < 3_000f) drawArc(GS.Jaune, -90f, 360f * p, false, Offset(c.x - r, c.y - r), Size(2 * r, 2 * r), style = Stroke(7f * density, cap = StrokeCap.Round))
            }
            val reste = 3 - (ms() / 1000f).toInt()
            val chiffre = if (reste >= 1) "$reste" else "?"
            Text(
                chiffre, maxLines = 1, softWrap = false,
                modifier = Modifier.graphicsLayer {
                    val p = (ms() % 1000f) / 1000f
                    val s = if (reste >= 1) 1.25f - 0.25f * (1f - (1f - p) * (1f - p)).coerceAtMost(1f) else 1f + 0.06f * (1f - (ms() % 500f) / 500f)
                    scaleX = s
                    scaleY = s
                },
                style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 120.sp, color = Color.White, shadow = Shadow(GS.Rose, Offset.Zero, 30f), textAlign = TextAlign.Center),
            )
        }
        Spacer(Modifier.height(22.dp))
        LigneBuzz("ROULEMENT DE TAMBOUR…", 26.sp)
    }
}

/** S4 : la statue d'or. Le nom de l'équipe gagnante couronné, à sa couleur, et ses vrais points ; personne : bravo à tous. */
@Composable
private fun StatueDOr(nom: String?, couleur: Color?, points: Int, modifier: Modifier) {
    val ms = horloge(nom)
    Box(Modifier.fillMaxSize()) {
        Rayons(ms)
        Gerbe(cle = nom, modifier = Modifier.fillMaxSize())
    }
    if (nom == null || couleur == null) {
        Text(
            "BRAVO À TOUS LES DANSEURS !", textAlign = TextAlign.Center, modifier = modifier.padding(horizontal = 60.dp).apparition(0, "tous"),
            style = TextStyle(brush = Brush.verticalGradient(OR), fontFamily = PoliceGsTitre, fontSize = 84.sp, lineHeight = 92.sp, shadow = Shadow(Color(0xFFFFB000), Offset.Zero, 36f)),
        )
        return
    }
    // Lu d'un seul bloc : « Bravo X ! » et la statue d'or.
    Column(modifier.clearAndSetSemantics { contentDescription = "Bravo $nom ! La statue d'or" }, horizontalAlignment = Alignment.CenterHorizontally) {
        Couronne(visible = true, Modifier.size(150.dp, 104.dp))
        Spacer(Modifier.height(10.dp))
        LigneBuzz("LA STATUE D'OR", 30.sp, Modifier.apparition(150, nom))
        Spacer(Modifier.height(4.dp))
        Box(Modifier.apparition(300, nom)) { NomUneLigne(nom, couleur, 170f, 1300.dp) }
        if (points > 0) {
            Spacer(Modifier.height(16.dp))
            Text(
                "+$points ${if (points > 1) "POINTS" else "POINT"}", maxLines = 1, softWrap = false,
                modifier = Modifier.apparition(700, nom).background(Brush.verticalGradient(OR), RoundedCornerShape(50)).padding(horizontal = 34.dp, vertical = 8.dp),
                style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = 34.sp, color = Color(0xFF3A1600)),
            )
        }
    }
}
