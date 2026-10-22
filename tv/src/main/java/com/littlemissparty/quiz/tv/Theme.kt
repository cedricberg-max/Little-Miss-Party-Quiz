package com.littlemissparty.quiz.tv

import androidx.compose.ui.graphics.Color
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.selonLook

/**
 * Toutes les couleurs de l'appli TV au même endroit. La direction artistique définitive
 * (fluo, couleurs des accessoires des équipes) remplacera ces valeurs sans toucher aux écrans. Design « The Game Show »
 * (menu Retour) : chaque couleur prend son équivalent du kit, l'or devient le cyan des néons.
 */
object Palette {
    val Pink: Color get() = selonLook(Color(0xFFFF3CAC), GS.Rose)
    val Violet: Color get() = selonLook(Color(0xFF784BA0), GS.Violet)
    val Blue: Color get() = selonLook(Color(0xFF2B86C5), GS.Cyan)
    val Night: Color get() = selonLook(Color(0xFF1A0B2E), GS.Noir)
    val Gold: Color get() = selonLook(Color(0xFFFFD166), GS.Cyan)
    /** Texte du bouton sélectionné à la télécommande, sur fond doré : violet très foncé, contraste fort. */
    val FocusInk: Color get() = selonLook(Color(0xFF2A0E61), GS.Noir)
    val Good = Color(0xFF06D6A0)
    val Ink: Color get() = selonLook(Color.White, GS.Encre)
    val InkSoft: Color get() = selonLook(Color.White.copy(alpha = 0.75f), GS.Encre.copy(alpha = 0.75f))
    val Panel: Color get() = selonLook(Color.White.copy(alpha = 0.12f), Color(0xFF8B2CFF).copy(alpha = 0.14f))

    /**
     * Couleurs des propositions A, B, C, D : un système distinct des couleurs d'équipe,
     * pour qu'on ne confonde jamais « la réponse bleue » et « l'équipe bleue ».
     */
    val Choices: List<Color> get() = selonLook(CHOIX_CLASSIQUES, GS.Propositions)
    val ChoiceLetters = listOf("A", "B", "C", "D")

    /** Couleur de secours si une équipe envoie une couleur illisible. */
    val TeamFallback: Color get() = Pink
}

private val CHOIX_CLASSIQUES = listOf(Color(0xFFE63946), Color(0xFF3A86FF), Color(0xFFFFBE0B), Color(0xFF8338EC))
