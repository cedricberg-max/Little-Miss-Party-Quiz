package com.littlemissparty.quiz.engine

/**
 * Journal de la partie. Chaque action de l'animatrice ou de la box y est inscrite
 * avec un numéro croissant ([seq]) et l'heure du serveur ([at], en millisecondes).
 * L'état de la partie (scores compris) se reconstruit entièrement en rejouant ce journal :
 * c'est ce qui permet de reprendre une partie après un redémarrage sans rien perdre.
 */
sealed interface GameEvent {
    val seq: Int
    val at: Long
}

data class QuestionOpened(override val seq: Int, override val at: Long, val index: Int, val qid: String) : GameEvent
/**
 * Pause générale, possible à toute étape d'une partie commencée : chrono, réponses et progression
 * sont figés, scores et manche conservés. [reason] dit qui l'a demandée : [PAUSE_REGIE] (animatrice)
 * ou [PAUSE_TEAM] (pupitre de l'équipe [team] déconnecté en pleine question).
 */
data class Paused(
    override val seq: Int,
    override val at: Long,
    val reason: String = PAUSE_REGIE,
    val team: String? = null,
) : GameEvent

/**
 * Reprise, toujours décidée par l'animatrice. Le chrono repart [countdownMs] après l'appui,
 * le temps du décompte 3, 2, 1 affiché sur la TV et les pupitres.
 */
data class Resumed(override val seq: Int, override val at: Long, val countdownMs: Long = 0) : GameEvent

const val PAUSE_REGIE = "regie"
const val PAUSE_TEAM = "team"
/** Pause automatique : la box a perdu Internet, les tablettes ne reçoivent plus la question. */
const val PAUSE_NETWORK = "network"

/** Coupure tolérée avant la pause automatique (micro-coupure du Wi-Fi, changement de borne). */
const val NETWORK_GRACE_MS = 4000L

/** Durée du décompte 3, 2, 1 à la reprise. */
const val RESUME_COUNTDOWN_MS = 3000L

/** Délai pendant lequel la télécommande ne peut pas arrêter un chrono qui vient de partir (double appui sur OK). */
const val CLOSE_GUARD_MS = 1500L

/** Plus aucune réponse n'est acceptée pour la question en cours. */
data class QuestionClosed(override val seq: Int, override val at: Long) : GameEvent

/** Bonne réponse révélée, points attribués. Les points sont figés ici une fois pour toutes. */
data class Revealed(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val awards: Map<String, Award>,
) : GameEvent

data class ScoresShown(override val seq: Int, override val at: Long) : GameEvent

/**
 * Dernières questions du quiz à points multipliés : l'animatrice choisit, juste avant la première, le
 * multiplicateur de toute la série qui commence à la question [start] (×2 si elle ne touche à rien).
 */
data class FactorChosen(override val seq: Int, override val at: Long, val start: Int, val factor: Int) : GameEvent

/**
 * Portes mystères : l'animatrice change la valeur cachée derrière la porte [door] (bonus ou malus), avant
 * l'ouverture des portes, pour changer un peu le cours des choses.
 */
data class DoorSet(override val seq: Int, override val at: Long, val qid: String, val door: Int, val value: Int) : GameEvent

/**
 * Écran de présentation d'un jeu terminé : l'animatrice a expliqué les règles et lance la première question
 * (ou la première manche) du jeu. Le chrono, la musique ou le premier tour partent seulement maintenant.
 */
data class GameLaunched(override val seq: Int, override val at: Long) : GameEvent

/** Valeurs possibles derrière une porte (points), bornes comprises. */
val DOOR_VALUES = -500..1000

/** Multiplicateurs proposés à l'animatrice pour les dernières questions du quiz ; le premier est celui par défaut. */
val FACTORS = listOf(2, 3, 5)

/** Portes mystères : l'animatrice ouvre la porte suivante (dans l'ordre de [Game.doorOrder]). */
data class DoorOpened(override val seq: Int, override val at: Long, val qid: String) : GameEvent

/**
 * La bombe cachée : la box installe les coffres de la manche [qid] dès le lancement du jeu. [order] : ordre de jeu
 * des équipes (la plus en retard d'abord), [count] coffres, [safe] ouvertures sans bombe possible.
 */
data class ChestsDealt(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val order: List<String>,
    val count: Int,
    val safe: Int,
) : GameEvent

/**
 * La bombe cachée : l'équipe [team] ouvre le coffre [chest]. Son contenu, tiré au sort par la box à cet instant, est
 * inscrit ici une fois pour toutes : [delta] = points comptés (malus réduit au score), [bomb] = c'était la bombe.
 */
data class ChestOpened(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val team: String,
    val chest: Int,
    val delta: Int,
    val bomb: Boolean,
) : GameEvent

/** Correction manuelle d'un score (régie). */
data class ScoreAdjusted(
    override val seq: Int,
    override val at: Long,
    val team: String,
    val delta: Int,
    val reason: String = "",
) : GameEvent

