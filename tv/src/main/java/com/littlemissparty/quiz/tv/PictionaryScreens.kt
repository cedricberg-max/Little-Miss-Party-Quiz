package com.littlemissparty.quiz.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.BandeauEquipes
import com.littlemissparty.quiz.tv.habillage.COULEURS_DESSIN
import com.littlemissparty.quiz.tv.habillage.EPAISSEURS_DESSIN
import com.littlemissparty.quiz.tv.habillage.IntroPictionary
import com.littlemissparty.quiz.tv.habillage.MotPictionary
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.RevelationPictionary
import com.littlemissparty.quiz.tv.habillage.ScenePictionary
import com.littlemissparty.quiz.tv.habillage.Tampon
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.TraitDessin
import com.littlemissparty.quiz.tv.habillage.rebond
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/*
 * Pictionary sur la TV. Équipe par équipe : le dessinateur choisit son mot sur sa tablette (la TV ne le montre
 * jamais avant la fin du tour), puis dessine ; son dessin s'affiche ici en direct, en grand, et son équipe
 * devine. L'écran ne décide rien : il affiche l'état du moteur. La télécommande reste un secours de la régie.
 */

/** Le dessin en direct, fourni par la box (GameViewModel.dessin) : seul le dessin se redessine à chaque trait. */
val LocalDessin = staticCompositionLocalOf<StateFlow<Dessin>> { MutableStateFlow(Dessin()) }

/**
 * Le dessin reçu, au format de l'habillage (TableauDessin) : coordonnées 0..1, feutres et épaisseurs de l'ardoise.
 * Une couleur hors palette prend l'encre ; la gomme d'une ancienne tablette (couleur papier) n'est pas tracée.
 */
fun Dessin.pourTableau(): List<TraitDessin> = traits.mapIndexedNotNull { i, t ->
    val argb = t.couleur ?: return@mapIndexedNotNull null
    val couleur = COULEURS_DESSIN.indexOfFirst { (it.toArgb().toLong() and 0xFFFFFFFFL) == argb }.coerceAtLeast(0)
    val points = FloatArray(t.points.size * 2) { k -> (if (k % 2 == 0) t.points[k / 2].first else t.points[k / 2].second) / 1000f }
    TraitDessin("$effacements-$i", couleur, (t.epaisseur - 1).coerceIn(EPAISSEURS_DESSIN.indices), points)
}

@Composable
fun PictionaryScreen(state: UiState.Playing, actions: TvActions) {
    val m = state.mime ?: return
    val team = state.teams.find { it.uid == m.team }
    val secret = state.teams.find { it.uid == m.secret }
    val dessin by LocalDessin.current.collectAsState()
    val traits = remember(dessin) { dessin.pourTableau() }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    // Le nombre de traits reçus sert aux tests sur émulateur (le dessin arrive bien sur la TV).
                    .semantics { contentDescription = "Dessin en direct · ${dessin.traits.size} traits" },
                contentAlignment = Alignment.Center,
            ) {
                val last = m.last
                val lastTeam = state.teams.find { it.uid == last?.team }
                val card = m.lastCard
                when {
                    team != null -> {
                        val (secondes, fraction) = tempsRestant(state)
                        ScenePictionary(team.name, team.color.toColor(), secondes, fraction, traits, Modifier.fillMaxSize())
                    }
                    secret != null -> IntroPictionary(secret.name, secret.color.toColor(), motMontre = m.chosen, modifier = Modifier.fillMaxSize())
                    last != null && lastTeam != null && card != null -> {
                        val emoji = card.image
                        RevelationPictionary(
                            mot = card.word,
                            trouve = last.found > 0,
                            equipe = lastTeam.name,
                            couleur = lastTeam.color.toColor(),
                            traits = traits,
                            points = if (last.found > 0) last.found * m.points else null,
                            image = emoji?.let { e -> @Composable { Text(e, fontSize = 110.sp, lineHeight = 116.sp) } },
                        )
                    }
                    else -> Presentation(state, m)
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
        Tampon("À VOS CRAYONS !", cle = "picto ${m.turns.size}", actif = team != null)
    }
}

/** Secondes restantes du tour et part du temps qui reste (anneau du chrono), calées sur l'heure du serveur. */
@Composable
private fun tempsRestant(state: UiState.Playing): Pair<Int, Float> {
    val total = state.question?.durationMs ?: 1
    var remaining by remember { mutableLongStateOf(state.remainingMs) }
    LaunchedEffect(state.deadline, state.paused) {
        val deadline = state.deadline
        if (deadline == null) {
            remaining = state.remainingMs
            return@LaunchedEffect
        }
        val start = state.resumeAt ?: 0L
        while (true) {
            remaining = (deadline - maxOf(System.currentTimeMillis() + state.serverOffset, start)).coerceAtLeast(0)
            if (remaining == 0L) break
            delay(100)
        }
    }
    return ((remaining + 999) / 1000).toInt() to remaining.toFloat() / total
}

/** Avant le premier tour : le jeu en une phrase, pendant que Sarah choisit l'équipe qui commence. */
@Composable
private fun Presentation(state: UiState.Playing, m: MimeUi) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        MotPictionary(64.sp, Modifier.apparition(0, "picto"))
        Spacer(Modifier.height(10.dp))
        Text("✏️", fontSize = 90.sp, lineHeight = 96.sp, modifier = Modifier.rebond(true))
        Text("Pictionary !", color = Neon.Or, fontSize = 44.sp, fontWeight = FontWeight.Black)
        Text(
            "Un enfant dessine sur la tablette de son équipe, le dessin apparaît ici en direct.\n" +
                "Son équipe a ${(state.question?.durationSec ?: 90)} secondes pour trouver le mot : ${m.points} points !",
            color = Palette.Ink, fontSize = 26.sp, lineHeight = 34.sp, textAlign = TextAlign.Center,
        )
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
