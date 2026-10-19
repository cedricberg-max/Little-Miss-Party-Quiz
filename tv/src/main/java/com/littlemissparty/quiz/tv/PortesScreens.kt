package com.littlemissparty.quiz.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.habillage.ChoixPortes
import com.littlemissparty.quiz.tv.habillage.ClassementPortes
import com.littlemissparty.quiz.tv.habillage.EquipePorte
import com.littlemissparty.quiz.tv.habillage.IntroPortes
import com.littlemissparty.quiz.tv.habillage.LignePortes
import com.littlemissparty.quiz.tv.habillage.OuverturePortes
import com.littlemissparty.quiz.tv.habillage.PorteOuverte
import com.littlemissparty.quiz.tv.habillage.rangs
import kotlinx.coroutines.delay

/*
 * Portes mystères sur la TV (jeu final). L'écran ne décide rien : le choix vient des tablettes, l'ouverture de
 * chaque porte et le classement final des boutons de l'animatrice (régie, ou télécommande en secours).
 */

@Composable
fun PortesScreen(state: UiState.Playing, actions: TvActions) {
    val p = state.portes ?: return
    Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (state.phase == Phase.REVEAL) {
                // Chaque porte avec les équipes qui l'ont choisie ; seules les portes déjà ouvertes montrent leur valeur.
                val portes = p.doors.mapIndexed { i, v ->
                    PorteOuverte(v, state.teams.filter { state.awards[it.uid]?.choice == i }.map { EquipePorte(it.name, it.color.toColor(), true) })
                }
                OuverturePortes(portes, ouvertes = p.opened, modifier = Modifier.fillMaxSize())
            } else {
                val (secondes, fraction) = tempsPortes(state)
                val ecoule = (1f - fraction) * (state.question?.durationMs ?: 0)
                // Les premières secondes du choix : « La manche du destin », et ce qui se cache derrière les portes.
                if (state.phase == Phase.QUESTION && ecoule < INTRO_MS) IntroPortes(p.doors, Modifier.fillMaxSize())
                else ChoixPortes(
                    nombre = p.doors.size,
                    equipes = state.teams.map { EquipePorte(it.name, it.color.toColor(), it.uid in state.answered) },
                    secondes = secondes.takeIf { state.phase == Phase.QUESTION },
                    fraction = fraction.takeIf { state.phase == Phase.QUESTION },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        if (!state.paused) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            when (state.phase) {
                Phase.QUESTION -> NextButton("Fermer les choix", actions.next, key = "portes-choix")
                Phase.CLOSED -> NextButton("Aux portes !", actions.next, key = "portes-fermees")
                else -> NextButton(if (p.allOpen) "Classement final" else "Ouvrir la porte suivante", actions.next, key = "porte-${p.opened}")
            }
        }
    }
}

/** Classement final après les portes : chaque équipe avant / après, avec son scénario (garde la tête, remonte…). */
@Composable
fun PortesClassementScreen(state: UiState.Playing, actions: TvActions) {
    val apres = state.teams.associate { it.uid to (state.scores[it.uid] ?: 0) }
    val avant = state.teams.associate { it.uid to (apres.getValue(it.uid) - (state.awards[it.uid]?.points ?: 0)) }
    // Rangs à partir de 1 ; à égalité après les portes, l'équipe garde sa place d'avant.
    val rangAvant = rangs(state.teams.map { avant.getValue(it.uid) })
    val rangApres = rangs(state.teams.map { apres.getValue(it.uid) }, departage = rangAvant)
    val lignes = state.teams.mapIndexed { i, it ->
        LignePortes(it.name, it.color.toColor(), avant.getValue(it.uid), apres.getValue(it.uid), rangAvant[i] + 1, rangApres[i] + 1)
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
        ClassementPortes(lignes, Modifier.weight(1f).fillMaxWidth())
        if (!state.paused) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            NextButton(suiteLabel(state), actions.next, key = "portes-classement-${state.index}")
        }
    }
}

private const val INTRO_MS = 3_500f

/** Secondes restantes pour choisir et part du temps qui reste, calées sur l'heure du serveur. */
@Composable
private fun tempsPortes(state: UiState.Playing): Pair<Int, Float> {
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
            delay(200)
        }
    }
    return ((remaining + 999) / 1000).toInt() to remaining.toFloat() / total
}
