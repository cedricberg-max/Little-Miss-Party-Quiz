package com.littlemissparty.quiz.engine

/** Type d'épreuve d'une question. Les mini-jeux s'ajouteront ici. */
enum class QuestionKind(val code: String) {
    /** Quatre propositions, une seule bonne. */
    CLASSIC("classic"),

    /** Deux propositions : Vrai ou Faux. */
    TRUE_FALSE("true_false"),

    /** Mimes : toute une manche, jouée équipe par équipe sur un paquet de cartes ([Question.cards]). */
    MIME("mime"),

    /**
     * Le Juste Chiffre : chaque équipe tape un nombre sur son pupitre, la ou les plus proches gagnent.
     * Pas de propositions ; [Question.correct] est le nombre à trouver.
     */
    NUMBER("number"),

    /**
     * Vrai ou Faux express : une série d'affirmations (deux propositions, Vrai puis Faux) au chrono court,
     * que la TV ferme, révèle et enchaîne toute seule jusqu'à la fin de la manche.
     */
    EXPRESS("express"),

    /**
     * Zoom mystère : une question à propositions dont la photo ([Question.imageId]) part très zoomée sur la
     * TV et se dévoile au fil du chrono ; la révélation la montre entière. Points du quiz classique.
     */
    ZOOM("zoom"),

    /**
     * Image floue : la photo ([Question.imageId]) devient de plus en plus nette ; la première équipe qui
     * buzze répond à voix haute et l'animatrice valide. La réponse est la proposition [Question.correct].
     */
    FLOU("flou"),

    /**
     * Chante le mot ! (inspiré de « Vendredi tout est permis ») : un mot s'affiche ([Question.text]) ; la
     * première équipe qui buzze chante un bout de chanson qui le contient. Réponse unique : le mot lui-même.
     */
    CHANTE("chante"),

    /**
     * Qui suis-je ? : les indices ([Question.cards], dans l'ordre) apparaissent un à un au fil du chrono ; la
     * première équipe qui buzze dit qui c'est. Réponse unique : [Question.choices] contient le personnage.
     */
    QUISUIS("quisuis"),

    /**
     * Blind test : un extrait musical ([Question.audioId]) joue sur la TV ; la première équipe qui buzze donne
     * le titre à voix haute et l'animatrice valide, avec un bonus si l'équipe cite aussi [Question.artist].
     * Réponse unique : [Question.choices] contient le titre. La musique suit le chrono : elle se fige au buzz
     * et pendant une pause, puis reprend là où elle s'était arrêtée.
     */
    BLIND("blind"),

    /**
     * Statues musicales (cedric, 27/10) : une chanson par tour, jouée entière sur la TV ; Sarah la coupe quand elle
     * veut (STATUE !), tout le monde se fige, puis elle désigne les équipes gagnantes de la chanson (voir [StatuesRound]).
     * Pas de propositions ni de pupitre à toucher.
     */
    STATUES("statues"),

    /**
     * Qui a disparu ? : des objets ([Question.cards], émoji et nom) s'affichent sur la TV le temps de les
     * mémoriser ([Question.memoMs]), puis disparaissent un instant ; quand ils reviennent, il en manque un.
     * La première équipe qui buzze dit lequel. Le buzzer n'ouvre qu'au retour des objets ([Question.buzzFromMs]).
     * Réponse unique : [Question.choices] contient le nom de l'objet disparu, qui est l'une des cartes.
     */
    DISPARU("disparu"),

    /**
     * Pictionary : toute une manche, jouée équipe par équipe comme les mimes, sur un paquet de mots ([Question.cards]).
     * L'animatrice montre le mot (et son image) sur la tablette de l'équipe qui joue, le reste de l'équipe tourné ;
     * puis elle le masque : la tablette devient une feuille à dessin, le dessin s'affiche en direct sur la TV et le
     * chrono du tour part. Un seul mot par tour : trouvé, il rapporte [Question.points] à l'équipe ; chrono écoulé,
     * le tour est perdu.
     */
    PICTIONARY("pictionary"),

    /**
     * Portes mystères (jeu final, façon Mario Kart) : chaque équipe choisit en secret une porte sur sa tablette ;
     * derrière chacune, un bonus ou un malus ([Question.doors]) qui peut renverser le classement. L'animatrice
     * ouvre les portes une à une, puis montre le classement final. Plusieurs équipes peuvent prendre la même porte.
     */
    PORTES("portes"),

