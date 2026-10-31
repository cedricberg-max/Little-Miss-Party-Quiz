package com.littlemissparty.quiz.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.POTATO_BOOM_MS
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.habillage.TexteJauge
import com.littlemissparty.quiz.tv.habillage.AnnonceBombe
import com.littlemissparty.quiz.tv.habillage.MusiquePatate
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.ScenePatate
import com.littlemissparty.quiz.tv.habillage.styleCentre
import kotlinx.coroutines.delay

/*
 * « Ça va exploser ! » sur la TV. L'écran ne décide rien : la box allume la mèche (durée tirée au sort, jamais
 * affichée), les tablettes envoient la bombe, la partie la fait exploser. Ici : la scène de la bombe
 * (habillage/Patate.kt) avec une tension qui monte d'après le temps de mèche écoulé, puis l'explosion. Plusieurs bombes
 * par partie (3 d'office, de 1 à 6 réglé dans la Régie PC) : après chaque explosion sauf la dernière, « Bombe 2 sur 3 »,
 * et la nouvelle bombe part. Une équipe qui garde
 * la bombe plus de 2 secondes la voit exploser chez elle (le bas de l'écran compte 2, 1) ; elle peut la renvoyer dès la
 * réception (cedric, 27/10).
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
    // La dernière explosion : jouée tant que la bombe suivante n'est pas allumée, et le temps de l'animation.
    val boom = p?.booms?.lastOrNull()
    val explosion = p != null && boom != null && (revele || p.exploded || maintenant < boom.at + POTATO_BOOM_MS)
    // La bombe suivante est allumée mais pas encore partie : « Bombe 2 sur 3 ».
    val annonce = p != null && !explosion && p.bomb > 1 && maintenant < p.since
    val porteur = joueuses.indexOfFirst { it.uid == (if (explosion) boom?.holder else p?.holder) }
    val pret = p != null && !p.exploded && maintenant >= p.readyAt && (state.resumeAt ?: 0L) <= maintenant
    // Anti-triche : 2 secondes pour l'envoyer, sinon elle explose chez l'équipe qui la garde (2, 1 aussi sur sa tablette).
    val secondes = state.holdUntil?.takeIf { pret }?.let { ((it - maintenant + 999) / 1000).coerceIn(1, 2) }
    // La musique du jeu suit la mèche et finit pile sur l'explosion (habillage).
    MusiquePatate(state.deadline, state.resumeAt ?: 0L, state.serverOffset, brule = p != null && !p.exploded && !explosion && !annonce && !revele && !state.paused)

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (p == null || porteur < 0) {
                    Text(
                        if (state.teams.size < 2) "Il faut au moins 2 équipes pour « Ça va exploser ! »" else "La mèche s'allume…",
                        style = styleCentre(40.sp, Neon.OrClair),
                    )
                } else {
                    ScenePatate(
                        equipes = joueuses.map { it.name to it.color.toColor() },
                        porteur = porteur,
                        precedent = joueuses.indexOfFirst { it.uid == p.from }.takeIf { it >= 0 && !explosion },
                        tension = if (explosion) 1f else tension,
                        explosion = explosion,
                        pointsPerdus = boom?.lost?.takeIf { explosion && it > 0 }?.let { -it },
                        modifier = Modifier.fillMaxSize(),
                        // Équipes que la bombe n'a pas encore touchées : elles scintillent.
                        neuves = joueuses.indices.filter { joueuses[it].uid !in p.hit }.toSet(),
                        // « Bombe 2 sur 3 » : pas de « La bombe est chez … » en même temps.
                        bandeau = !annonce,
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
                // Posé sur le décor « comme les jauges » (n° 24 du 31/10).
                TexteJauge(
                    when {
                        p == null -> ""
                        explosion && boom?.held == true -> "Gardée plus de 2 secondes ! Toutes les autres équipes gagnent ${boom?.gain ?: 0} points !"
                        explosion -> "Toutes les autres équipes gagnent ${boom?.gain ?: 0} points !"
                        annonce -> "Attention, une nouvelle bombe arrive !"
                        secondes != null -> "Vite, envoyez la bombe ! Elle explose dans $secondes…"
                        else -> "Vite, envoyez la bombe à une autre équipe sur votre tablette !"
                    },
                    style = styleCentre(26.sp, Neon.OrClair),
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!state.paused) when {
                    revele -> NextButton(versClassement(state, "Voir les scores"), actions.next, key = "patate-bilan-${state.index}")
                    explosion || annonce -> {}
                    // Sans régie, à la télécommande : la bombe part au hasard (tablette en panne).
                    state.regies == 0 && pret -> TvButton("🎲 Envoyer au hasard", actions.potatoRandom, fontSize = 22.sp)
                }
            }
        }
        // Quelle bombe joue : petit compteur en haut à gauche, au-dessus de la mèche.
        if (p != null && !revele && p.total > 1) {
            Text(
                "💣 Bombe ${p.bomb} sur ${p.total}", maxLines = 1,
                style = styleCentre(20.sp, Neon.OrClair),
                modifier = Modifier.align(Alignment.TopStart).padding(start = 24.dp, top = 16.dp)
                    .background(Neon.Nuit2.copy(alpha = 0.88f), RoundedCornerShape(50)).border(2.dp, Neon.Or, RoundedCornerShape(50))
                    .padding(horizontal = 14.dp, vertical = 4.dp),
            )
        }
        if (annonce) key(p?.bomb) { AnnonceBombe(p!!.bomb, p.total, Modifier.fillMaxSize()) }
    }
}
