package com.littlemissparty.quiz.tv.habillage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Un clip du robot posé à sa place sur l'écran (podium, écran de fin) : son entrée, puis sa danse qui repart de
 * [boucleDepuisMs] tant que l'écran reste affiché ([LecteurAlpha]). Clip absent ou illisible : pas de robot, rien d'autre.
 */
@Composable
internal fun ClipRobotEnBoucle(fichier: String, boucleDepuisMs: Int, modifier: Modifier) {
    val context = LocalContext.current
    val resId = remember(fichier) { context.resources.getIdentifier(fichier, "raw", context.packageName) }
    if (resId == 0) return
    var pret by remember { mutableStateOf(false) }
    AndroidView(
        factory = { LecteurAlpha(it, resId, surDebut = { pret = true }, surEchec = {}, boucleDepuisMs = boucleDepuisMs) },
        onRelease = { it.liberer() },
        modifier = modifier.clearAndSetSemantics {}.graphicsLayer { alpha = if (pret) 1f else 0f },
    )
}
