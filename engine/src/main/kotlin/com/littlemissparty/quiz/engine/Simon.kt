package com.littlemissparty.quiz.engine

import kotlin.random.Random

/*
 * 🔴 Le Simon du Prof (cedric, 27 octobre) : le robot professeur montre au tableau une suite de boules de couleur qui
 * s'allument une à une (chacune sa note) ; la suite grandit d'un élément à chaque fois. Quand la suite atteint
 * [SIMON_CHIFFRES_DES] éléments, « Attention, les chiffres débarquent ! » : des chiffres s'y mêlent (rouge vert bleu 4
 * jaune…). Après la suite, le chrono part : sur sa tablette, un joueur de chaque équipe (un autre à chaque suite) tape
 * la suite puis « Valider ». La TV montre en direct ce que chaque équipe tape, en « ? » à sa couleur ; à la fin, la
 * vérification colonne par colonne : une équipe qui se trompe (ou n'a pas fini) est éliminée du tour. La dernière équipe
 * en jeu gagne le tour. Toutes en erreur sur la même suite : la plus avancée dans la suite gagne, à égalité la plus
 * rapide à valider ; toutes en erreur dès la première suite : « Bah alors, qu'est-ce qui vous arrive ?! », Sarah relance.
 */

/** Les 8 couleurs des boules (codes publiés), dans l'ordre des tablettes. */
val SIMON_COULEURS = listOf("rouge", "orange", "jaune", "vert", "bleu", "violet", "rose", "blanc")

/** Les chiffres, dans l'ordre du pavé des tablettes. */
val SIMON_CHIFFRES = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0")

/** Longueur de suite où les chiffres arrivent : ce rang est toujours un chiffre, les suivants au hasard. */
const val SIMON_CHIFFRES_DES = 4

/**
 * Plus de chiffres dans le Simon (cedric, 29/10 : « une suite de boules colorées ») : seulement les 8 couleurs, jamais
 * l'annonce « Les chiffres débarquent », jamais le pavé des chiffres sur les tablettes. true = retour aux chiffres.
 */
const val SIMON_AVEC_CHIFFRES = false

/** Longueur maximale d'une suite : les équipes encore en jeu à ce stade gagnent toutes le tour. */
const val SIMON_LONGUEUR_MAX = 20

/** Tours par jeu, réglables dans la Régie PC, et par défaut. */
const val SIMON_TOURS = 3
const val SIMON_TOURS_MAX = 10

/** Temps pour taper une suite (secondes), réglable dans la Régie PC ; une seconde de plus par élément au-delà de 4. */
const val SIMON_REPONSE_SEC = 10
const val SIMON_REPONSE_MIN_SEC = 5
const val SIMON_REPONSE_MAX_SEC = 60

/** « Regardez bien… » avant la première boule, puis le temps de chaque boule allumée. */
const val SIMON_REGARDEZ_MS = 2_000L
const val SIMON_PAS_MS = 1_000L

/** Animation « Attention, les chiffres débarquent ! », avant la première suite à chiffres du jeu. */
const val SIMON_CHIFFRES_MS = 4_500L

/**
 * Vérification à la TV, colonne par colonne (le temps de chaque élément), puis le bandeau des éliminées ou des
 * gagnantes : les tablettes attendent jusque-là pour annoncer le résultat.
 */
const val SIMON_VERIF_PAS_MS = 700L
const val SIMON_VERIF_FIN_MS = 1_500L

/** Points du tour gagné (× 2 si le jeu est doublé). */
const val SIMON_POINTS = Scoring.MINI_WIN

/** Les éléments que les tablettes peuvent envoyer. */
val SIMON_ELEMENTS: Set<String> = (SIMON_COULEURS + SIMON_CHIFFRES).toSet()

/** Une équipe a tapé [items] ; [ms] = temps pour valider depuis le début du chrono (null : pas validé à temps). */
data class SimonAnswer(val items: List<String>, val ms: Long?)

/**
 * Bilan d'une suite : la suite n° [suite] (sa longueur), les réponses de chaque équipe en jeu, les équipes éliminées
 * ([wrong]), et les gagnantes du tour s'il est fini ([winners], avec leurs [points]). [bahAlors] : toutes se sont
 * trompées dès la première suite, personne n'est éliminé et la même suite se rejoue.
 */
data class SimonVerdict(
    val suite: Int,
    val answers: Map<String, SimonAnswer>,
    val wrong: List<String>,
    val winners: List<String>,
    val points: Int,
    val bahAlors: Boolean,
    val at: Long,
)

/**
 * Le tour [tour] du Simon (à partir de 1) : sa suite secrète [sequence] (tirée par la box), les équipes du tour [teams]
 * (celles inscrites à son début), celles éliminées et à quelle suite ([out]). [suite] : la suite en cours ou la dernière
 * jugée (sa longueur) ; [startAt] : heure où elle a été lancée (null : prête, pas lancée) ; [verdict] : son bilan.
 * [joues] : suites jouées par équipe dans tout le jeu (le joueur appelé change à chaque suite) ; [chiffresVus] : les
 * chiffres ont déjà été annoncés dans ce jeu.
 */
