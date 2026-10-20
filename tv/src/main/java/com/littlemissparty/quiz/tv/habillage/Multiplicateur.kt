package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/** Durée de l'annonce du multiplicateur, calée sur l'éclat « points doublés » (lmp_bt_double) joué au même moment. */
const val ANNONCE_MULTIPLICATEUR_MS = 4_500L

/** « POINTS DOUBLÉS ! », « POINTS TRIPLÉS ! », sinon « POINTS × N ! ». */
fun pointsMultiplies(facteur: Int): String = when (facteur) {
    2 -> "POINTS DOUBLÉS !"
    3 -> "POINTS TRIPLÉS !"
    4 -> "POINTS QUADRUPLÉS !"
    else -> "POINTS × $facteur !"
}

/**
 * Dernières questions du quiz à points multipliés : « DERNIÈRES QUESTIONS », le « × N » choisi par Sarah dans la
 * régie qui claque en géant sur l'éclat de cuivres, puis le nombre de questions qui restent. Par-dessus tout
 * l'écran au début de la première de ces questions, pendant [ANNONCE_MULTIPLICATEUR_MS] ; ce n'est jamais un
 * nouveau jeu (ni rideau ni jingle de manche). N'affiche que ce qu'on lui donne et ne joue aucun son.
 *
 * @param restantes questions à points multipliés, celle-ci comprise
 */
@Composable
fun AnnonceMultiplicateur(facteur: Int, restantes: Int, modifier: Modifier = Modifier) {
    val cle = facteur to restantes
    val ms = horloge(cle)
    Echelle(1600.dp, 700.dp, modifier.fillMaxSize().background(Neon.Fond.copy(alpha = 0.92f))) {
        Rayons(ms)
        Gerbe(cle = cle)
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                if (restantes > 1) "DERNIÈRES QUESTIONS" else "DERNIÈRE QUESTION",
                color = Neon.Halo, fontSize = 44.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                modifier = Modifier.apparition(0, cle),
            )
            Text(
                "× $facteur", fontSize = 260.sp, lineHeight = 260.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, color = Neon.Or, shadow = Shadow(Neon.Or.copy(alpha = 0.7f), Offset.Zero, 50f)),
                modifier = Modifier.apparition(2000, cle).rebond(apres(2400, cle), 0.05f),
            )
            Text(
                pointsMultiplies(facteur), color = Neon.Blanc, fontSize = 64.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                modifier = Modifier.apparition(2500, cle),
            )
            Spacer(Modifier.height(16.dp))
            Text(
                if (restantes > 1) "Encore $restantes questions pour tout changer !" else "Une dernière question pour tout changer !",
                color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 34.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false,
                modifier = Modifier.apparition(3000, cle),
            )
        }
    }
}
