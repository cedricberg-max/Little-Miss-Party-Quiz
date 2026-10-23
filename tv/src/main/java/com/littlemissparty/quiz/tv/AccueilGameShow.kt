package com.littlemissparty.quiz.tv

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.GrilleEquipes
import com.littlemissparty.quiz.tv.habillage.LogoGameShow
import com.littlemissparty.quiz.tv.habillage.PoliceGsTexte
import com.littlemissparty.quiz.tv.habillage.styleEtiquetteGs
import com.littlemissparty.quiz.tv.habillage.styleTitreNeon

/**
 * Accueil du design « The Game Show » : au centre, le robot qui dort sur le plateau (la vidéo du décor, calée sur Get
 * Lucky) ; à gauche, le logo, l'enfant fêté, les équipes qui arrivent et « Lancer la fête ! » ; à droite, le QR des
 * tablettes. Deux panneaux de verre sombre bordés de néon laissent le robot visible entre eux. Mêmes textes et même
 * bouton que l'accueil classique (les tests sur émulateur les lisent) ; de 1 à 8 équipes, rien ne sort de l'écran.
 */
@Composable
internal fun LobbyGameShow(state: UiState.Playing, actions: TvActions) {
    val lien = lienPupitre(state.joinUrl)
    val qr = remember(lien) { qrCode(lien) }
    // Au-delà de 4 équipes, on resserre pour que toutes tiennent au-dessus de « Lancer la fête ! ».
    val nombreuses = state.teams.size > 4
    Row(Modifier.fillMaxSize().padding(horizontal = 32.dp, vertical = 24.dp)) {
        Column(
            Modifier.width(336.dp).fillMaxHeight().verreNeon(GS.Cyan).padding(horizontal = 20.dp, vertical = 18.dp),
        ) {
            LogoGameShow(if (nombreuses) 34.dp else 40.dp)
            Spacer(Modifier.height(if (nombreuses) 6.dp else 10.dp))
            // Prestation chargée depuis la régie : on accueille l'enfant fêté par son prénom.
            val accueil = when {
                state.childName.isNotBlank() -> "Joyeux anniversaire ${state.childName} !"
                state.title.isNotBlank() -> state.title
                else -> null
            }
            if (accueil != null) {
                Text(
                    accueil, style = styleTitreNeon(if (nombreuses) 19.sp else 23.sp, GS.Rose, TextAlign.Start),
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(if (nombreuses) 8.dp else 12.dp))
            }
            Text(
                when {
                    state.teams.isEmpty() -> "En attente des équipes…"
                    state.teams.size >= GameViewModel.MAX_TEAMS -> "${state.teams.size} équipes : la partie est complète"
                    else -> "${state.teams.size} équipe(s) dans la partie"
                },
                style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, color = GS.Encre),
                fontSize = if (nombreuses) 17.sp else 20.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(if (nombreuses) 8.dp else 12.dp))
            // De 1 à 8 équipes : la grille prend la place libre et se resserre, sans jamais pousser le bouton hors de l'écran.
            Box(Modifier.weight(1f).fillMaxWidth()) {
                GrilleEquipes(state.teams.size, largeurLisible = 120.dp) { i, compacte, m ->
                    val team = state.teams.getOrNull(i) ?: return@GrilleEquipes
                    TeamChip(team, online = team.uid in state.online, buzz = state.funBuzzes[team.uid] ?: 0, compacte = compacte, modifier = m)
                }
            }
            // La consigne du buzzer cède sa place à la liste dès 4 équipes.
            if (state.teams.isNotEmpty() && state.teams.size <= 3) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "En attendant, buzzez autant que vous voulez !",
                    style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.SemiBold, color = GS.Cyan, lineHeight = 20.sp),
                    fontSize = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(10.dp))
            }
            // Un peu plus petit que sur l'accueil classique : il tient sur une ligne dans le panneau, focus compris.
            if (state.teams.isNotEmpty()) NextButton("Lancer la fête !", actions.next, fontSize = 22.sp)
        }
        Spacer(Modifier.weight(1f))
        Column(
            Modifier.width(270.dp).fillMaxHeight().verreNeon(GS.Rose).padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Scannez pour jouer", style = styleTitreNeon(22.sp, GS.Cyan), maxLines = 1, softWrap = false)
            Spacer(Modifier.height(16.dp))
            // Le QR reste sur fond blanc (les tablettes le lisent mieux) et prend la place qui reste : le code dessous est
            // toujours entier.
            Box(
                Modifier.weight(1f, fill = false).sizeIn(maxWidth = 226.dp, maxHeight = 226.dp).aspectRatio(1f)
                    .background(Color.White, RoundedCornerShape(18.dp)).padding(10.dp),
            ) {
                Image(qr, contentDescription = "QR code de la partie", modifier = Modifier.fillMaxSize())
            }
            Spacer(Modifier.height(16.dp))
            Text(
                "Code de la partie",
                style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.SemiBold, color = GS.Encre.copy(alpha = 0.7f)),
                fontSize = 16.sp, maxLines = 1,
            )
            Text(state.code, style = styleEtiquetteGs(34.sp, GS.Rose, 6.sp), maxLines = 1, softWrap = false)
        }
    }
}

/**
 * Panneau de verre sombre bordé d'un néon : le robot du plateau reste visible autour, le texte reste lisible dessus.
 * Pas de rognage : une pastille d'équipe qui buzze grossit un instant et doit rester entière.
 */
private fun Modifier.verreNeon(couleur: Color): Modifier {
    val forme = RoundedCornerShape(28.dp)
    return this
        .background(Brush.verticalGradient(listOf(GS.Nuit.copy(alpha = 0.78f), GS.Noir.copy(alpha = 0.66f))), forme)
        .border(1.5.dp, couleur.copy(alpha = 0.6f), forme)
}
