package com.littlemissparty.quiz.tv

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.littlemissparty.quiz.tv.habillage.GS

/**
 * Accueil du design « The Game Show » : l'écran d'attente des invités reste neutre (cedric, 24 octobre). Le robot dort
 * sur le plateau (la vidéo du décor, qui tourne seule, sans calage sur Get Lucky) ; seul le petit QR des tablettes
 * reste discret en bas à droite, sans le code de la partie (cedric, 24/10 : il est dans le menu Retour). Les équipes
 * et « Lancer la fête ! » sont sur le téléphone de l'animatrice ; à la télécommande, « Lancer la fête ! » est dans le
 * menu Retour. Ce que l'écran ne montre plus (enfant fêté, équipes
 * arrivées) reste dans sa description, lue par les lecteurs d'écran et par les tests sur émulateur.
 */
@Composable
internal fun LobbyGameShow(state: UiState.Playing) {
    val lien = lienPupitre(state.joinUrl)
    val qr = remember(lien) { qrCode(lien) }
    val description = listOfNotNull(
        when {
            state.childName.isNotBlank() -> "Joyeux anniversaire ${state.childName} !"
            state.title.isNotBlank() -> state.title
            else -> null
        },
        when {
            state.teams.isEmpty() -> "En attente des équipes…"
            state.teams.size >= GameViewModel.MAX_TEAMS -> "${state.teams.size} équipes : la partie est complète"
            else -> "${state.teams.size} équipe(s) dans la partie"
        },
        state.teams.joinToString(", ") { it.name }.takeIf { it.isNotBlank() },
    ).joinToString(" · ")
    Box(
        Modifier.fillMaxSize().semantics { contentDescription = description }.padding(end = 28.dp, bottom = 24.dp),
        contentAlignment = Alignment.BottomEnd,
    ) {
        Column(Modifier.verreNeon(GS.Rose, 18.dp).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            // Fond blanc : les tablettes le lisent mieux. Assez grand pour un appareil photo à un ou deux mètres.
            Box(Modifier.size(112.dp).background(Color.White, RoundedCornerShape(10.dp)).padding(6.dp)) {
                Image(qr, contentDescription = "Scannez pour jouer", modifier = Modifier.fillMaxSize())
            }
        }
    }
}

/** Cadre de verre sombre bordé d'un néon : le plateau reste visible autour, le code reste lisible dessus. */
private fun Modifier.verreNeon(couleur: Color, rayon: Dp = 28.dp): Modifier {
    val forme = RoundedCornerShape(rayon)
    return this
        .background(Brush.verticalGradient(listOf(GS.Nuit.copy(alpha = 0.78f), GS.Noir.copy(alpha = 0.66f))), forme)
        .border(1.5.dp, couleur.copy(alpha = 0.6f), forme)
}
