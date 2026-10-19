package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.R

/**
 * Le logo officiel Little Miss Party (fichier de cedric, détouré), jamais redessiné en police.
 * Une seule image partout : salon, générique, signature pendant les jeux, victoire, pause.
 */
@Composable
fun LogoLmp(hauteur: Dp, modifier: Modifier = Modifier) {
    Image(
        painterResource(R.drawable.lmp_logo),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = modifier.height(hauteur).clearAndSetSemantics {},
    )
}

/** « QUIZ » en or sous le logo, puisque le logo officiel ne le contient pas. */
@Composable
fun MotQuiz(taille: TextUnit, modifier: Modifier = Modifier) {
    Text(
        "QUIZ",
        style = TextStyle(
            brush = Brush.verticalGradient(listOf(Neon.OrClair, Neon.OrProfond)),
            fontSize = taille, lineHeight = taille * 1.05f, fontWeight = FontWeight.Black, letterSpacing = taille * 0.42f,
            shadow = Shadow(Neon.Or.copy(alpha = 0.5f), Offset.Zero, 24f),
        ),
        maxLines = 1, softWrap = false,
        // L'espacement des lettres s'ajoute aussi après le Z : on recentre d'autant.
        modifier = modifier.padding(start = with(LocalDensity.current) { (taille * 0.42f).toDp() }),
    )
}

/** Logo du salon : le logo officiel, et « QUIZ » centré dessous, collé au trait de PARTY. */
@Composable
fun LogoQuiz(hauteurLogo: Dp, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        LogoLmp(hauteurLogo)
        MotQuiz((hauteurLogo.value * 0.36f).sp, Modifier.offset(y = -hauteurLogo * 0.04f))
    }
}

/** Signature discrète pendant les jeux : petit, fixe, à demi transparent. Le jeu reste la vedette. */
@Composable
fun SignatureLogo(modifier: Modifier = Modifier, hauteur: Dp = 26.dp) {
    LogoLmp(hauteur, modifier.alpha(0.55f))
}
