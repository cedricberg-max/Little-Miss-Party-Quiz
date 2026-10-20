package com.littlemissparty.quiz.tv.habillage

import android.media.MediaPlayer
import android.media.audiofx.LoudnessEnhancer
import android.util.Log

/** Gain ajouté aux extraits musicaux (millibels) : les chansons importées passent au-dessus des bruitages. */
private const val GAIN_EXTRAIT_MB = 500

/** Blind test, refrain de la révélation : plus fort encore, « on chante tous ensemble ». */
const val GAIN_REFRAIN_MB = 1_000

/**
 * Blind test et quiz musical : monte un peu le volume de l'extrait (le limiteur de l'effet évite toute saturation).
 * Rend l'effet à libérer avec le lecteur ; null si la box ne le propose pas : l'extrait joue alors normalement.
 */
fun boosterExtrait(player: MediaPlayer, gainMb: Int = GAIN_EXTRAIT_MB): LoudnessEnhancer? = runCatching {
    LoudnessEnhancer(player.audioSessionId).apply {
        setTargetGain(gainMb)
        enabled = true
    }
}.onFailure { Log.w("Extrait", "Volume renforcé indisponible", it) }.getOrNull()
