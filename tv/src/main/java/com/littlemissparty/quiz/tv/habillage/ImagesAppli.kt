package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.os.Process
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.platform.LocalContext
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * Les grandes images de l'appli (affiches du décor, planches du Quiz 3D, jauge, portes, platine) décodées une seule
 * fois pour toute la soirée, et d'avance, en fond, dès l'ouverture (test du 27/10 au soir : petits blocages au début
 * des écrans ; la box décodait chaque image en entrant dans l'écran, jusqu'à 0,8 s à la première question du Quiz).
 */
internal object ImagesAppli {
    private val lues = ConcurrentHashMap<String, ImageBitmap>()
    private val absentes = ConcurrentHashMap.newKeySet<String>()

    /** L'image [nom] (drawable), décodée une fois ; null si elle n'existe pas ou ne se lit pas. */
    fun lire(context: Context, nom: String): ImageBitmap? {
        lues[nom]?.let { return it }
        if (nom in absentes) return null
        val res = context.resources
        val id = res.getIdentifier(nom, "drawable", context.packageName)
        val image = if (id == 0) null else runCatching { ImageBitmap.imageResource(res, id).also { it.asAndroidBitmap().prepareToDraw() } }.getOrNull()
        if (image == null) absentes += nom else lues.putIfAbsent(nom, image)
        return lues[nom] ?: image
    }

    /** Décode en fond, une par une et sans gêner l'écran, toutes les images de [GRANDES_IMAGES] (Game Show). */
    fun prechauffer(context: Context) {
        if (!Look.gs) return
        val appli = context.applicationContext
        thread(name = "images-appli", isDaemon = true) {
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
            GRANDES_IMAGES.forEach { lire(appli, it) }
        }
    }
}

/** Les images décodées d'avance : décor, Quiz 3D, jauge des scores, portes des transitions, platine du blind test. */
internal val GRANDES_IMAGES: List<String> = listOf("gs_accueil_poster", "gs_fond_poster") + NOMS_QUIZ3D +
    listOf("gs_jauge_haut", "gs_jauge_corps", "gs_jauge_bas", "gs_jauge_liquide", "gs_portes_gauche", "gs_portes_droite",
        "gs_bt_bras", "gs_bt_disque_poster")

/** L'image [nom] pour un écran : prête si elle a été décodée d'avance, sinon décodée une fois pour toutes. */
@Composable
internal fun imageAppli(nom: String): ImageBitmap? {
    val context = LocalContext.current
    return remember(nom) { ImagesAppli.lire(context, nom) }
}
