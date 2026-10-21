package com.littlemissparty.quiz.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.littlemissparty.quiz.tv.habillage.Neon
import java.util.Locale

/** Ce que « Vider le cache des médias » efface, et ce qui ne bouge pas. */
const val TEXTE_VIDAGE_CACHE = "Les musiques et les photos gardées sur la box seront effacées. " +
    "Elles seront retéléchargées automatiquement (Internet nécessaire). " +
    "Les prestations, les scores et les réglages ne sont pas touchés."

/** Place libérée, lisible de loin : « 312 Mo », « 48 Ko ». */
private fun tailleTexte(octets: Long): String =
    if (octets >= 1_048_576) String.format(Locale.FRANCE, "%.0f Mo", octets / 1_048_576.0) else "${(octets + 1023) / 1024} Ko"

/**
 * « Vider le cache des médias » (menu Retour), entièrement à la télécommande : « Annuler » a la sélection, rien ne
 * s'efface sans un second choix. [raison] : pourquoi ce n'est pas possible maintenant (null si c'est possible) ;
 * [vidage] : où en est la demande, une fois faite depuis cette fenêtre. Retour vaut « Annuler » ou « Fermer ».
 */
@Composable
fun ViderCacheDialog(raison: String?, vidage: VidageCache, onVider: () -> Unit, onClose: () -> Unit) {
    // Une demande précédente (fenêtre fermée puis rouverte) ne s'affiche pas : on repart de la question.
    var demande by remember { mutableStateOf(false) }
    val annuler = remember { FocusRequester() }
    val fermer = remember { FocusRequester() }
    val question = !demande && raison == null
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        // Même cadre que le menu Retour ; si l'écran est trop petit, la fenêtre défile et rien n'est coupé.
        Column(
            Modifier
                .padding(horizontal = 48.dp, vertical = 27.dp)
                .widthIn(max = 720.dp)
                .clip(RoundedCornerShape(32.dp))
                .background(Neon.Fond)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 44.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "Vider le cache des médias ?", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            val message = when {
                question -> TEXTE_VIDAGE_CACHE
                !demande -> raison.orEmpty()
                else -> when (vidage) {
                    is VidageCache.Fait ->
                        if (vidage.effacement.fichiers == 0) "Le cache était déjà vide. La partie continue normalement."
                        else "Cache vidé : ${tailleTexte(vidage.effacement.octets)} libérés. " +
                            "Les musiques et les photos de la partie se retéléchargent toutes seules."
                    is VidageCache.Refuse -> vidage.raison
                    VidageCache.Echec -> "Le cache n'a pas pu être entièrement vidé. La partie continue normalement."
                    VidageCache.EnCours, VidageCache.Pret -> "Effacement en cours…"
                }
            }
            Text(
                message,
                color = if (question) Color.White.copy(alpha = 0.85f) else Palette.Gold,
                fontSize = 22.sp, textAlign = TextAlign.Center,
            )
            if (question) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    TvButton("Annuler", onClose, Modifier.weight(1f).focusRequester(annuler), primary = true, fontSize = 20.sp)
                    TvButton("Vider le cache", { demande = true; onVider() }, Modifier.weight(1f), accent = Palette.Pink, fontSize = 20.sp)
                }
            } else {
                TvButton("Fermer", onClose, Modifier.fillMaxWidth().focusRequester(fermer), primary = true, fontSize = 20.sp)
            }
        }
        // La sélection suit la fenêtre : « Annuler » pour la question, « Fermer » pour une réponse.
        LaunchedEffect(question) { runCatching { (if (question) annuler else fermer).requestFocus() } }
    }
}
