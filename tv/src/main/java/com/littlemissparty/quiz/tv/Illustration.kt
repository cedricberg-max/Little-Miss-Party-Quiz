package com.littlemissparty.quiz.tv

import android.graphics.BitmapFactory
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.apres
import com.littlemissparty.quiz.tv.habillage.cadreQuiz3d
import com.littlemissparty.quiz.tv.habillage.planchesQuiz3d

/** Illustration de la question révélée : la photo si elle est chargée, sinon l'émoji, sinon rien. */
fun hasIllustration(q: Question, state: UiState.Playing): Boolean =
    (q.imageId != null && state.images[q.imageId] != null) || q.emoji != null

@Composable
fun Illustration(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val bytes = q.imageId?.let { state.images[it] }
    val photo: ImageBitmap? = remember(bytes) {
        bytes?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() }
    }
    if (photo == null && q.emoji == null) return
    // La carte arrive en rebondissant, une fois, au moment où la bonne réponse passe à l'or.
    val visible = apres(Tempo.revelationOr(q.isExpress), q.id)
    val pop = remember(q.id) { Animatable(0.6f) }
    LaunchedEffect(q.id, visible) {
        if (visible) pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow))
    }
    // Game Show 3D : la photo dans son cadre néon (maquette du 24/10), posée 13 dp à l'intérieur.
    val cadre = planchesQuiz3d()
    Box(
        modifier
            .graphicsLayer {
                scaleX = pop.value; scaleY = pop.value; alpha = ((pop.value - 0.6f) / 0.4f).coerceIn(0f, 1f)
                // Cadre néon : sans calque à la taille de la carte, sa lueur déborde sans être coupée pendant l'arrivée.
                if (cadre != null) compositingStrategy = CompositingStrategy.ModulateAlpha
            }
            .then(if (cadre != null) Modifier.cadreQuiz3d(cadre).padding(13.dp).clip(RoundedCornerShape(9.dp)) else Modifier.clip(RoundedCornerShape(28.dp)))
            .background(Color.White.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        if (photo != null) {
            Image(photo, contentDescription = "Illustration de la réponse", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Text(q.emoji!!, style = TextStyle(fontSize = 140.sp, lineHeight = 160.sp), maxLines = 1, softWrap = false)
        }
    }
}