    /**
     * Les coffres mystères : des coffres ouverts chacun son tour, depuis la tablette de l'équipe qui joue. Chaque coffre
     * cache un bonus ou un malus, tiré au sort par la box à son ouverture. Après quelques tours sans danger, une bombe
     * se cache dans un des coffres restants, avec un coffre en or ([GOLD_POINTS]) : l'équipe qui ouvre la bombe perd
     * [BOMB_POINTS] points et le jeu s'arrête. Rien à préparer : ni propositions ni valeurs, tout se décide au hasard
     * pendant la partie.
     */
    COFFRES("coffres"),

    /**
     * Le Gonfleur fou : chaque équipe tapote sa tablette pour gonfler son ballon sur la TV ; le premier qui éclate
     * gagne. [Question.durationSec] est un chrono de secours : à la fin, le plus gros ballon gagne.
     */
    GONFLEUR("gonfleur"),

    /**
     * « Ça va exploser ! » : une bombe passe d'équipe en équipe depuis les tablettes ; sa mèche, tirée au sort, est
     * cachée. L'équipe qui la tient à l'explosion perd des points, les autres en gagnent. Rien à préparer.
     */
    PATATE("patate"),

    /**
     * 🤠 Le Duel des robots : deux équipes face à face, un joueur de chaque côté ; la première qui buzze après le PAN de
     * la TV gagne, celle qui buzze avant perd (voir [DuelRound]). Rien à préparer que les joueurs et la durée.
     */
    DUEL("duel");

    companion object {
        fun of(code: String?): QuestionKind = entries.firstOrNull { it.code == code } ?: CLASSIC
    }
}

