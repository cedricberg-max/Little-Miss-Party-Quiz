package com.littlemissparty.quiz.tv.habillage

/**
 * Android 9 relance lui-même, sur un fil à part, le second lecteur d'une boucle sans blanc quand le premier finit
 * (MEDIA_INFO_STARTED_AS_NEXT, dans MediaPlayer.postEventFromNative). Si ce lecteur vient d'être rendu, son start()
 * lève une IllegalStateException que rien ne peut attraper, et toute l'appli s'arrête en pleine fête (essai sur
 * émulateur du 23 octobre, huit équipes). Ce fil ne fait rien d'autre que ce start() : quand il échoue, il n'y a qu'à
 * le laisser s'éteindre.
 *
 * Vrai seulement pour ce cas précis : l'erreur part de MediaPlayer._start, appelé depuis un fil de MediaPlayer, sans
 * aucune ligne de notre code dans la pile. Toute autre erreur garde son chemin habituel.
 */
internal fun relaisAndroidRate(e: Throwable): Boolean {
    if (e !is IllegalStateException) return false
    val pile = e.stackTrace
    val haut = pile.firstOrNull() ?: return false
    return haut.className == "android.media.MediaPlayer" && haut.methodName == "_start" &&
        pile.any { it.className.startsWith("android.media.MediaPlayer$") && it.methodName == "run" } &&
        pile.none { it.className.startsWith("com.littlemissparty.") }
}
