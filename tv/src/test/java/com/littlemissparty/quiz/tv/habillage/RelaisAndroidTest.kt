package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le plantage de l'essai sur émulateur du 23 octobre : Android relance le second lecteur d'une boucle sur un fil à
 * lui, ce lecteur venait d'être rendu. Seul ce cas-là est ignoré ; toute autre erreur arrête l'appli comme avant.
 */
class RelaisAndroidTest {

    private fun ligne(classe: String, methode: String) = StackTraceElement(classe, methode, "MediaPlayer.java", 1)

    private fun erreur(vararg pile: StackTraceElement, e: Throwable = IllegalStateException()) =
        e.apply { stackTrace = arrayOf(*pile) }

    /** La pile exacte relevée sur l'émulateur (Android 9). */
    private val pileDuPlantage = arrayOf(
        ligne("android.media.MediaPlayer", "_start"),
        ligne("android.media.MediaPlayer", "startImpl"),
        ligne("android.media.MediaPlayer", "start"),
        ligne("android.media.MediaPlayer$6", "run"),
        ligne("java.lang.Thread", "run"),
    )

    @Test
    fun `le relais relance par Android sur un lecteur deja rendu est ignore`() {
        assertTrue(relaisAndroidRate(erreur(*pileDuPlantage)))
    }

    @Test
    fun `un start rate appele par notre code arrete l'appli comme avant`() {
        val pile = arrayOf(
            ligne("android.media.MediaPlayer", "_start"),
            ligne("android.media.MediaPlayer", "startImpl"),
            ligne("android.media.MediaPlayer", "start"),
            ligne("com.littlemissparty.quiz.tv.habillage.Boucle", "demarrer"),
            ligne("android.media.MediaPlayer$6", "run"),
            ligne("java.lang.Thread", "run"),
        )
        assertFalse(relaisAndroidRate(erreur(*pile)))
    }

    @Test
    fun `une autre erreur sur le meme fil arrete l'appli comme avant`() {
        assertFalse(relaisAndroidRate(erreur(*pileDuPlantage, e = IllegalArgumentException())))
        assertFalse(relaisAndroidRate(erreur(*pileDuPlantage, e = RuntimeException())))
    }

    @Test
    fun `une erreur qui ne part pas du start du lecteur arrete l'appli comme avant`() {
        assertFalse(relaisAndroidRate(erreur(*pileDuPlantage.drop(1).toTypedArray())))
        assertFalse(relaisAndroidRate(erreur(ligne("android.media.MediaPlayer", "_start"), ligne("java.lang.Thread", "run"))))
        assertFalse(relaisAndroidRate(erreur()))
    }
}