data class Question(
    val id: String,
    val text: String,
    val choices: List<String>,
    val correct: Int,
    val durationSec: Int = 20,
    val kind: QuestionKind = QuestionKind.CLASSIC,
    /** Question de Super Finale : points doublés. */
    val double: Boolean = false,
    /** Manche de la prestation (titre affiché sur le conducteur de la régie). */
    val roundTitle: String? = null,
    /** Mimes seulement : les cartes, dans l'ordre où elles apparaîtront. */
    val cards: List<MimeCard> = emptyList(),
    /**
     * Illustration facultative montrée à la révélation : un émoji ([emoji]) ou une photo préparée dans
     * l'administration ([imageId], lue dans games/<code>/images). Absente ou introuvable : rien ne change.
     */
    val emoji: String? = null,
    val imageId: String? = null,
    /**
     * Réponses en images (quiz des petits) : une photo par proposition, dans l'ordre des propositions, lue dans
     * games/<code>/choiceImages. Vide : propositions en texte. Une proposition sans photo reste en texte.
     */
    val choiceImages: List<String?> = emptyList(),
    /** Portes mystères : la valeur cachée derrière chaque porte (bonus positif, malus négatif), dans l'ordre des portes. */
    val doors: List<Int> = emptyList(),
    /** Blind test : l'artiste ou l'œuvre (dessin animé, film…), montré à la révélation ; facultatif. */
    val artist: String? = null,
    /**
     * Extrait musical joué sur la TV pendant la question (games/<code>/sounds) : celui du blind test, ou d'une
     * question de quiz musical à propositions. Absent ou introuvable : la question se joue sans musique.
     */
    val audioId: String? = null,
    /**
     * Statues musicales : les chansons choisies par Sarah, jouées l'une après l'autre (puis de nouveau la première).
     * Vide : la musique maison de la TV.
     */
    val audioIds: List<String> = emptyList(),
    /**
     * Statues musicales (depuis le 27/10) : les chansons, chacune un tour, jouées entières ([ChansonStatues.songId])
     * ou, à défaut, par leur extrait. Vide : les extraits de [audioIds] (programmes d'avant).
     */
    val songs: List<ChansonStatues> = emptyList(),
    /**
     * Blind test : extrait du refrain (environ 90 s), joué plus fort et en boucle à la révélation, jusqu'au
     * « Titre suivant » de l'animatrice (« on chante tous ensemble »). Absent : l'extrait du morceau est rejoué.
     */
    val refrainId: String? = null,
    /**
     * Blind test : paroles du refrain sous leur forme courte (voir Paroles.kt), temps depuis le début de l'extrait du
     * refrain. Absentes : la révélation montre la pochette et le disque, sans paroles.
     */
    val lyrics: String? = null,
    /** Blind test : valeur du morceau (points de l'équipe qui trouve), réglée dans l'administration. */
    val points: Int? = null,
    /** Blind test : durée de la séquence de révélation (extrait rejoué, pochette, titre, points), en secondes. */
    val revealSec: Int = BLIND_REVEAL_SEC,
    /** « Ça va exploser ! » : nombre de bombes de la partie, réglé dans la Régie PC (1 à [POTATO_BOMBS_MAX]). */
    val bombs: Int = POTATO_BOMBS,
    /**
     * Mimes en file (cedric, 23/10 puis 26/10) : couleur (« #F5D000 ») de la seule équipe qui joue cette manche, préparée
     * pour elle dans la Régie PC. Null : manche jouée tour à tour par toutes les équipes.
     */
    val couleur: String? = null,
    /** Le Duel des robots : nombre approximatif de joueurs par équipe (tout le monde joue), réglé dans la Régie PC. */
    val joueurs: Int = DUEL_JOUEURS,
    /** Le Duel des robots : durée du face-à-face avant le PAN, tirée entre ces bornes (secondes). */
    val faceMin: Int = DUEL_FACE_DEFAUT_MIN,
    val faceMax: Int = DUEL_FACE_DEFAUT_MAX,
    /** Le Duel des robots : de temps en temps un long duel, jusqu'à 60 s. */
    val longs: Boolean = true,
) {
    /** Paroles du refrain, phrase par phrase et mot par mot (vide : pas de paroles). */
    val paroles: List<LigneParole> by lazy { lireParoles(lyrics) }

    init {
        require(id.isNotBlank()) { "Question sans identifiant" }
        require(text.isNotBlank()) { "Question $id : texte vide" }
        if (kind == QuestionKind.MIME || kind == QuestionKind.PICTIONARY) {
            // Pour les mimes et le Pictionary, la durée est celle du tour de chaque équipe.
            require(cards.size in 1..MAX_MIME_CARDS) { "Mimes $id : il faut 1 à $MAX_MIME_CARDS cartes" }
            require(cards.none { it.word.isBlank() }) { "Mimes $id : carte sans mot" }
            // Mimes : durée du tour réglée à la seconde près dans la Régie PC (cedric, 26/10), jusqu'à 5 minutes.
            require(durationSec in 15..MAX_MIME_TURN_SEC) { "Mimes $id : tour entre 15 et $MAX_MIME_TURN_SEC s" }
            require(points == null || points in 1..MAX_TRACK_POINTS) { "Pictionary $id : valeur entre 1 et $MAX_TRACK_POINTS points" }
        } else if (kind == QuestionKind.CHANTE || kind == QuestionKind.QUISUIS || kind == QuestionKind.BLIND) {
            // Réponse orale jugée par l'animatrice : une seule réponse attendue, pas de propositions à l'écran.
            require(choices.size == 1 && choices[0].isNotBlank() && correct == 0) { "Question $id : une seule réponse attendue" }
            require(kind != QuestionKind.QUISUIS || cards.size in 2..MAX_CLUES) { "Qui suis-je $id : il faut 2 à $MAX_CLUES indices" }
            require(cards.none { it.word.isBlank() }) { "Question $id : indice vide" }
            require(durationSec in 10..120) { "Question $id : durée entre 10 et 120 s" }
            require(points == null || points in 1..MAX_TRACK_POINTS) { "Blind test $id : valeur entre 1 et $MAX_TRACK_POINTS points" }
            require(revealSec == 0 || revealSec in 3..60) { "Blind test $id : révélation entre 3 et 60 s, ou tout l'extrait" }
        } else if (kind == QuestionKind.DISPARU) {
            require(choices.size == 1 && correct == 0) { "Qui a disparu $id : une seule réponse attendue" }
            require(cards.size in 4..MAX_DISPARU) { "Qui a disparu $id : il faut 4 à $MAX_DISPARU objets" }
            require(cards.none { it.word.isBlank() }) { "Qui a disparu $id : objet sans nom" }
            require(cards.count { it.word == choices[0] } == 1) { "Qui a disparu $id : l'objet disparu doit être un des objets" }
            require(durationMs >= buzzFromMs + 15_000 && durationSec <= 120) { "Qui a disparu $id : durée trop courte ou trop longue" }
        } else if (kind == QuestionKind.STATUES) {
            require(choices.isEmpty()) { "Statues musicales $id : pas de propositions" }
            require(durationSec in 30..180) { "Statues musicales $id : durée entre 30 et 180 s" }
        } else if (kind == QuestionKind.PORTES) {
            require(choices.size in 2..MAX_DOORS && choices.none { it.isBlank() }) { "Portes mystères $id : il faut 2 à $MAX_DOORS portes" }
            require(doors.size == choices.size) { "Portes mystères $id : une valeur par porte" }
            require(doors.all { it in -MAX_DOOR_POINTS..MAX_DOOR_POINTS }) { "Portes mystères $id : valeur hors limites" }
            require(durationSec in 10..120) { "Portes mystères $id : durée entre 10 et 120 s" }
        } else if (kind == QuestionKind.COFFRES) {
            require(choices.isEmpty()) { "Coffres mystères $id : pas de propositions" }
        } else if (kind == QuestionKind.PATATE) {
            require(choices.isEmpty()) { "Ça va exploser $id : pas de propositions" }
        } else if (kind == QuestionKind.DUEL) {
            require(choices.isEmpty()) { "Duel des robots $id : pas de propositions" }
            require(joueurs in 1..DUEL_JOUEURS_MAX) { "Duel des robots $id : 1 à $DUEL_JOUEURS_MAX joueurs par équipe" }
            require(faceMin in DUEL_FACE_MIN_SEC..faceMax && faceMax <= DUEL_FACE_MAX_SEC) { "Duel des robots $id : face-à-face entre $DUEL_FACE_MIN_SEC et $DUEL_FACE_MAX_SEC s" }
        } else if (kind == QuestionKind.GONFLEUR) {
            require(choices.isEmpty()) { "Gonfleur fou $id : pas de propositions" }
            require(durationSec in 20..180) { "Gonfleur fou $id : durée entre 20 et 180 s" }
        } else if (kind == QuestionKind.NUMBER) {
            require(choices.isEmpty()) { "Juste Chiffre $id : pas de propositions" }
            require(correct in -MAX_NUMBER..MAX_NUMBER) { "Juste Chiffre $id : nombre hors limites" }
            require(durationSec in 5..120) { "Question $id : durée entre 5 et 120 s" }
        } else {
            require(choices.size in 2..4) { "Question $id : il faut 2 à 4 propositions" }
            require(kind != QuestionKind.EXPRESS || choices.size == 2) { "Vrai ou Faux express $id : il faut 2 propositions" }
            require(kind != QuestionKind.ZOOM || imageId != null) { "Zoom mystère $id : il faut une photo" }
            require(kind != QuestionKind.FLOU || imageId != null) { "Image floue $id : il faut une photo" }
            require(choices.none { it.isBlank() }) { "Question $id : proposition vide" }
            require(choiceImages.isEmpty() || choiceImages.size == choices.size) { "Question $id : une photo par proposition" }
            require(correct in choices.indices) { "Question $id : bonne réponse hors des propositions" }
            require(durationSec in 5..120) { "Question $id : durée entre 5 et 120 s" }
        }
    }

    val isMime: Boolean get() = kind == QuestionKind.MIME
    val isPicto: Boolean get() = kind == QuestionKind.PICTIONARY
    val isPortes: Boolean get() = kind == QuestionKind.PORTES
    val isCoffres: Boolean get() = kind == QuestionKind.COFFRES
    val isGonfleur: Boolean get() = kind == QuestionKind.GONFLEUR
    val isPatate: Boolean get() = kind == QuestionKind.PATATE
    val isDuel: Boolean get() = kind == QuestionKind.DUEL

    /** Jeu joué équipe par équipe, tour après tour (mimes, Pictionary) : le chrono part au lancement de chaque tour. */
    val isTurns: Boolean get() = isMime || isPicto

    /** Points d'un mime ou d'un dessin trouvé. */
    val foundPoints: Int get() = if (isPicto) points ?: Scoring.PICTO else Scoring.MIME
    val isNumber: Boolean get() = kind == QuestionKind.NUMBER
    val isExpress: Boolean get() = kind == QuestionKind.EXPRESS
    val isZoom: Boolean get() = kind == QuestionKind.ZOOM
    val isFlou: Boolean get() = kind == QuestionKind.FLOU
    val isChante: Boolean get() = kind == QuestionKind.CHANTE
    val isQuiSuis: Boolean get() = kind == QuestionKind.QUISUIS
    val isBlind: Boolean get() = kind == QuestionKind.BLIND
    val isStatues: Boolean get() = kind == QuestionKind.STATUES
    val isDisparu: Boolean get() = kind == QuestionKind.DISPARU

    /** Quiz musical : une question à propositions jouée sur un extrait (le bon titre parmi quatre). */
    val isMusical: Boolean get() = kind == QuestionKind.CLASSIC && audioId != null

    /** Qui a disparu ? : temps pour mémoriser les objets, deux secondes par objet (10 à 18 s). */
    val memoMs: Long get() = if (isDisparu) (cards.size * 2_000L).coerceIn(10_000L, 18_000L) else 0L

    /** Chrono écoulé à partir duquel on peut buzzer : après la mémorisation et le tour de magie (Qui a disparu ?). */
    val buzzFromMs: Long get() = if (isDisparu) memoMs + DISPARU_MAGIE_MS else 0L

    /** Qui a disparu ? : place de l'objet disparu dans la grille. */
    val missingIndex: Int get() = if (isDisparu) cards.indexOfFirst { it.word == choices[0] } else -1

    /** Statues musicales : les chansons jouées, une par tour ([songs], sinon les extraits d'avant). */
    val statuesSongs: List<ChansonStatues> get() = songs.ifEmpty { audioIds.map { ChansonStatues(null, it) } }

    /** Statues musicales : nombre de tours, un par chanson (un seul sur la musique maison de la TV). */
    val statuesTours: Int get() = statuesSongs.size.coerceAtLeast(1)

    /** Blind test : points de l'équipe qui trouve ce morceau (avant le ×2 de la Super Finale). */
    val trackPoints: Int get() = points ?: Scoring.BLIND_POINTS

    /** Jeux au buzzer : la première équipe qui buzze répond à voix haute, l'animatrice valide. */
    /** Au moins une proposition en image. */
    val hasChoiceImages: Boolean get() = choiceImages.any { it != null }
    val isBuzz: Boolean get() = isFlou || isChante || isQuiSuis || isBlind || isDisparu

    /**
     * Qui suis-je ? : nombre d'indices visibles après [elapsedMs] de chrono. Le premier dès l'ouverture,
     * puis un nouveau à intervalles réguliers ; tous sont visibles avant la fin du chrono.
     */
    fun cluesShown(elapsedMs: Long): Int {
        if (!isQuiSuis) return 0
        val step = durationMs / cards.size
        return (1 + (elapsedMs.coerceAtLeast(0) / step).toInt()).coerceAtMost(cards.size)
    }

    val durationMs: Long get() = durationSec * 1000L
}

