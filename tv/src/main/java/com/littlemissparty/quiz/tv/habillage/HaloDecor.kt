package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow

/**
 * Règle des petits textes posés sur le décor (cedric, 31/10 au soir) : jamais de rectangle ni d'ovale derrière, une
 * ombre douce et noire tout autour des lettres, en gras. Le modèle exact : la phrase du Chrono « Prêts ? Comptez dans
 * votre tête… » (ChronoScreens, Consigne).
 */
internal val HALO_DECOR = Shadow(Color.Black, Offset.Zero, 22f)
