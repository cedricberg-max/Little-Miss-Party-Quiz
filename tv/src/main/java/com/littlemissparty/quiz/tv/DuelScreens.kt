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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.BandeauDuel
import com.littlemissparty.quiz.tv.habillage.EquipeDuel
import com.littlemissparty.quiz.tv.habillage.EtapeDuel
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.Ordre
import com.littlemissparty.quiz.tv.habillage.SceneDuel
import com.littlemissparty.quiz.tv.habillage.Son
import com.littlemissparty.quiz.tv.habillage.Sons
import com.littlemissparty.quiz.tv.habillage.montageDuel
import com.littlemissparty.quiz.tv.habillage.planDuelA
import com.littlemissparty.quiz.tv.habillage.styleCentre
import kotlinx.coroutines.delay

/*
 * 🤠 Le Duel des robots sur la TV (cedric, 27/10). L'écran ne décide rien : la box prépare chaque duel (« la ronde »),
 * tire l'heure du PAN et juge les buzz. Ici : le duel prêt (les 2 équipes, le joueur appelé de chaque), le face-à-face
 * avec ses feintes, le PAN pile à son heure, puis la gagnante (ou le tir trop tôt, ou personne).
 */

/** Temps de réaction affiché : « 0,31 s ». */
internal fun tempsDuel(ms: Long): String = "%d,%02d s".format(ms / 1000, (ms % 1000) / 10)

/** Étape du duel à l'écran d'après l'état de la box ; [pan] : l'heure du PAN est passée. */
internal fun etapeDuel(duel: com.littlemissparty.quiz.engine.DuelRound?, equipes: Int, pan: Boolean): EtapeDuel {
    val r = duel?.result
    return when {
        duel == null || equipes < 2 -> EtapeDuel.ATTENTE
        r != null && r.early != null -> EtapeDuel.TROP_TOT
        r != null && r.winner != null -> EtapeDuel.GAGNE
        r != null -> EtapeDuel.PERSONNE
        duel.startAt != null && pan -> EtapeDuel.PAN
        duel.startAt != null -> EtapeDuel.FACE
        else -> EtapeDuel.PRET
    }
}

