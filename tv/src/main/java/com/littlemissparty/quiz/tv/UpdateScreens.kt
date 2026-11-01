package com.littlemissparty.quiz.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.littlemissparty.quiz.engine.Release
import java.util.Locale
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.PoliceLmp

class UpdateActions(
    val search: () -> Unit,
    val download: () -> Unit,
    val cancelDownload: () -> Unit,
    val install: () -> Unit,
    /** Faux si la box n'a pas l'écran de réglage attendu. */
    val openPermission: () -> Boolean,
    val close: () -> Unit,
    /** Fenêtre de proposition : « Installer maintenant » et « Plus tard ». */
    val acceptOffer: () -> Unit = {},
    val declineOffer: () -> Unit = {},
)

/** Partie en cours (équipes déjà là ou question jouée) : aucune mise à jour pendant une prestation. */
fun gameInProgress(state: UiState): Boolean = state is UiState.ResumeOffer || state is UiState.TakingOver ||
    (state is UiState.Playing && when (state.phase) {
        com.littlemissparty.quiz.engine.Phase.ENDED -> false
        com.littlemissparty.quiz.engine.Phase.LOBBY -> state.teams.isNotEmpty()
        else -> true
    })

/**
 * « Rechercher une mise à jour » demandé à la main : refusé seulement pendant une prestation en route (une question
 * jouée, des scores…), jamais au salon, même avec des équipes déjà là, ni sur l'écran « Reprendre » (cedric, 31/10 :
 * une page fantôme restée ouverte rejoignait chaque nouvelle partie, et la box refusait la mise à jour).
 */
fun manualUpdateBlocked(state: UiState): Boolean =
    state is UiState.Playing && state.phase != com.littlemissparty.quiz.engine.Phase.LOBBY && state.phase != com.littlemissparty.quiz.engine.Phase.ENDED

private fun mb(bytes: Long) = String.format(Locale.FRANCE, "%.1f Mo", bytes / 1_048_576.0)

/** Fenêtre « Rechercher une mise à jour », entièrement utilisable à la télécommande. */
@Composable
fun UpdateDialog(ui: UpdateUi, busy: Boolean, actions: UpdateActions) {
    val focus = remember { FocusRequester() }
    Dialog(onDismissRequest = actions.close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .padding(horizontal = 40.dp, vertical = 16.dp)
                .widthIn(max = 760.dp)
                .clip(RoundedCornerShape(32.dp))
                .background(Neon.Fond)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 36.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Mise à jour de l'appli", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Bold)
            Text("Version installée : ${BuildConfig.VERSION_NAME}", color = Palette.InkSoft, fontSize = 18.sp)
            val release = releaseOf(ui)
            if (busy && ui !is UpdateUi.Installing) {
                Body(
                    (release?.let { "La version ${it.versionName} est disponible. " } ?: "") +
                        "Une partie est en cours : la mise à jour se fera après la partie, " +
                        "pour ne jamais couper une prestation.",
                )
                Buttons { Primary("Fermer", actions.close, focus) }
            } else {
                Content(ui, actions, focus)
            }
        }
        LaunchedEffect(ui::class) { runCatching { focus.requestFocus() } }
    }
}

/**
 * Proposition faite d'elle-même par la box, à l'accueil seulement (jamais pendant une partie).
 * Retour vaut « Plus tard ».
 */
@Composable
fun UpdateOfferDialog(release: Release, actions: UpdateActions) {
    val focus = remember { FocusRequester() }
    // Pleine largeur utile et défilement de secours : sur une TV de 540 dp de haut, avec une longue
    // description, « Installer maintenant » doit rester visible (il était coupé en 0.1.414).
    Dialog(onDismissRequest = actions.declineOffer, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .padding(horizontal = 40.dp, vertical = 16.dp)
                .widthIn(max = 820.dp)
                .clip(RoundedCornerShape(32.dp))
                .background(Brush.verticalGradient(listOf(Neon.FondHaut, Neon.Fond)))
                .border(2.dp, Brush.horizontalGradient(listOf(OfferHalo, Palette.Gold, OfferHalo)), RoundedCornerShape(32.dp))
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 40.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("✨ LITTLE MISS PARTY QUIZ ✨", color = OfferHalo, fontSize = 18.sp, fontWeight = FontWeight.Black, letterSpacing = 6.sp)
            Text(
                "Une nouvelle version est prête !",
                style = TextStyle(
                    fontFamily = PoliceLmp, color = Palette.Gold, fontSize = 34.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    shadow = Shadow(Palette.Gold.copy(alpha = 0.6f), blurRadius = 18f),
                ),
            )
            Text(
                "Version ${release.versionName} (installée : ${BuildConfig.VERSION_NAME}), ${mb(release.size)}",
                color = Palette.InkSoft, fontSize = 18.sp,
            )
            if (release.notes.isNotBlank()) {
                Text(
                    release.notes, color = Color.White, fontSize = 18.sp, textAlign = TextAlign.Center,
                    maxLines = 3, overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                "Les parties, réglages et codes sont conservés. Android demandera de confirmer l'installation.",
                color = Palette.InkSoft, fontSize = 18.sp, textAlign = TextAlign.Center,
            )
            Buttons {
                Primary("Installer maintenant", actions.acceptOffer, focus)
                Secondary("Plus tard", actions.declineOffer)
            }
        }
        LaunchedEffect(release.versionCode) { runCatching { focus.requestFocus() } }
    }
}

