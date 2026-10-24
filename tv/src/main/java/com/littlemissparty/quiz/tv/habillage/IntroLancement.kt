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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.R
import com.littlemissparty.quiz.tv.UiState

/**
 * Grande intro du lancement, design « The Game Show » : quand Sarah lance la fête depuis l'accueil, le robot se
 * réveille, la scène s'allume au laser et le logo arrive sur Get Lucky (res/raw/gs_intro_lancement.mp4, 31 s, rendue
 * à l'avance en 3D, avec sa musique), puis la caméra plonge dans le portail et l'écran du premier jeu apparaît.
 *
 * À chaque lancement depuis l'accueil, seulement si cette box l'a montré (une box qui reprend une partie en cours ne la
 * joue pas) et si la fête commence par la présentation d'un jeu. Elle s'efface dès que Sarah lance l'épreuve, change de
 * jeu ou met en pause, ou si la vidéo ne se lit pas : la partie n'en dépend jamais. Elle ne prend jamais le focus :
 * le bouton de l'écran du dessous garde la télécommande.
 */
@Composable
fun IntroLancement(s: UiState.Playing) {
    if (!Look.gs) return
    // 0 : rien ; 1 : la vidéo passe ; 2 : elle s'efface ; 3 : finie (jusqu'au prochain retour à l'accueil).
    var etape by remember(s.code) { mutableIntStateOf(0) }
    var depart by remember(s.code) { mutableIntStateOf(-1) }
    val voile = remember(s.code) { Animatable(1f) }
    LaunchedEffect(s.code, s.phase, s.intro, s.paused) {
        // Retour à l'accueil (mauvaise prestation remplacée) : la fête sera relancée, l'intro aussi.
        if (s.phase == Phase.LOBBY) {
            Habillage.introsAttendues.add(s.code)
            etape = 0
            voile.snapTo(1f)
        } else if (Habillage.introsAttendues.remove(s.code) && etape == 0 && s.phase == Phase.QUESTION && s.intro && !s.paused) {
            depart = s.index
            etape = 1
        }
    }
    val enPlace = s.index == depart && s.phase == Phase.QUESTION && s.intro && !s.paused
    LaunchedEffect(enPlace, etape) { if (!enPlace && etape in 1..2) etape = 3 }
    // Jusqu'à la fin du fondu : la bande-son reprend et le robot arrive quand l'écran du jeu est entièrement là (la box
    // ne décode qu'une vidéo à la fois).
    val joue = etape in 1..2 && enPlace
    DisposableEffect(joue) {
        Habillage.introLancement.value = joue
        onDispose { Habillage.introLancement.value = false }
    }
    // Dès la première image de la présentation (avant que l'effet ci-dessus ne démarre l'intro) : écran noir, sans
    // laisser entrevoir le jeu.
    val imminente = etape == 0 && s.phase == Phase.QUESTION && s.intro && !s.paused && s.code in Habillage.introsAttendues
    if (!joue && !imminente) return
    LaunchedEffect(etape) {
        if (etape == 2) {
            voile.animateTo(0f, tween(FONDU_INTRO_MS))
            etape = 3
        }
    }
    Box(Modifier.fillMaxSize().graphicsLayer { alpha = voile.value }.background(Color.Black).clearAndSetSemantics {}) {
        AndroidView(
            factory = {
                LecteurFond(
                    it, R.raw.gs_intro_lancement, surPret = {}, surEchec = { if (etape == 1) etape = 2 },
                    boucle = false, volume = VOLUME_INTRO, finMs = FIN_INTRO_MS, surFin = { if (etape == 1) etape = 2 },
                )
            },
            onRelease = { it.liberer() },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/**
 * À 30,6 s, la plongée dans le portail finit sur un fond presque noir fixe jusqu'au bout de la vidéo (31,6 s) : l'écran
 * du jeu apparaît en fondu sur cette dernière seconde (minutage de la Vision).
 */
internal const val FIN_INTRO_MS = 30_600
internal const val FONDU_INTRO_MS = 1_000
/** Son de la vidéo (−14,3 LUFS) ramené au niveau de la musique du podium (−15,8 LUFS, jouée à plein volume). */
internal const val VOLUME_INTRO = 0.85f
