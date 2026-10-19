package com.littlemissparty.quiz.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.littlemissparty.quiz.tv.habillage.Neon

/**
 * Code de secours de la régie, pour un téléphone qui n'a pas le mot de passe commun :
 * sur la page des pupitres, « Accès régie » puis « Code affiché sur la TV ».
 * Fenêtre ouverte depuis le menu (bouton Retour), refermée dès qu'un téléphone est relié.
 */
@Composable
fun RegieDialog(state: UiState.Playing, onClose: () -> Unit, onRemove: () -> Unit) {
    val focus = remember { FocusRequester() }
    Dialog(onDismissRequest = onClose) {
        Row(
            Modifier
                .clip(RoundedCornerShape(32.dp))
                .background(Neon.Fond)
                .padding(40.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Code de secours de la régie", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Sur le téléphone : scannez le QR code de la partie, touchez « Accès régie »,\n" +
                        "puis « Code affiché sur la TV » et saisissez :",
                    color = Palette.InkSoft, fontSize = 20.sp,
                )
                Text(state.regiePin, color = Palette.Gold, fontSize = 64.sp, fontWeight = FontWeight.Black, letterSpacing = 12.sp)
                Text(
                    "Partie ${state.code} · " + when (state.regies) {
                        0 -> "aucune régie reliée"
                        1 -> "1 régie reliée"
                        else -> "${state.regies} régies reliées"
                    },
                    color = Palette.InkSoft, fontSize = 18.sp,
                )
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    TvButton("Fermer", onClose, Modifier.focusRequester(focus), primary = true)
                    if (state.regies > 0) TvButton("Retirer les régies", onRemove, accent = Palette.Pink, fontSize = 20.sp)
                }
            }
        }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    }
}
