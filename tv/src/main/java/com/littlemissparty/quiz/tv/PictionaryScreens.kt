package com.littlemissparty.quiz.tv

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.BandeauEquipes
import com.littlemissparty.quiz.tv.habillage.Gerbe
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.Tampon
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.rebond
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/*
 * Pictionary sur la TV. Équipe par équipe : le dessinateur choisit son mot sur sa tablette (la TV ne le montre
 * jamais avant la fin du tour), puis dessine ; son dessin s'affiche ici en direct, en grand, et son équipe
 * devine. L'écran ne décide rien : il affiche l'état du moteur. La télécommande reste un secours de la régie.
 */

/** Le dessin en direct, fourni par la box (GameViewModel.dessin) : seul le dessin se redessine à chaque trait. */
val LocalDessin = staticCompositionLocalOf<StateFlow<Dessin>> { MutableStateFlow(Dessin()) }

/** Épaisseurs des traits, sur une feuille de 800 de large (comme le pupitre). */
private val EPAISSEURS = mapOf(1 to 6f, 2 to 14f, 3 to 30f)

@Composable
fun PictionaryScreen(state: UiState.Playing, actions: TvActions) {
    val m = state.mime ?: return
    val team = state.teams.find { it.uid == m.team }
    val secret = state.teams.find { it.uid == m.secret }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "PICTIONARY",
                    color = Palette.Night, fontSize = 20.sp, fontWeight = FontWeight.Black, letterSpacing = 3.sp,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(Neon.Or).padding(horizontal = 16.dp, vertical = 4.dp),
                )
                Spacer(Modifier.width(14.dp))
                Text(
                    when {
                        team != null -> "${team.name} dessine !"
                        secret != null -> "${secret.name} choisit son mot…"
                        else -> "Un mot par équipe · ${m.points} points s'il est trouvé"
                    },
                    color = team?.color?.toColor() ?: Palette.InkSoft, fontSize = 24.sp, fontWeight = FontWeight.Black,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                if (team != null) MimeCountdown(state)
            }
            Spacer(Modifier.height(10.dp))
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                when {
                    team != null -> Feuille(team.color.toColor())
                    secret != null -> Secret(secret)
                    else -> EntreDeuxTours(state, m)
                }
            }
            Spacer(Modifier.height(10.dp))
            BandeauEquipes(
                nombre = state.teams.size,
                modifier = Modifier.fillMaxWidth(),
                actions = { if (!state.paused) PictoButtons(state, m, actions) },
            ) { i, compacte, mod ->
                val t = state.teams.getOrNull(i) ?: return@BandeauEquipes
                PictoChip(t, m.counts[t.uid] ?: 0, playing = t.uid == m.team || t.uid == m.secret, passed = t.uid in m.turns, compacte = compacte, modifier = mod)
            }
        }
        // « À VOS CRAYONS ! » au début du dessin ; « TROUVÉ ! » ou « TEMPS ÉCOULÉ ! » à la fin du tour.
        Tampon("À VOS CRAYONS !", cle = "picto ${m.turns.size}", actif = team != null)
        val last = m.last
        Tampon("TROUVÉ !", cle = "trouve ${m.turns.size}", actif = team == null && secret == null && last != null && last.found > 0)
        Tampon("TEMPS ÉCOULÉ !", cle = "fin ${m.turns.size}", couleur = Neon.Halo, actif = team == null && secret == null && last != null && last.found == 0)
    }
}

/** Le dessin de la tablette, en direct, sur une feuille blanche au cadre doré (format 4:3 du pupitre). */
@Composable
private fun Feuille(couleur: Color, modifier: Modifier = Modifier) {
    val dessin by LocalDessin.current.collectAsState()
    Box(
        modifier
            .aspectRatio(4f / 3f)
            .clip(RoundedCornerShape(22.dp))
            .border(10.dp, Neon.Or, RoundedCornerShape(22.dp))
            .padding(10.dp)
            .border(4.dp, couleur, RoundedCornerShape(12.dp))
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White)
            .semantics { contentDescription = "Dessin en direct" },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val sx = size.width / 1000f
            val sy = size.height / 1000f
            dessin.traits.forEach { t ->
                val c = t.couleur?.let { Color(it.toInt()) } ?: Color.White
                val w = (EPAISSEURS[t.epaisseur] ?: 14f) * size.width / 800f
                if (t.points.size == 1) {
                    val (x, y) = t.points[0]
                    drawCircle(c, radius = w / 2, center = Offset(x * sx, y * sy))
                } else {
                    val path = Path()
                    t.points.forEachIndexed { i, (x, y) -> if (i == 0) path.moveTo(x * sx, y * sy) else path.lineTo(x * sx, y * sy) }
                    drawPath(path, c, style = Stroke(width = w, cap = StrokeCap.Round, join = StrokeJoin.Round))
                }
            }
        }
    }
}

