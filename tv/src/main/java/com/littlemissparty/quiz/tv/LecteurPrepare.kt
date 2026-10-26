package com.littlemissparty.quiz.tv

import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** Où en est un lecteur préparé par [rememberPrepareAuCalme]. */
internal sealed interface Preparation<out T> {
    data object EnCours : Preparation<Nothing>

    /** [lecteur] null : fichier illisible. */
    data class Faite<T>(val lecteur: T?) : Preparation<T>
}

/**
 * Prépare un lecteur de chanson ([fabriquer] : MediaPlayer créé et préparé) hors du fil de l'écran, à chaque
 * changement de [cles]. Préparée sur le fil de l'écran, une chanson figeait l'image un instant (ralenti à l'entrée
 * des statues, test du 25/10 au soir). Le lecteur est rendu ([liberer]) quand les clés changent ou que l'écran part,
 * même s'il finissait encore de se préparer.
 */
@Composable
internal fun <T : Any> rememberPrepareAuCalme(vararg cles: Any?, liberer: (T) -> Unit, fabriquer: () -> T?): Preparation<T> =
    produceState<Preparation<T>>(Preparation.EnCours, *cles) {
        val lecteur = withContext(NonCancellable + Dispatchers.IO) { fabriquer() }
        value = Preparation.Faite(lecteur)
        awaitDispose { lecteur?.let(liberer) }
    }.value
