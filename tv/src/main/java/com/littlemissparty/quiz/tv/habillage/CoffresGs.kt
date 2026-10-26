package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

/*
 * Les coffres mystères en vraie 3D (Game Show) : maquette validée par cedric (nuit du 23 au 24 octobre), rendue avec
 * three.js en planches WebP (sources : the-game-show/nuit-24-octobre/coffres/source). Chaque coffre est dans une case
 * carrée ; il y fait exactement la taille du dessin Classique (largeur × hauteur du modèle), base posée à [FB] de la case.
 *  - gs_coffres_scene : 5 colonnes de 400 px, case 3m+0 fermé, 3m+1 néons vifs, 3m+2 ouvert calme (m = modèle 0..5).
 *  - gs_coffre_<m>, gs_coffre_or : 3 colonnes de 680 px, cases 0..7 du couvercle fermé au couvercle grand ouvert.
 * La scène reste en mémoire pendant le jeu ; une seule planche d'ouverture à la fois (lue en arrière-plan).
 * Une image manque : le dessin Classique reprend la main, rien ne casse.
 */

/** Côté de la case de chaque modèle, dans les unités du modèle (largeur du coffre = largeur du modèle). */
private val CASES = floatArrayOf(217f, 218f, 153f, 203f, 256f, 205f)
private const val FB = 0.86f
private const val CASE_SCENE = 400
private const val CASE_OUVERTURE = 680
/** Clé de la planche du coffre en or. */
private const val OR = 6

private var sceneLue by mutableStateOf<ImageBitmap?>(null)
private var sceneEssayee = false
private var ouvertureLue by mutableStateOf<Pair<Int, ImageBitmap>?>(null)

/** La planche des coffres sur les gradins, lue une fois (null en Classique ou si elle manque). */
@Composable
internal fun ChargerCoffresGs() {
    if (!Look.gs) return
    val context = LocalContext.current
    LaunchedEffect(Unit) {
        if (sceneEssayee) return@LaunchedEffect
        sceneEssayee = true
        sceneLue = withContext(Dispatchers.IO) { lire(context, "gs_coffres_scene") }
    }
}

/** Prépare la planche d'ouverture du coffre [modele] (ou du coffre en or) ; l'ancienne est libérée. */
@Composable
internal fun ChargerOuvertureGs(modele: Int, dore: Boolean = false) {
    if (!Look.gs) return
    val context = LocalContext.current
    val cle = if (dore) OR else modele
    LaunchedEffect(cle) {
        if (ouvertureLue?.first == cle) return@LaunchedEffect
        val image = withContext(Dispatchers.IO) { lire(context, if (dore) "gs_coffre_or" else "gs_coffre_$modele") }
        ouvertureLue = image?.let { cle to it }
    }
}

private fun lire(context: Context, nom: String): ImageBitmap? = runCatching {
    val id = context.resources.getIdentifier(nom, "drawable", context.packageName)
    if (id == 0) null else ImageBitmap.imageResource(context.resources, id)
}.getOrNull()

/**
 * Dessine le coffre 3D [modele] dans la zone (largeur = largeur du coffre, base en bas), comme le dessin Classique.
 * [enScene] : sur les gradins (néons vifs fermé, ouvert calme) ; sinon l'ouverture, couvercle selon [ouverture].
 * [assombri] : 0 neuf, ~0,3 déjà ouvert, ~0,7 brûlé par la bombe. Renvoie false si l'image n'est pas prête.
 */
internal fun DrawScope.dessineCoffreGs(modele: Int, ouverture: Float, assombri: Float, dore: Boolean, enScene: Boolean): Boolean {
    val cleOuverture = if (dore) OR else modele
    val planche = ouvertureLue?.takeIf { !enScene && it.first == cleOuverture }?.second
    val (image, case, index, colonnes) = when {
        planche != null -> Quatre(planche, CASE_OUVERTURE, (ouverture.coerceIn(0f, 1f) * 7f).roundToInt(), 3)
        dore -> return false
        else -> Quatre(sceneLue ?: return false, CASE_SCENE, 3 * modele + if (ouverture >= 0.5f) 2 else 1, 5)
    }
    val cote = CASES[modele] / largeurModele(modele) * size.width
    val gauche = (size.width - cote) / 2f
    val haut = size.height - FB * cote
    val filtre = if (assombri > 0f) ColorFilter.tint(Color(0xFF120A1C).copy(alpha = (assombri * 0.85f).coerceAtMost(0.75f)), BlendMode.SrcAtop) else null
    drawImage(
        image,
        srcOffset = IntOffset((index % colonnes) * case, (index / colonnes) * case),
        srcSize = IntSize(case, case),
        dstOffset = IntOffset(gauche.roundToInt(), haut.roundToInt()),
        dstSize = IntSize(cote.roundToInt(), cote.roundToInt()),
        colorFilter = filtre,
    )
    return true
}

private data class Quatre(val image: ImageBitmap, val case: Int, val index: Int, val colonnes: Int)