@Composable
fun DuelScreen(state: UiState.Playing, actions: TvActions) {
    val d = state.duel
    val joueuses = d?.teams.orEmpty().mapNotNull { uid -> state.teams.find { it.uid == uid } }
    val startAt = d?.startAt
    val panAt = d?.panAt
    // Le PAN claque à son heure exacte (heure du serveur), pas au prochain rafraîchissement.
    val pan by produceState(false, startAt, panAt, state.serverOffset) {
        value = false
        if (startAt == null || panAt == null) return@produceState
        val attente = panAt - (System.currentTimeMillis() + state.serverOffset)
        if (attente > 0) delay(attente)
        value = true
    }
    val ecoule by produceState(0L, startAt, state.serverOffset) {
        value = 0L
        if (startAt == null) return@produceState
        while (true) {
            value = System.currentTimeMillis() + state.serverOffset - startAt
            delay(100)
        }
    }
    val etape = etapeDuel(d, joueuses.size, pan)
    val montage = remember(startAt, panAt) {
        if (startAt == null || panAt == null) emptyList() else montageDuel(panAt - startAt, (startAt xor panAt).toInt())
    }
    val plan = if (etape == EtapeDuel.FACE) planDuelA(montage, ecoule) else null
    val r = d?.result
    val cote = { uid: String? -> d?.teams?.indexOf(uid)?.takeIf { it >= 0 } }
    val gagnante = cote(r?.winner)
    val perdante = cote(r?.early ?: r?.loser)
    val nom = { uid: String? -> state.teams.find { it.uid == uid }?.name ?: "Une équipe" }
    val cle = "${d?.n}-$startAt-${r?.at}"

    // Les sons du duel : le face-à-face commence, chaque feinte, le PAN, le résultat. Jamais rejoués après coup
    // (écran recomposé, box redémarrée) : seulement s'ils tombent maintenant.
    val maintenant = { System.currentTimeMillis() + state.serverOffset }
    LaunchedEffect(startAt) { if (startAt != null && r == null && maintenant() - startAt < 1_500) jouer(Son.DUEL_FACE) }
    LaunchedEffect(plan) { if (plan?.feinte == true && startAt != null && maintenant() - startAt - plan.debutMs < 800) jouer(Son.DUEL_FEINTE) }
    LaunchedEffect(etape == EtapeDuel.PAN) { if (etape == EtapeDuel.PAN && panAt != null && maintenant() - panAt < 800) jouer(Son.DUEL_PAN) }
    LaunchedEffect(r?.at) {
        if (r == null || maintenant() - r.at > 2_000) return@LaunchedEffect
        jouer(
            when {
                r.early != null -> Son.DUEL_TROP_TOT
                r.winner != null -> Son.DUEL_VICTOIRE
                else -> Son.RATE
            },
        )
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (etape == EtapeDuel.ATTENTE) {
                    Text(
                        if (state.teams.size < 2) "Il faut au moins 2 équipes pour le Duel des robots" else "Les robots arrivent…",
                        style = styleCentre(40.sp, Neon.OrClair),
                    )
                } else {
                    SceneDuel(
                        equipes = joueuses.mapIndexed { i, t -> EquipeDuel(t.name, t.color.toColor(), d?.players?.getOrNull(i) ?: 1) },
                        etape = etape,
                        gagnante = gagnante,
                        perdante = perdante,
                        plan = plan,
                        cle = cle,
                        modifier = Modifier.fillMaxSize(),
                    )
                    val couleur = joueuses.getOrNull(gagnante ?: -1)?.color?.toColor() ?: Neon.OrClair
                    when (etape) {
                        EtapeDuel.GAGNE -> BandeauDuel(
                            "${nom(r?.winner)} remporte le duel !",
                            listOfNotNull(r?.ms?.let { "en ${tempsDuel(it)}" }, r?.points?.takeIf { it > 0 }?.let { "+$it points" }).joinToString(" · ").ifBlank { null },
                            couleur, cle, Modifier.align(Alignment.TopCenter).padding(top = 30.dp),
                        )
                        EtapeDuel.TROP_TOT -> BandeauDuel(
                            "${nom(r?.early)} a buzzé trop tôt…",
                            "${nom(r?.winner)} gagne le duel !" + (r?.points?.takeIf { it > 0 }?.let { " +$it points" } ?: ""),
                            couleur, cle, Modifier.align(Alignment.TopCenter).padding(top = 30.dp),
                        )
                        EtapeDuel.PERSONNE -> BandeauDuel("Personne n'a tiré !", "Pas de points pour ce duel", if (Look.gs) GS.Cyan else Neon.OrClair, cle, Modifier.align(Alignment.TopCenter).padding(top = 30.dp))
                        else -> {}
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (etape) {
                        EtapeDuel.PRET -> "Les deux joueurs, la main au-dessus du buzzer !"
                        EtapeDuel.FACE -> "Pas avant le PAN ! Le premier qui buzze après le PAN gagne"
                        else -> ""
                    },
                    style = styleCentre(26.sp, Neon.OrClair),
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                // Sans régie, à la télécommande : OK lance le duel, puis prépare le suivant (ou passe aux scores).
                if (!state.paused && state.regies == 0) when (etape) {
                    EtapeDuel.ATTENTE -> if (state.teams.size < 2) NextButton(versClassement(state, "Voir les scores"), actions.next, key = "duel-seul-${state.index}")
                    EtapeDuel.PRET -> NextButton("🤠 Lancer le duel", actions.next, key = "duel-pret-$cle")
                    EtapeDuel.GAGNE, EtapeDuel.TROP_TOT, EtapeDuel.PERSONNE ->
                        if (state.duelTousPasses) NextButton(versClassement(state, "Voir les scores"), actions.next, key = "duel-fin-$cle")
                        else NextButton("Duel suivant", actions.next, key = "duel-suivant-$cle")
                    else -> {}
                }
            }
        }
        // Quel duel : petit compteur en haut à gauche.
        if (d != null && etape != EtapeDuel.ATTENTE) {
            Text(
                if (d.extra || d.n > state.duelTotal) "🤠 Duel en plus" else "🤠 Duel ${d.n} sur ${state.duelTotal}", maxLines = 1,
                style = styleCentre(20.sp, Neon.OrClair),
                modifier = Modifier.align(Alignment.TopStart).padding(start = 24.dp, top = 16.dp)
                    .background(Neon.Nuit2.copy(alpha = 0.88f), RoundedCornerShape(50)).border(2.dp, Neon.Or, RoundedCornerShape(50))
                    .padding(horizontal = 14.dp, vertical = 4.dp),
            )
        }
    }
}

private fun jouer(s: Son) = Sons.executer(listOf(Ordre.Jouer(s)))
