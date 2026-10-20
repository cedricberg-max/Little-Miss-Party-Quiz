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
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.BOMB_ALERT_MS
import com.littlemissparty.quiz.engine.CHEST_SHOW_MS
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.habillage.AlerteBombe
import com.littlemissparty.quiz.tv.habillage.BilanBombe
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.OuvertureCoffre
import com.littlemissparty.quiz.tv.habillage.SceneCoffres
import com.littlemissparty.quiz.tv.habillage.styleCentre
import kotlinx.coroutines.delay

/*
 * La bombe cachée sur la TV. L'écran ne décide rien : les coffres sont choisis sur les tablettes et leur contenu est
 * tiré par la partie à l'ouverture. Ici : la scène des coffres (habillage/BombeCachee.kt), l'ouverture du dernier
 * coffre, l'annonce de la bombe, puis le bilan. Les animations se calent sur l'heure du serveur : une box qui se
 * reconnecte après coup ne les rejoue pas.
 */

/** Heure du serveur, rafraîchie plusieurs fois par seconde pour caler animations et boutons. */
@Composable
private fun heureServeur(offset: Long): Long {
    val t by produceState(System.currentTimeMillis() + offset, offset) {
        while (true) {
            value = System.currentTimeMillis() + offset
            delay(200)
        }
    }
    return t
}

@Composable
fun CoffresScreen(state: UiState.Playing, actions: TvActions) {
    val r = state.coffres
    val maintenant = heureServeur(state.serverOffset)
    val equipe = { uid: String? -> state.teams.find { it.uid == uid } }
    val dernier = r?.opened?.lastOrNull()
    // Ouverture en cours (le dernier coffre, pendant son animation), puis l'annonce de la bombe juste après le
    // dernier tour sans danger.
    val ouverture = dernier?.takeIf { maintenant < it.at + CHEST_SHOW_MS }
    val alerte = r != null && dernier != null && r.turn == r.safe && !r.exploded &&
        maintenant >= dernier.at + CHEST_SHOW_MS && maintenant < dernier.at + CHEST_SHOW_MS + BOMB_ALERT_MS
    val bilan = r != null && r.exploded && ouverture == null

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                when {
                    r == null -> Text("Les coffres arrivent…", style = styleCentre(40.sp, Neon.OrClair))
                    bilan -> BilanBombe(
                        state.teams.map { Triple(it.name, it.color.toColor(), r.gains()[it.uid] ?: 0) }.sortedByDescending { it.third },
                        Modifier.fillMaxSize(),
                    )
                    else -> SceneCoffres(
                        nombre = r.count,
                        // Le coffre qu'on ouvre garde son mystère dans la scène jusqu'à la fin de son animation.
                        ouverts = r.opened.filter { it !== ouverture }.associate { it.chest to (if (it.bomb) null else it.delta) },
                        auTour = equipe(r.team)?.let { it.name to it.color.toColor() },
                        phaseDanger = r.danger && !r.exploded,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when {
                        r == null || r.exploded -> ""
                        r.danger -> "💣 La bombe peut être dans n'importe quel coffre !"
                        else -> "Encore ${r.safe - r.turn} coffre${if (r.safe - r.turn > 1) "s" else ""} sans danger"
                    },
                    style = styleCentre(26.sp, Neon.OrClair),
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!state.paused) when {
                    state.phase == Phase.REVEAL -> NextButton("Voir les scores", actions.next, key = "coffres-bilan-${state.index}")
                    // Sans régie, à la télécommande : un coffre au hasard pour l'équipe qui joue (tablette en panne).
                    r?.team != null && state.regies == 0 && maintenant >= r.readyAt ->
                        TvButton("🎲 Coffre au hasard", actions.chestRandom, fontSize = 22.sp)
                }
            }
        }
        if (ouverture != null) key(ouverture.at, ouverture.chest) {
            val e = equipe(ouverture.team)
            OuvertureCoffre(
                index = ouverture.chest,
                delta = if (ouverture.bomb) null else ouverture.delta,
                equipe = e?.name ?: "",
                couleur = e?.color?.toColor() ?: Color.White,
                onFini = {},
                modifier = Modifier.fillMaxSize(),
            )
        }
        if (alerte) key(dernier?.at) { AlerteBombe(onFini = {}, modifier = Modifier.fillMaxSize()) }
    }
}
