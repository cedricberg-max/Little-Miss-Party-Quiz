package com.littlemissparty.quiz.tv

import androidx.compose.runtime.mutableStateOf
import com.google.firebase.database.DataSnapshot

/** Défis de base de « PAUSE FUN ! », toujours là ; les mêmes que DEFIS_PAR_DEFAUT dans web/public/defis.js. */
val DEFIS_PAR_DEFAUT = listOf(
    "Tout le monde fait la ola !",
    "Un tonnerre d'applaudissements pour [prénom] !",
    "Montrez votre plus belle pose de star !",
    "Applaudissez l'équipe d'à côté !",
    "Vos plus beaux pas de danse, c'est maintenant !",
    "Trois tapes dans les mains, tous ensemble !",
    "Qui a le plus beau sourire de l'équipe ?",
)
private val PRENOM = Regex("""\[\s*pr[ée]nom\s*]""", RegexOption.IGNORE_CASE)
private val ESPACES = Regex("\\s+")

/** Textes propres d'une liste enregistrée par la régie ; null si elle est vide. */
fun lireDefis(textes: List<String?>): List<String>? =
    textes.mapNotNull { it?.replace(ESPACES, " ")?.trim()?.takeIf(String::isNotEmpty) }.takeIf { it.isNotEmpty() }

/**
 * Défis à montrer pour cette fête : les 7 de base, toujours là, puis ceux en plus de la fête (cedric, 31/10), sans
 * doublon ; [prénom] remplacé, ou le défi écarté s'il n'y a pas de prénom. Jamais vide.
 */
fun defisPour(prenom: String, enPlus: List<String>?): List<String> {
    val nom = prenom.trim()
    return (DEFIS_PAR_DEFAUT + enPlus.orEmpty()).distinct().mapNotNull { d ->
        if (PRENOM.containsMatchIn(d)) nom.takeIf { it.isNotEmpty() }?.let { d.replace(PRENOM, it) } else d
    }
}

/**
 * Défis en plus de la fête en cours : préparés dans la Régie PC (copiés dans la partie au lancement) ou ajoutés sur le
 * téléphone (onglet « Défis »), lus dans games/<code>/defisFete. Propres à la partie : jamais repris à la suivante.
 */
object DefisPause {
    /** Défis en plus de la partie en cours ; null s'il n'y en a pas. */
    val enPlus = mutableStateOf<List<String>?>(null)

    /** Nouvelle partie suivie : ses défis en plus, ou aucun. */
    fun lire(snap: DataSnapshot?) {
        enPlus.value = snap?.child("list")?.children?.map { it.getValue(String::class.java) }?.let(::lireDefis)
    }
}
