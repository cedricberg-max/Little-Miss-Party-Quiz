package com.littlemissparty.quiz.tv

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.littlemissparty.quiz.tv.habillage.PresentationJeu
import com.littlemissparty.quiz.tv.habillage.familleJeu

/**
 * Présentation d'un jeu (demande de cedric) : son nom et son emblème, animés, et rien d'autre. Les règles, c'est
 * l'animatrice qui les donne ; l'écran attend qu'elle lance le jeu depuis la régie (ou OK sur la télécommande).
 * Design « The Game Show » : l'intro vidéo du jeu à la place de l'emblème ; elle s'arrête pendant la pause.
 */
@Composable
fun PresentationScreen(state: UiState.Playing, actions: TvActions) {
    Box(Modifier.fillMaxSize()) {
        PresentationJeu(state.gameTitle ?: "Quiz", familleJeu(state.question), Modifier.fillMaxSize(), video = !state.paused)
        if (!state.paused && Pilotage.telecommande) {
            NextButton("Lancer l'épreuve", actions.next, Modifier.align(Alignment.BottomEnd).padding(36.dp), key = "presentation-${state.index}")
        }
    }
}
