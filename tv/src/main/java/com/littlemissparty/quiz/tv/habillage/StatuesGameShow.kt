package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
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
import com.littlemissparty.quiz.tv.EtapeStatues
import com.littlemissparty.quiz.tv.STATUES_SUSPENSE_MS
import com.littlemissparty.quiz.tv.Team
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
private val OR = listOf(Color(0xFFFFF7B0), Color(0xFFFFE600), Color(0xFFFFA51F))
private val BARRES = listOf(GS.Rose, GS.Jaune, GS.Cyan, GS.Vert, GS.Orange, Color(0xFFB56BFF))

/**
 * Le plateau des statues en Game Show, à l'[etape] de la chanson (cedric, 27/10 : une chanson par tour, plusieurs
 * gagnantes possibles, [gagnantes] dans l'ordre de Sarah). La musique elle-même reste dans StatuesBoard.
 */
@Composable
internal fun StatuesGameShow(state: UiState.Playing, etape: EtapeStatues, gagnantes: List<Team>, modifier: Modifier = Modifier) {
    // Choix A de cedric (29/10) : STATUE ! en pierre, puis un seul écran BRAVO pour les gagnantes et les autres, qui
    // remplace le récap de la chanson. Gagnantes et récap passent par le même appel : l'animation ne repart pas à 0.
    if (etape == EtapeStatues.STATUE) { StatuePierre(modifier); return }
    val r = state.statues?.result
    if ((etape == EtapeStatues.GAGNANTES || etape == EtapeStatues.RECAP) && r != null && gagnantes.isNotEmpty()) {
        val equipe = { t: Team -> EquipeBravo(t.name, t.color.toColor(), r.gains[t.uid] ?: 0) }
        val depart = (System.currentTimeMillis() + state.serverOffset - r.at - STATUES_SUSPENSE_MS) / 1000f
        BravoStatues(gagnantes.map(equipe), state.teams.filter { t -> gagnantes.none { it.uid == t.uid } }.map(equipe), depart, modifier)
        return
    }
    EchelleSansCoupe(LARGEUR, HAUTEUR, modifier) {
        val centre = Modifier.align(Alignment.Center).padding(top = 40.dp)
        when (etape) {
            EtapeStatues.DANSE -> Dansez(centre)
            EtapeStatues.FINIE -> FinDeLaChanson(centre)
            EtapeStatues.SUSPENSE -> QuiAGagne(centre)
            // Personne n'a gagné (pas de points) : « Personne cette fois ! » reste jusqu'au classement.
            EtapeStatues.GAGNANTES, EtapeStatues.RECAP -> StatueDOr(emptyList(), centre)
            EtapeStatues.STATUE, EtapeStatues.AUTRE -> {}
        }
    }
}

/** La chanson est allée au bout : tout le monde reste figé pendant que Sarah choisit les gagnantes. */
@Composable
private fun FinDeLaChanson(modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "FIN DE LA CHANSON !", maxLines = 1, softWrap = false, modifier = Modifier.apparition(0, "fin"),
            style = TextStyle(brush = Brush.verticalGradient(OR), fontFamily = PoliceGsTitre, fontSize = 110.sp, shadow = Shadow(Color(0xFFFFB000), Offset.Zero, 40f)),
        )
        Spacer(Modifier.height(26.dp))
        LigneBuzz("PLUS PERSONNE NE BOUGE", 30.sp, Modifier.apparition(300, "fin"))
    }
}

/** S1 : DANSEZ ! qui rebondit sur la mesure et un égaliseur qui bat, sans consigne en dessous. */
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
        // Plus d'onglet « BOUGEZ TANT QUE LA MUSIQUE JOUE » : « DANSEZ ! » reste seul (cedric, 31/10 à 11:12).
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

/** S3 : Sarah a choisi : « ET L'ÉQUIPE GAGNANTE EST… », roulement de tambour, compte 3, 2, 1 dans un anneau, puis « ? » qui bat. */
@Composable
private fun QuiAGagne(modifier: Modifier) {
    val ms = horloge(Unit)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "ET L'ÉQUIPE GAGNANTE EST…", maxLines = 1, softWrap = false, modifier = Modifier.apparition(0, "qui"),
            style = TextStyle(brush = Brush.verticalGradient(OR), fontFamily = PoliceGsTitre, fontSize = 72.sp, shadow = Shadow(Color(0xFFFFB000), Offset.Zero, 40f)),
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

/**
 * S4 : la statue d'or. Les équipes gagnantes ([gagnantes] : nom, couleur, points de la chanson) couronnées, à leur
 * couleur, avec leurs vrais points ; personne : « Personne cette fois ! ».
 */
@Composable
private fun StatueDOr(gagnantes: List<Triple<String, Color, Int>>, modifier: Modifier) {
    val cle = gagnantes.joinToString { it.first }
    val ms = horloge(cle)
    if (gagnantes.isEmpty()) {
        Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "PERSONNE CETTE FOIS !", textAlign = TextAlign.Center, maxLines = 1, softWrap = false, modifier = Modifier.apparition(0, "personne"),
                style = TextStyle(brush = Brush.verticalGradient(OR), fontFamily = PoliceGsTitre, fontSize = 96.sp, shadow = Shadow(Color(0xFFFFB000), Offset.Zero, 36f)),
            )
            Spacer(Modifier.height(22.dp))
            LigneBuzz("ON SE RATTRAPE À LA PROCHAINE CHANSON", 28.sp, Modifier.apparition(300, "personne"))
        }
        return
    }
    Box(Modifier.fillMaxSize()) {
        Rayons(ms)
        Gerbe(cle = cle, modifier = Modifier.fillMaxSize())
    }
    if (gagnantes.size > 1) {
        // Plusieurs gagnantes : la couronne, puis chaque nom à sa couleur, l'un sous l'autre (jusqu'à 8 sur deux colonnes).
        val colonnes = if (gagnantes.size > 4) 2 else 1
        val taille = when { gagnantes.size > 4 -> 52f; gagnantes.size > 2 -> 70f; else -> 100f }
        val largeur = if (colonnes > 1) 700.dp else 1300.dp
        Column(modifier.clearAndSetSemantics { contentDescription = "Bravo ${gagnantes.joinToString(", ") { it.first }} ! La statue d'or" }, horizontalAlignment = Alignment.CenterHorizontally) {
            Couronne(visible = true, Modifier.size(120.dp, 84.dp))
            Spacer(Modifier.height(6.dp))
            LigneBuzz("LES STATUES D'OR", 30.sp, Modifier.apparition(150, cle))
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(40.dp)) {
                gagnantes.chunked((gagnantes.size + colonnes - 1) / colonnes).forEach { colonne ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        colonne.forEachIndexed { i, (nom, couleur, _) ->
                            Box(Modifier.apparition(300L + 150L * i, nom)) { NomUneLigne(nom, couleur, taille, largeur) }
                        }
                    }
                }
            }
            val points = gagnantes.first().third
            if (points > 0) {
                Spacer(Modifier.height(14.dp))
                Text(
                    "+$points POINTS CHACUNE", maxLines = 1, softWrap = false,
                    modifier = Modifier.apparition(700, cle).background(Brush.verticalGradient(OR), RoundedCornerShape(50)).padding(horizontal = 34.dp, vertical = 8.dp),
                    style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = 30.sp, color = Color(0xFF3A1600)),
                )
            }
        }
        return
    }
    val (nom, couleur, points) = gagnantes.single()
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