/** Annule l'événement numéro [target] (seules les corrections de score sont annulables pour l'instant). */
data class Undone(override val seq: Int, override val at: Long, val target: Int) : GameEvent

data class GameEnded(override val seq: Int, override val at: Long) : GameEvent

/** Réponse d'une équipe : proposition choisie et heure du serveur à la réception. */
data class Answer(val choice: Int, val at: Long)

/** Points gagnés par une équipe sur une question ([points] inclut déjà le bonus et le doublement). */
data class Award(val choice: Int?, val correct: Boolean, val points: Int, val bonus: Int)

/*
 * Mimes : une manche entière jouée équipe par équipe. La régie choisit l'équipe et lance son tour ;
 * chaque mime trouvé rapporte [Scoring.MIME] points et fait apparaître la carte suivante.
 */

/** Tour de l'équipe [team] lancé : le chrono du tour démarre, la première carte s'affiche. */
data class MimeTurnStarted(override val seq: Int, override val at: Long, val team: String) : GameEvent

/**
 * Pictionary : trois mots s'affichent sur la tablette de l'équipe [team] (le reste de l'équipe est tourné) ; le
 * dessinateur en choisit un. Aucun chrono : il part quand l'animatrice masque le mot ([MimeTurnStarted]).
 */
data class PictoShown(override val seq: Int, override val at: Long, val team: String) : GameEvent

/** Pictionary : le dessinateur choisit, sur sa tablette, le mot [choice] (0 à 2) parmi ceux qui lui sont proposés. */
data class PictoChosen(override val seq: Int, override val at: Long, val choice: Int) : GameEvent

/** Mime trouvé, validé par l'animatrice : un point pour l'équipe qui joue, carte suivante. */
data class MimeFound(override val seq: Int, override val at: Long) : GameEvent

/** Carte passée, sans point : elle repart sous le paquet. */
data class MimePassed(override val seq: Int, override val at: Long) : GameEvent

/** Correction de l'animatrice (+1 ou −1) sur les mimes trouvés par [team] pendant cette manche, jamais sous zéro. */
data class MimeCorrected(override val seq: Int, override val at: Long, val team: String, val delta: Int) : GameEvent

/** Fin du tour : chrono écoulé, paquet épuisé ou arrêt par l'animatrice. */
data class MimeTurnEnded(override val seq: Int, override val at: Long) : GameEvent

/**
 * Blind test : l'animatrice lance (ou relance) la musique du morceau ; les buzzers s'ouvrent. [unblock] :
 * toutes les équipes avaient déjà tenté leur chance, elles peuvent toutes rebuzzer.
 */
data class BlindPlayed(override val seq: Int, override val at: Long, val unblock: Boolean = false) : GameEvent

/** Blind test : la musique s'arrête (fin de l'extrait, ou l'animatrice l'arrête) ; on attend sa relance. */
data class BlindStopped(override val seq: Int, override val at: Long) : GameEvent

/** Blind test : l'animatrice réautorise toutes les équipes à buzzer sur ce morceau. */
data class BuzzUnblocked(override val seq: Int, override val at: Long) : GameEvent

/** Blind test : morceau [qid] passé sans révélation ; le morceau suivant s'annonce (ou le bilan à la fin). */
data class BlindSkipped(override val seq: Int, override val at: Long, val qid: String) : GameEvent

/** Blind test : l'animatrice raccourcit la révélation du morceau [qid] (musique et animation coupées). */
data class RevealCut(override val seq: Int, override val at: Long, val qid: String) : GameEvent

/** Qui a disparu ? : la mémorisation est finie, les objets reviennent (sans l'un d'eux) et le buzzer s'ouvre. */
data class BuzzArmed(override val seq: Int, override val at: Long) : GameEvent

/** Image floue : l'équipe [team] a buzzé la première ; le chrono et la photo se figent pendant sa réponse orale. */
data class Buzzed(override val seq: Int, override val at: Long, val team: String) : GameEvent

/**
 * Image floue : l'animatrice juge la réponse orale de l'équipe qui a buzzé. Bonne : ses points et la
 * révélation. Mauvaise : l'équipe est bloquée sur cette image, la photo reprend et les autres peuvent buzzer.
 */
/**
 * Statues musicales : l'animatrice désigne l'équipe gagnante [team] ; les autres équipes qui ont joué
 * ([others]) marquent aussi, un peu moins. Révélation.
 */
data class StatuesWon(override val seq: Int, override val at: Long, val team: String, val others: List<String>) : GameEvent

data class BuzzJudged(override val seq: Int, override val at: Long, val ok: Boolean, val bonus: Boolean = false) : GameEvent

/**
 * Saut de la régie vers la question [index] (début d'un jeu de la prestation), en avant comme en arrière.
 * Les points des questions [clear] sont retirés : un jeu rejoué ne compte jamais deux fois.
 */
data class Jumped(override val seq: Int, override val at: Long, val index: Int, val qid: String, val clear: List<String> = emptyList()) : GameEvent
