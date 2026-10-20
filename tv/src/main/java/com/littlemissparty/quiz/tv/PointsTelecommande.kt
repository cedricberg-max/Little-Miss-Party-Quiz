package com.littlemissparty.quiz.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.littlemissparty.quiz.tv.habillage.Neon

/** Montants proposés à la télécommande : ceux du barème (bonne réponse, buzzer, mini-jeu), puis deux malus. */
val MONTANTS_TELECOMMANDE = listOf(50, 100, 150, 200, 300, -50, -100)

/** Texte d'un montant : « +100 », « −50 » (vrai signe moins, plus lisible sur la TV). */
fun montantTexte(delta: Int) = if (delta > 0) "+$delta" else "−${-delta}"

/**
 * « Donner des points » à la télécommande (menu Retour) : la fête continue sans Internet, les équipes
 * montrent leurs cartes A B C D et l'animatrice choisit les équipes, le montant, puis « Valider ».
 * Un malus ne fait jamais passer une équipe sous zéro (moteur). De 1 à 8 équipes, quatre par ligne.
 */
@Composable
fun PointsDialog(
    teams: List<Team>,
    scores: Map<String, Int>,
    onValidate: (List<String>, Int) -> Unit,
    onClose: () -> Unit,
) {
    val focus = remember { FocusRequester() }
    var chosen by remember { mutableStateOf(emptySet<String>()) }
    var amount by remember { mutableStateOf<Int?>(null) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .padding(horizontal = 40.dp, vertical = 16.dp)
                .widthIn(max = 1000.dp)
                .clip(RoundedCornerShape(32.dp))
                .background(Neon.Fond)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 36.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Compté pour 8 équipes sur une TV de 540 dp de haut : tout tient sans défiler.
            Text("Donner des points", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            if (teams.isEmpty()) {
                Text("Aucune équipe pour l'instant.", color = Color.White, fontSize = 22.sp)
            }
            teams.chunked(4).forEachIndexed { row, line ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    line.forEachIndexed { i, t ->
                        val on = t.uid in chosen
                        val first = row == 0 && i == 0
                        // Nom puis score sur deux lignes : tous les boutons ont la même hauteur, même aux noms longs.
                        TvButton(
                            (if (on) "✓ " else "") + "${t.name}\n${scores[t.uid] ?: 0} pts",
                            { chosen = if (on) chosen - t.uid else chosen + t.uid },
                            Modifier.weight(1f).let { if (first) it.focusRequester(focus) else it },
                            primary = on,
                            accent = t.color.toColor(),
                            fontSize = 18.sp,
                        )
                    }
                    // Dernière ligne incomplète : les boutons gardent la même largeur que ceux du dessus.
                    repeat(4 - line.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MONTANTS_TELECOMMANDE.forEach { d ->
                    TvButton(
                        montantTexte(d),
                        { amount = if (amount == d) null else d },
                        Modifier.weight(1f),
                        primary = amount == d,
                        accent = if (d > 0) Color(0xFF2EE86B) else Color(0xFFFF5A5F),
                        fontSize = 20.sp,
                    )
                }
            }
            val ready = chosen.isNotEmpty() && amount != null
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                TvButton(
                    if (ready) "Valider ${montantTexte(amount!!)} pour ${chosen.size} équipe${if (chosen.size > 1) "s" else ""}"
                    else "Choisissez les équipes, puis les points",
                    { if (ready) { onValidate(teams.map { it.uid }.filter { it in chosen }, amount!!); onClose() } },
                    Modifier.weight(2f),
                    primary = ready,
                    fontSize = 20.sp,
                )
                TvButton("Fermer", onClose, Modifier.weight(1f), fontSize = 20.sp)
            }
        }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    }
}