private val OfferHalo = Color(0xFFF888B3)

private fun releaseOf(ui: UpdateUi): Release? = when (ui) {
    is UpdateUi.Available -> ui.release
    is UpdateUi.Downloading -> ui.release
    is UpdateUi.Verifying -> ui.release
    is UpdateUi.Ready -> ui.release
    is UpdateUi.NeedsPermission -> ui.release
    is UpdateUi.Installing -> ui.release
    is UpdateUi.Failed -> ui.release
    else -> null
}

@Composable
private fun Content(ui: UpdateUi, actions: UpdateActions, focus: FocusRequester) {
    when (ui) {
        UpdateUi.Idle, UpdateUi.Checking -> {
            Waiting("Recherche d'une nouvelle version…")
            Buttons { Primary("Fermer", actions.close, focus) }
        }
        UpdateUi.UpToDate -> {
            Body("L'appli est à jour.")
            Buttons {
                Primary("Fermer", actions.close, focus)
                Secondary("Vérifier à nouveau", actions.search)
            }
        }
        is UpdateUi.Available -> {
            Body("Nouvelle version ${ui.release.versionName} disponible (${mb(ui.release.size)}).")
            Notes(ui.release)
            Buttons {
                Primary("Télécharger la mise à jour", actions.download, focus)
                Secondary("Plus tard", actions.close)
            }
        }
        is UpdateUi.Downloading -> {
            val p = (ui.done.toFloat() / ui.release.size).coerceIn(0f, 1f)
            Body("Téléchargement de la version ${ui.release.versionName}… ${(p * 100).toInt()} %")
            LinearProgressIndicator(progress = { p }, color = Palette.Gold, trackColor = Palette.Panel, modifier = Modifier.fillMaxWidth().height(12.dp))
            Text("${mb(ui.done)} sur ${mb(ui.release.size)}", color = Palette.InkSoft, fontSize = 18.sp)
            // Wi-Fi faible : on dit ce qui se passe au lieu de rester figé (cedric, 31/10 : bloqué à 0 %).
            if (ui.essai > 0) {
                Text(
                    "Connexion faible (${ui.raison ?: "coupure"}) : nouvel essai ${ui.essai + 1} sur ${UpdateViewModel.ESSAIS_TELECHARGEMENT}, " +
                        "le téléchargement reprend là où il s'est arrêté.",
                    color = Palette.Gold, fontSize = 18.sp,
                )
            }
            Buttons { Secondary("Annuler", actions.cancelDownload, focus) }
        }
        is UpdateUi.Verifying -> {
            Waiting("Vérification de la mise à jour (signature, appli, version)…")
        }
        is UpdateUi.Ready -> {
            Body(
                "La version ${ui.release.versionName} est prête et vérifiée. Android va demander de confirmer " +
                    "l'installation : choisissez « Mettre à jour » ou « Installer ». Les parties, réglages et codes sont conservés.",
            )
            Buttons {
                Primary("Installer la mise à jour", actions.install, focus)
                Secondary("Plus tard", actions.close)
            }
        }
        is UpdateUi.NeedsPermission -> {
            Body(
                "Android doit autoriser Little Miss Party Quiz à installer ses mises à jour. " +
                    "C'est à faire une seule fois.",
            )
            Text(
                "Si le bouton n'ouvre rien : Paramètres › Préférences de l'appareil › Sécurité et restrictions › " +
                    "Sources inconnues › Little Miss Party Quiz.",
                color = Palette.InkSoft, fontSize = 18.sp,
            )
            Buttons {
                Primary("Ouvrir le réglage Android", { actions.openPermission() }, focus)
                Secondary("J'ai autorisé : installer", actions.install)
            }
        }
        is UpdateUi.Installing -> {
            Waiting("Confirmez l'installation sur l'écran d'Android. L'appli redémarre ensuite toute seule.")
            Buttons { Secondary("Fermer", actions.close, focus) }
        }
        is UpdateUi.Failed -> {
            Text(ui.message, color = Palette.Pink, fontSize = 22.sp)
            Buttons {
                Primary("Réessayer", if (ui.release == null) actions.search else actions.download, focus)
                Secondary("Fermer", actions.close)
            }
        }
    }
}

@Composable
private fun Body(text: String) = Text(text, color = Color.White, fontSize = 22.sp)

@Composable
private fun Notes(r: Release) {
    if (r.notes.isNotBlank()) Text("Contenu : ${r.notes}", color = Palette.InkSoft, fontSize = 18.sp)
}

@Composable
private fun Waiting(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(color = Color.White)
        Spacer(Modifier.width(20.dp))
        Body(text)
    }
}

@Composable
private fun Buttons(content: @Composable () -> Unit) {
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { content() }
}

@Composable
private fun Primary(label: String, onClick: () -> Unit, focus: FocusRequester) {
    TvButton(label, onClick, Modifier.focusRequester(focus), primary = true)
}

@Composable
private fun Secondary(label: String, onClick: () -> Unit, focus: FocusRequester? = null) {
    TvButton(label, onClick, if (focus != null) Modifier.focusRequester(focus) else Modifier, fontSize = 20.sp)
}
