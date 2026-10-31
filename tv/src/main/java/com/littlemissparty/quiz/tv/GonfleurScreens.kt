package com.littlemissparty.quiz.tv

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.PUMP_TARGET
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.habillage.DepartGonfleur
import com.littlemissparty.quiz.tv.habillage.GenrePlaque
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.PlaqueAppel
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.SceneGonfleur
import com.littlemissparty.quiz.tv.habillage.styleCentre
import kotlinx.coroutines.delay

/*
 * Le Gonfleur fou sur la TV. L'écran ne décide rien : les tablettes comptent leurs tapes, la box termine la course
 * (premier ballon éclaté, ou plus gros ballon à l'arrêt). Ici : le départ 3, 2, 1… « GONFLEZ ! », calé sur l'heure du
 * serveur comme les tablettes, puis les ballons de chaque équipe (habillage/Gonfleur.kt) et le gagnant.
 */

@Composable
fun GonfleurScreen(state: UiState.Playing, actions: TvActions) {
    val goAt = state.pumpGoAt
    val maintenant by produceState(System.currentTimeMillis() + state.serverOffset, state.serverOffset) {
        while (true) {
            value = System.currentTimeMillis() + state.serverOffset
            delay(100)
        }
    }
    val revele = state.phase == Phase.REVEAL
    val gagnant = state.awards.entries.firstOrNull { it.value.correct }?.key
    val depart = goAt != null && !revele && !state.paused && maintenant < goAt

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                SceneGonfleur(
                    equipes = state.teams.map { Triple(it.name, it.color.toColor(), ((state.pumps[it.uid] ?: 0).toFloat() / PUMP_TARGET).coerceIn(0f, 1f)) },
                    gagnante = if (revele) state.teams.indexOfFirst { it.uid == gagnant }.takeIf { it >= 0 } else null,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Spacer(Modifier.height(10.dp))
            // Game Show : l'onglet « TAPEZ ! » validé par cedric le 31/10 à 11:12 (un peu plus haut que l'ancienne ligne).
            val onglet = Look.gs && !revele && !depart
            Row(Modifier.fillMaxWidth().height(if (onglet) 84.dp else 64.dp), verticalAlignment = Alignment.CenterVertically) {
                if (onglet) Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    PlaqueAppel(GenrePlaque.GONFLEUR, "TAPEZ !", "sur vos tablettes : le premier ballon qui éclate gagne")
                } else Text(
                    when {
                        revele && gagnant == null -> "Personne n'a tapé : tout le monde marque ses points de participation"
                        revele || depart -> ""
                        else -> "Tapez sur vos tablettes : le premier ballon qui éclate gagne !"
                    },
                    style = styleCentre(26.sp, Neon.OrClair),
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!state.paused) when {
                    revele -> NextButton(versClassement(state, "Voir les scores"), actions.next, key = "gonfleur-bilan-${state.index}")
                    // Sans régie, à la télécommande : arrêter la course, le plus gros ballon gagne.
                    state.regies == 0 && !depart -> TvButton("⏹ Arrêter la course", actions.next, fontSize = 22.sp)
                }
            }
        }
        if (depart) key(goAt) { DepartGonfleur(onFini = {}, modifier = Modifier.fillMaxSize()) }
    }
}
