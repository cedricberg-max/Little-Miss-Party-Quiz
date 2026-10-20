package com.littlemissparty.quiz.tv

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.ScenePatate
import com.littlemissparty.quiz.tv.habillage.styleCentre
import kotlinx.coroutines.delay

/*
 * La patate chaude sur la TV. L'écran ne décide rien : la box allume la mèche (durée tirée au sort, jamais
 * affichée), les tablettes envoient la bombe, la partie la fait exploser. Ici : la scène de la bombe
 * (habillage/Patate.kt) avec une tension qui monte d'après le temps de mèche écoulé, puis l'explosion.
 */

@Composable
fun PatateScreen(state: UiState.Playing, actions: TvActions) {
    val p = state.potato
    val maintenant by produceState(System.currentTimeMillis() + state.serverOffset, state.serverOffset) {
        while (true) {
            value = System.currentTimeMillis() + state.serverOffset
            delay(100)
        }
    }
    val revele = state.phase == Phase.REVEAL
    // Mèche restante : chrono en marche (deadline), ou figé en pause.
    val reste = state.deadline?.let { (it - maintenant).coerceAtLeast(0) } ?: state.remainingMs
    val tension = if (p == null) 0f else (1f - reste.toFloat() / p.fuseMs).coerceIn(0f, 1f)
    val joueuses = p?.teams.orEmpty().mapNotNull { uid -> state.teams.find { it.uid == uid } }
    val porteur = joueuses.indexOfFirst { it.uid == p?.holder }
    val pret = p != null && maintenant >= p.readyAt && (state.resumeAt ?: 0L) <= maintenant

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (p == null || porteur < 0) {
                    Text(
                        if (state.teams.size < 2) "Il faut au moins 2 équipes pour la patate chaude" else "La mèche s'allume…",
                        style = styleCentre(40.sp, Neon.OrClair),
                    )
                } else {
                    ScenePatate(
                        equipes = joueuses.map { it.name to it.color.toColor() },
                        porteur = porteur,
                        precedent = joueuses.indexOfFirst { it.uid == p.from }.takeIf { it >= 0 },
                        tension = if (revele) 1f else tension,
                        explosion = revele,
                        pointsPerdus = state.awards[p.holder]?.points?.takeIf { revele && it < 0 },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when {
                        p == null -> ""
                        revele -> "Toutes les autres équipes gagnent des points !"
                        else -> "Vite, envoyez la bombe à une autre équipe sur votre tablette !"
                    },
                    style = styleCentre(26.sp, Neon.OrClair),
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!state.paused) when {
                    revele -> NextButton("Voir les scores", actions.next, key = "patate-bilan-${state.index}")
                    // Sans régie, à la télécommande : la bombe part au hasard (tablette en panne).
                    state.regies == 0 && pret -> TvButton("🎲 Envoyer au hasard", actions.potatoRandom, fontSize = 22.sp)
                }
            }
        }
    }
}
