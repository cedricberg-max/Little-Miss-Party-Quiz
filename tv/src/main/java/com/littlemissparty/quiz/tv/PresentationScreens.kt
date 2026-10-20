package com.littlemissparty.quiz.tv

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.QuestionKind
import com.littlemissparty.quiz.tv.habillage.PresentationJeu

/**
 * Présentation d'un jeu (demande de cedric) : son nom et son emblème, animés, et rien d'autre. Les règles, c'est
 * l'animatrice qui les donne ; l'écran attend qu'elle lance le jeu depuis la régie (ou OK sur la télécommande).
 */
@Composable
fun PresentationScreen(state: UiState.Playing, actions: TvActions) {
    Box(Modifier.fillMaxSize()) {
        PresentationJeu(state.gameTitle ?: "Quiz", familleDe(state.question), Modifier.fillMaxSize())
        if (!state.paused) {
            NextButton("Lancer l'épreuve", actions.next, Modifier.align(Alignment.BottomEnd).padding(36.dp), key = "presentation-${state.index}")
        }
    }
}

/** Famille du jeu pour son emblème (habillage/PresentationJeu.kt). */
private fun familleDe(q: Question?): String = when (q?.kind) {
    QuestionKind.MIME -> "mimes"
    QuestionKind.PICTIONARY -> "pictionary"
    QuestionKind.BLIND -> "blind"
    QuestionKind.NUMBER -> "juste"
    QuestionKind.EXPRESS -> "express"
    QuestionKind.ZOOM -> "zoom"
    QuestionKind.FLOU -> "flou"
    QuestionKind.CHANTE -> "chante"
    QuestionKind.QUISUIS -> "quisuis"
    QuestionKind.DISPARU -> "disparu"
    QuestionKind.STATUES -> "statues"
    QuestionKind.PORTES -> "portes"
    QuestionKind.COFFRES -> "bombe"
    else -> if (q?.audioId != null) "musical" else "quiz"
}