data class SimonRound(
    val tour: Int,
    val sequence: List<String>,
    val teams: List<String>,
    val out: Map<String, Int> = emptyMap(),
    val suite: Int = 1,
    val startAt: Long? = null,
    val verdict: SimonVerdict? = null,
    val joues: Map<String, Int> = emptyMap(),
    val chiffresVus: Boolean = false,
) {
    /** Équipes encore en jeu dans ce tour. */
    val enJeu: List<String> get() = teams.filter { it !in out }

    /** Suite lancée, pas encore jugée. */
    val enCours: Boolean get() = startAt != null && verdict == null

    /** Le tour a ses gagnantes. */
    val fini: Boolean get() = verdict?.winners?.isNotEmpty() == true

    /** Suite que le prochain lancement joue : la même (prête, ou « Bah alors »), sinon la suivante. */
    val prochaine: Int get() = verdict?.let { if (it.bahAlors) suite else suite + 1 } ?: suite

    /** La suite en cours (ou prête) commence par l'annonce des chiffres. */
    val annonceChiffres: Boolean get() = SIMON_AVEC_CHIFFRES && suite >= SIMON_CHIFFRES_DES && !chiffresVus

    /** Heure de la première boule, de la fin de la suite (le chrono part), et de la fin du chrono. */
    val montreAt: Long? get() = startAt?.let { it + (if (annonceChiffres) SIMON_CHIFFRES_MS else 0L) + SIMON_REGARDEZ_MS }
    val reponseAt: Long? get() = montreAt?.let { it + suite * SIMON_PAS_MS }
    fun finAt(reponseSec: Int): Long? = reponseAt?.let { it + reponseMs(suite, reponseSec) }

    /** Ce qu'il faut taper à la suite en cours. */
    val solution: List<String> get() = sequence.take(suite)

    /** Le face-à-face s'arrête sans bilan (pause, « Arrêter la suite ») : la même suite se relancera. */
    fun annule(): SimonRound = if (enCours) copy(startAt = null) else this

    /** Joueur appelé dans l'équipe [team] pour la suite en cours ou à venir, sur [joueurs] joueurs (n° à partir de 1). */
    fun joueur(team: String, joueurs: Int): Int = joueurAppele(joues[team] ?: 0, joueurs)

    /**
     * Le bilan de la suite en cours d'après les [answers] des équipes en jeu (une équipe sans réponse s'est trompée),
     * à l'heure [at] ; [points] = ceux du tour gagné.
     */
    fun bilan(answers: Map<String, SimonAnswer>, at: Long, points: Int): SimonVerdict {
        val enJeu = enJeu
        val reponses = enJeu.associateWith { answers[it] ?: SimonAnswer(emptyList(), null) }
        val bonnes = reponses.mapValues { (_, a) -> justes(a.items, solution) }
        val wrong = enJeu.filter { (bonnes[it] ?: 0) < suite }
        val restantes = enJeu - wrong.toSet()
        val winners = when {
            // Toutes en erreur dès la première suite : personne ne sort, Sarah relance.
            wrong.size == enJeu.size && suite == 1 -> return SimonVerdict(suite, reponses, emptyList(), emptyList(), 0, true, at)
            // Toutes en erreur sur la même suite : la plus avancée, à égalité la plus rapide à valider.
            restantes.isEmpty() -> {
                val loin = wrong.maxOf { bonnes[it] ?: 0 }
                val avancees = wrong.filter { (bonnes[it] ?: 0) == loin }
                val vite = avancees.minOf { reponses[it]?.ms ?: Long.MAX_VALUE }
                avancees.filter { (reponses[it]?.ms ?: Long.MAX_VALUE) == vite }
            }
            // La dernière équipe en jeu (avec au moins 2 équipes au départ du tour).
            restantes.size == 1 && teams.size >= 2 -> restantes
            // Suite la plus longue réussie : toutes celles qui restent gagnent.
            suite >= sequence.size -> restantes
            else -> emptyList()
        }
        return SimonVerdict(suite, reponses, wrong.filter { it !in winners }, winners, if (winners.isEmpty()) 0 else points, false, at)
    }
}

/** Éléments justes au début de [tape] par rapport à [solution] (on s'arrête à la première erreur). */
fun justes(tape: List<String>, solution: List<String>): Int {
    var n = 0
    while (n < solution.size && n < tape.size && tape[n] == solution[n]) n++
    return n
}

/** Temps pour taper une suite de [longueur] éléments : [reponseSec], plus une seconde par élément au-delà de 4. */
fun reponseMs(longueur: Int, reponseSec: Int): Long =
    reponseSec.coerceIn(SIMON_REPONSE_MIN_SEC, SIMON_REPONSE_MAX_SEC) * 1_000L + (longueur - 4).coerceAtLeast(0) * 1_000L

/**
 * La suite secrète d'un tour, [longueur] éléments : des couleurs jusqu'au rang [SIMON_CHIFFRES_DES] − 1, un chiffre à ce
 * rang, puis couleurs et chiffres au hasard ; jamais deux fois le même élément de suite. Sans chiffres
 * ([SIMON_AVEC_CHIFFRES]) : que des couleurs.
 */
fun suiteSimon(longueur: Int = SIMON_LONGUEUR_MAX, random: Random = Random.Default): List<String> {
    val suite = mutableListOf<String>()
    for (rang in 1..longueur) {
        val famille = when {
            !SIMON_AVEC_CHIFFRES || rang < SIMON_CHIFFRES_DES -> SIMON_COULEURS
            rang == SIMON_CHIFFRES_DES -> SIMON_CHIFFRES
            random.nextBoolean() -> SIMON_CHIFFRES
            else -> SIMON_COULEURS
        }
        suite += famille.filter { it != suite.lastOrNull() }.random(random)
    }
    return suite
}
