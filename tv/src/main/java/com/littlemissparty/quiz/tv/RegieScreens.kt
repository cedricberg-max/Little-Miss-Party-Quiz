package com.littlemissparty.quiz.tv

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.littlemissparty.quiz.tv.habillage.Neon

/**
 * « Reconnecter la régie » (menu Retour) : un QR code qui ouvre directement l'accès régie sur le téléphone,
 * où l'animatrice tape le mot de passe de la régie. Le code à 4 chiffres reste en petit, en dernier recours
 * (téléphone qui n'a pas le mot de passe). Fenêtre refermée dès qu'un téléphone est relié.
 */
@Composable
fun RegieDialog(state: UiState.Playing, onClose: () -> Unit, onRemove: () -> Unit) {
    val focus = remember { FocusRequester() }
    val qr = remember(state.joinUrl) { qrCode("${state.joinUrl}&regie=1") }
    FenetreQr(
        onClose = onClose,
        titre = "Reconnecter la régie",
        consigne = "Scannez avec le téléphone de la régie,\npuis entrez le mot de passe de la régie.",
        qr = qr,
        description = "QR code de la régie",
    ) {
        Text(
            when (state.regies) {
                0 -> "Aucune régie reliée"
                1 -> "1 régie reliée"
                else -> "${state.regies} régies reliées"
            },
            color = Palette.InkSoft, fontSize = 18.sp,
        )
        Text(
            "Sans mot de passe : « Code affiché sur la TV » puis ${state.regiePin}",
            color = Palette.InkSoft.copy(alpha = 0.75f), fontSize = 15.sp,
        )
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            TvButton("Fermer", onClose, Modifier.focusRequester(focus), primary = true)
            if (state.regies > 0) TvButton("Retirer les régies", onRemove, accent = Palette.Pink, fontSize = 20.sp)
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

/**
 * « Reconnecter une tablette » (menu Retour) : la nouvelle tablette scanne le QR code et touche l'équipe
 * qu'elle reprend ; l'animatrice confirme ici à la télécommande. L'équipe garde son nom, sa couleur et
 * ses points (ils appartiennent à l'équipe, pas à la tablette) ; l'ancienne tablette ne joue plus.
 */
@Composable
fun TabletteDialog(state: UiState.Playing, onClose: () -> Unit, onConfier: (String, String) -> Unit) {
    val focus = remember { FocusRequester() }
    val lien = lienPupitre("${state.joinUrl}&reprise=1")
    val qr = remember(lien) { qrCode(lien) }
    val demandes = state.requests.filter { r -> r.replace != null && state.teams.any { it.uid == r.replace } }
    FenetreQr(
        onClose = onClose,
        titre = "Reconnecter une tablette",
        consigne = "Scannez avec la nouvelle tablette et touchez le nom de l'équipe.\nElle garde son nom, sa couleur et ses points.",
        qr = qr,
        description = "QR code pour reprendre une équipe",
    ) {
        if (demandes.isEmpty()) {
            Text("En attente de la nouvelle tablette…", color = Palette.InkSoft, fontSize = 18.sp)
        }
        demandes.forEachIndexed { i, r ->
            val equipe = state.teams.first { it.uid == r.replace }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(18.dp).clip(CircleShape).background(equipe.color.toColor()))
                Spacer(Modifier.width(10.dp))
                TvButton(
                    "Confier « ${equipe.name} » à la nouvelle tablette",
                    { onConfier(r.device, equipe.uid) },
                    if (i == 0) Modifier.focusRequester(focus) else Modifier,
                    primary = true, fontSize = 20.sp,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        TvButton("Fermer", onClose, if (demandes.isEmpty()) Modifier.focusRequester(focus) else Modifier)
    }
    // Une demande qui arrive prend la sélection : l'animatrice n'a plus qu'à appuyer sur OK.
    LaunchedEffect(demandes.firstOrNull()?.device) { runCatching { focus.requestFocus() } }
}

/** Fenêtre commune : QR code à gauche, titre, consigne et actions à droite ; défile si l'écran est petit. */
@Composable
private fun FenetreQr(
    onClose: () -> Unit,
    titre: String,
    consigne: String,
    qr: ImageBitmap,
    description: String,
    contenu: @Composable () -> Unit,
) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Row(
            Modifier
                .padding(horizontal = 48.dp, vertical = 27.dp)
                .widthIn(max = 1000.dp)
                .clip(RoundedCornerShape(32.dp))
                .background(Neon.Fond)
                .padding(36.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.clip(RoundedCornerShape(20.dp)).background(Color.White).padding(14.dp)) {
                Image(qr, contentDescription = description, modifier = Modifier.size(260.dp))
            }
            Spacer(Modifier.width(32.dp))
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(titre, color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(consigne, color = Palette.InkSoft, fontSize = 20.sp)
                contenu()
            }
        }
    }
}