/** Le dessinateur choisit son mot sur sa tablette : chut, ses coéquipiers se retournent. */
@Composable
private fun Secret(team: Team) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("🤫", fontSize = 110.sp, lineHeight = 116.sp, modifier = Modifier.apparition(0, team.uid).rebond(true))
        Text(
            "Chut !", color = team.color.toColor(), fontSize = 56.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.apparition(0, team.uid),
        )
        Text(
            "Le dessinateur de ${team.name} choisit son mot sur la tablette.\nSes coéquipiers, retournez-vous !",
            color = Palette.Ink, fontSize = 28.sp, lineHeight = 36.sp, textAlign = TextAlign.Center,
            maxLines = 3, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Entre deux tours : le mot du tour qui vient de finir (et son dessin), ou la présentation du jeu. */
@Composable
private fun EntreDeuxTours(state: UiState.Playing, m: MimeUi) {
    val last = m.last
    val lastTeam = state.teams.find { it.uid == last?.team }
    val card = m.lastCard
    if (last == null || lastTeam == null || card == null) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text("✏️", fontSize = 100.sp, lineHeight = 106.sp, modifier = Modifier.rebond(true))
            Text("Pictionary !", color = Neon.Or, fontSize = 60.sp, fontWeight = FontWeight.Black)
            Text(
                "Un enfant dessine sur la tablette de son équipe, le dessin apparaît ici en direct.\n" +
                    "Son équipe a ${(state.question?.durationSec ?: 90)} secondes pour trouver le mot : ${m.points} points !",
                color = Palette.Ink, fontSize = 26.sp, lineHeight = 34.sp, textAlign = TextAlign.Center,
            )
        }
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        Feuille(lastTeam.color.toColor(), Modifier.weight(1f, fill = false).fillMaxHeight())
        Box(contentAlignment = Alignment.Center) {
            if (last.found > 0) Gerbe(cle = m.turns.size, actif = true, modifier = Modifier.matchParentSize())
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("C'était…", color = Palette.InkSoft, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                Text(card.image ?: "✏️", fontSize = 100.sp, lineHeight = 106.sp)
                Text(
                    card.word, color = Neon.Or, fontSize = 48.sp, lineHeight = 52.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(360.dp),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    if (last.found > 0) "Bravo ${lastTeam.name} ! +${last.found * m.points} points" else "Pas trouvé cette fois, ${lastTeam.name} !",
                    color = lastTeam.color.toColor(), fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(360.dp),
                )
            }
        }
    }
}

@Composable
private fun PictoChip(team: Team, count: Int, playing: Boolean, passed: Boolean, compacte: Boolean = false, modifier: Modifier = Modifier) {
    val color = team.color.toColor()
    val taille = if (compacte) 14.sp else 16.sp
    Column(
        modifier
            .clip(RoundedCornerShape(16.dp))
            .background(if (playing) color.copy(alpha = 0.45f) else Palette.Panel)
            .border(if (playing) 3.dp else 2.dp, color, RoundedCornerShape(16.dp))
            .padding(horizontal = if (compacte) 8.dp else 12.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(team.name, color = Palette.Ink, fontSize = taille, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            "$count dessin${if (count > 1) "s" else ""}" + if (passed && !playing) " ✓" else "",
            color = if (count > 0) Neon.Or else Palette.InkSoft, fontSize = taille, fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Secours à la télécommande : pendant le dessin, « Trouvé ! » et « Arrêter le tour » ; entre deux tours, terminer le
 * Pictionary. Le choix du mot se fait toujours sur la tablette, lancé par la régie.
 */
@Composable
private fun PictoButtons(state: UiState.Playing, m: MimeUi, actions: TvActions) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        if (m.team != null) {
            TvButton("Arrêter le tour", actions.mimeStop, fontSize = 20.sp)
            NextButton("Trouvé !", actions.mimeFound, key = "picto-${m.turns.size}")
        } else if (m.secret == null) {
            val reste = state.teams.any { it.uid !in m.turns }
            NextButton(if (reste) "Terminer le Pictionary" else "Voir le classement", actions.next, key = "picto-between-${m.turns.size}")
        }
    }
}
