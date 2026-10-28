package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.tv.R

/** La vidéo de l'outro (le robot rentre chez lui en fusée), si elle est dans l'appli : res/raw/gs_outro_robot.mp4. */
object Outro {
    const val FICHIER = "gs_outro_robot"
    val resId: Int by lazy { runCatching { R.raw::class.java.getField(FICHIER).getInt(null) }.getOrDefault(0) }
    val disponible: Boolean get() = resId != 0
}

/** Son de l'outro, tout mixé dans la vidéo (−15,6 LUFS) : déjà au niveau de la musique du podium (−15,8 LUFS, à plein volume). */
internal const val VOLUME_OUTRO = 1f
/** L'outro arrive sur la fin du podium comme l'écran de fin d'avant : en fondu sur le plateau. */
private const val FONDU_OUTRO_MS = 500
/** Après les 3 s de noir de l'outro, l'écran « Merci » sort du noir en fondu (cedric, 28/10 : pas de coupe). */
internal const val FONDU_APRES_OUTRO_MS = 1_500

/**
 * Fin du Game Show quand le podium s'éteint ([Tempo.PODIUM_FIN]) : l'outro du robot qui rentre chez lui en fusée
 * (115,5 s, son et textes dans la vidéo, fondu au noir puis environ 3 s de noir sans son), puis l'écran de fin cinéma
 * ([FinCinemaGameShow]) qui sort de ce noir en fondu, avec le dernier groove d'Aerodynamic qui démarre seulement
 * là (pendant l'outro, le directeur sonore se tait : [Instant.outro]). Sans le fichier, ou si la vidéo ne se lit pas,
 * l'écran de fin arrive directement, comme avant. Une seule vidéo à la fois ([Habillage.finVideo]).
 */
@Composable
fun OutroPuisFinGameShow(modifier: Modifier = Modifier) {
    if (!Outro.disponible) return FinCinemaGameShow(modifier)
    var fini by remember { mutableStateOf(false) }
    if (fini) {
        LaunchedEffect(Unit) { Sons.executer(listOf(Ordre.Musique(Ambiance.AU_REVOIR, fonduMs = Tempo.FONDU_AU_REVOIR))) }
        return Box(modifier.fillMaxSize().background(Color.Black)) {
            FinCinemaGameShow(Modifier.fillMaxSize(), fonduMs = FONDU_APRES_OUTRO_MS)
        }
    }
    DisposableEffect(Unit) {
        Habillage.finVideo.value = true
        onDispose { Habillage.finVideo.value = false }
    }
    var prete by remember { mutableStateOf(false) }
    val opacite = remember { Animatable(0f) }
    LaunchedEffect(prete) { if (prete) opacite.animateTo(1f, tween(FONDU_OUTRO_MS)) }
    Box(modifier.fillMaxSize().clearAndSetSemantics {}) {
        AndroidView(
            factory = {
                LecteurFond(
                    it, Outro.resId, surPret = { prete = true },
                    surEchec = {
                        Sons.incident("Outro : la vidéo ne se lit pas (${GelFond.fondsOuverts} vidéos ouvertes)")
                        fini = true
                    },
                    boucle = false, volume = VOLUME_OUTRO, surFin = { fini = true },
                    surSon = { piste -> if (!piste) Sons.incident("Outro : la box ne lit pas le son de la vidéo") },
                )
            },
            update = { it.alpha = opacite.value },
            onRelease = { it.liberer() },
            modifier = Modifier.fillMaxSize(),
        )
    }
}