/**
 * [intros] : chaque jeu (manche) s'ouvre sur un écran de présentation qui attend que l'animatrice le lance.
 * Vrai pour les prestations ; les quiz des tests du moteur s'en passent.
 */
data class Quiz(val id: String, val title: String, val questions: List<Question>, val intros: Boolean = false) {
    init {
        require(questions.isNotEmpty()) { "Quiz $id : aucune question" }
        val dup = questions.groupBy { it.id }.filter { it.value.size > 1 }.keys
        require(dup.isEmpty()) { "Quiz $id : identifiants en double $dup" }
    }
}

/** Carte de mime : le mot à faire deviner et son image (un emoji du catalogue intégré, facultatif). */
data class MimeCard(val word: String, val image: String? = null, val imageId: String? = null)

const val MAX_MIME_CARDS = 200

/** Tour de mimes (ou de Pictionary) le plus long, en secondes. */
const val MAX_MIME_TURN_SEC = 300

/** Portes mystères : nombre de portes au plus, et valeur la plus forte (bonus ou malus) derrière une porte. */
const val MAX_DOORS = 4
const val MAX_DOOR_POINTS = 1000

/** Qui suis-je ? : nombre maximum d'indices d'un personnage. */
const val MAX_CLUES = 6

/** Blind test : valeur maximale d'un morceau. */
const val MAX_TRACK_POINTS = 1_000

/** Blind test : durée par défaut de la séquence de révélation (secondes). */
const val BLIND_REVEAL_SEC = 7

/** Qui a disparu ? : nombre maximum d'objets dans la grille. */
const val MAX_DISPARU = 12

/** Qui a disparu ? : durée du tour de magie, objets cachés, entre la mémorisation et la recherche. */
const val DISPARU_MAGIE_MS = 3_000L

/** Le Juste Chiffre : nombres de -999 999 999 à 999 999 999 (ce que le pupitre laisse taper). */
const val MAX_NUMBER = 999_999_999
