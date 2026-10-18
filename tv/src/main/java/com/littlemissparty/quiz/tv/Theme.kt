package com.littlemissparty.quiz.tv

import androidx.compose.ui.graphics.Color

/**
 * Toutes les couleurs de l'appli TV au même endroit. La direction artistique définitive
 * (fluo, couleurs des accessoires des équipes) remplacera ces valeurs sans toucher aux écrans.
 */
object Palette {
    val Pink = Color(0xFFFF3CAC)
    val Violet = Color(0xFF784BA0)
    val Blue = Color(0xFF2B86C5)
    val Night = Color(0xFF1A0B2E)
    val Gold = Color(0xFFFFD166)
    /** Texte du bouton sélectionné à la télécommande, sur fond doré : violet très foncé, contraste fort. */
    val FocusInk = Color(0xFF2A0E61)
    val Good = Color(0xFF06D6A0)
    val Ink = Color.White
    val InkSoft = Color.White.copy(alpha = 0.75f)
    val Panel = Color.White.copy(alpha = 0.12f)

    /**
     * Couleurs des propositions A, B, C, D : un système distinct des couleurs d'équipe,
     * pour qu'on ne confonde jamais « la réponse bleue » et « l'équipe bleue ».
     */
    val Choices = listOf(Color(0xFFE63946), Color(0xFF3A86FF), Color(0xFFFFBE0B), Color(0xFF8338EC))
    val ChoiceLetters = listOf("A", "B", "C", "D")

    /** Couleur de secours si une équipe envoie une couleur illisible. */
    val TeamFallback = Pink
}
