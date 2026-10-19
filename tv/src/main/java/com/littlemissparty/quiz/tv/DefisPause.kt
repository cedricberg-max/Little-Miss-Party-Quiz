package com.littlemissparty.quiz.tv

import androidx.compose.runtime.mutableStateOf
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener

/** Défis d'origine de « PAUSE FUN ! », les mêmes que DEFIS_PAR_DEFAUT dans web/public/defis.js. */
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

/** Textes propres d'une liste enregistrée par la régie ; null si elle est vide (la TV garde alors les siens). */
fun lireDefis(textes: List<String?>): List<String>? =
    textes.mapNotNull { it?.replace(ESPACES, " ")?.trim()?.takeIf(String::isNotEmpty) }.takeIf { it.isNotEmpty() }

/** Défis à montrer pour cette fête : [prénom] remplacé, ou le défi écarté s'il n'y a pas de prénom. Jamais vide. */
fun defisPour(prenom: String, liste: List<String>?): List<String> {
    val nom = prenom.trim()
    val prets = (liste ?: DEFIS_PAR_DEFAUT).mapNotNull { d ->
        if (PRENOM.containsMatchIn(d)) nom.takeIf { it.isNotEmpty() }?.let { d.replace(PRENOM, it) } else d
    }
    return prets.ifEmpty { DEFIS_PAR_DEFAUT.filterNot { PRENOM.containsMatchIn(it) } }
}

/**
 * Défis modifiés dans la régie (onglet « Défis »), lus dans settings/defis. La box en garde une copie locale
 * (keepSynced) pour les afficher même quand Internet coupe ; sans liste, elle garde ses défis d'origine.
 */
object DefisPause {
    /** Défis enregistrés par la régie ; null tant que rien n'est enregistré (ou pas encore lu). */
    val enregistres = mutableStateOf<List<String>?>(null)
    private var suivi = false

    /** À appeler une fois la box connectée à Firebase (pendant une partie). Sans effet si déjà fait. */
    fun suivre() {
        if (suivi) return
        suivi = true
        runCatching {
            val ref = FirebaseDatabase.getInstance(GameViewModel.databaseUrl()).getReference("settings/defis")
            ref.keepSynced(true)
            ref.addValueEventListener(object : ValueEventListener {
                override fun onDataChange(snap: DataSnapshot) {
                    enregistres.value = lireDefis(snap.child("list").children.map { it.getValue(String::class.java) })
                }

                override fun onCancelled(error: DatabaseError) {
                    // Lecture refusée (règles pas encore publiées) : la TV garde ses défis, nouvel essai à la prochaine partie.
                    suivi = false
                }
            })
        }.onFailure { suivi = false }
    }
}
