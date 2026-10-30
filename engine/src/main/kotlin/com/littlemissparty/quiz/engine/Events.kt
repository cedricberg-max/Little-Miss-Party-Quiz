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

/** Raison d'une correction de points donnée à la télécommande de la box. */
const val REASON_REMOTE = "télécommande"

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
 * La régie quitte le jeu en cours pour un autre jeu (cedric, 24/10) : bilan des scores d'abord, comme à la fin
 * normale d'un jeu, puis « suivant » saute au jeu [qid] (première question du jeu choisi).
 */
data class GameLeft(override val seq: Int, override val at: Long, val qid: String) : GameEvent

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
 * Les coffres mystères : la box installe les coffres de la manche [qid] dès le lancement du jeu. [order] : ordre de jeu
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
 * Les coffres mystères : l'équipe [team] ouvre le coffre [chest]. Son contenu, tiré au sort par la box à cet instant, est
 * inscrit ici une fois pour toutes : [delta] = points comptés (malus réduit au score), [bomb] = c'était la bombe,
 * [gold] = c'était le coffre en or.
 */
data class ChestOpened(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val team: String,
    val chest: Int,
    val delta: Int,
    val bomb: Boolean,
    val gold: Boolean = false,
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

/**
 * Game Show : après le podium, la musique attend en boucle pendant que l'animatrice parle aux enfants ; son « ▶ Lancer
 * la fin » (le bouton « suivant » de la fin de partie) lance l'outro du robot en fusée puis l'écran de fin (cedric, 29/10).
 */
data class OutroLaunched(override val seq: Int, override val at: Long) : GameEvent

/**
 * Mauvaise prestation lancée (cedric, 21/10) : la régie en a choisi une autre alors que la partie avait commencé, mais
 * qu'aucun point n'avait encore été donné ([Game.mayReplaceProgram]). La partie repart du salon d'attente avec le
 * nouveau programme ; tout ce qui précède dans le journal est ignoré (progression, réglages), la numérotation continue.
 * Les équipes, rangées hors du journal, restent.
 */
data class ProgramReset(override val seq: Int, override val at: Long) : GameEvent

/** Réponse d'une équipe : proposition choisie et heure du serveur à la réception. */
data class Answer(val choice: Int, val at: Long)

/** Points gagnés par une équipe sur une question ([points] inclut déjà le bonus et le doublement). */
data class Award(val choice: Int?, val correct: Boolean, val points: Int, val bonus: Int)

/*
 * Mimes : une manche entière jouée équipe par équipe. La régie choisit l'équipe et lance son tour ;
 * chaque mime trouvé rapporte [Scoring.MIME] points, puis deux autres joueurs prennent le relais et l'animatrice
 * montre la carte suivante.
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

/**
 * Mime trouvé, validé par l'animatrice : un point pour l'équipe qui joue ; la carte suivante attend le changement de
 * joueur (« Image suivante », [MimePassed]).
 */
data class MimeFound(override val seq: Int, override val at: Long) : GameEvent

/**
 * « Image suivante » : carte passée, sans point, elle repart sous le paquet ; pendant un changement de joueur, montre
 * l'image qui attendait.
 */
data class MimePassed(override val seq: Int, override val at: Long) : GameEvent

/**
 * Mimes en file (cedric, 26/10) : « ⏭ Passer », le mimeur abandonne son image. Elle repart sous le paquet, sans point,
 * et les joueurs tournent comme après un mime trouvé : l'écran se vide jusqu'à « Image suivante ».
 */
data class MimeSkipped(override val seq: Int, override val at: Long) : GameEvent

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

/** Statues musicales (depuis le 27/10) : « ✋ STATUE ! », Sarah coupe la musique de la chanson en cours. */
data class StatuesStopped(override val seq: Int, override val at: Long, val qid: String) : GameEvent

/** Statues musicales : « 💃 On danse ! », la musique reprend là où elle s'était arrêtée. */
data class StatuesDanced(override val seq: Int, override val at: Long, val qid: String) : GameEvent

/** Statues musicales : la chanson [song] est allée au bout (la box le voit à sa lecture) ; Sarah désigne les gagnantes. */
data class StatuesSongEnded(override val seq: Int, override val at: Long, val qid: String, val song: Int) : GameEvent

/**
 * Statues musicales : Sarah désigne les gagnantes de la chanson [song] ([winners], vide pour « Personne ») ; la chanson
 * s'arrête. [others] : les autres équipes inscrites, qui marquent un peu moins (rien pour « Personne »).
 */
data class StatuesSongWon(
    override val seq: Int, override val at: Long, val qid: String, val song: Int, val winners: List<String>, val others: List<String>,
) : GameEvent

/** Statues musicales : « ▶ Chanson suivante », la chanson [song] part de 0:00. */
data class StatuesSongStarted(override val seq: Int, override val at: Long, val qid: String, val song: Int) : GameEvent

/**
 * Le Gonfleur fou : fin de la course de [qid]. [team] = le ballon gagnant ([NO_WINNER] si personne n'a tapé) ;
 * [teams] = toutes les équipes qui jouaient (les autres marquent leurs points de participation). Révélation.
 */
data class BalloonBurst(override val seq: Int, override val at: Long, val qid: String, val team: String, val teams: List<String>) : GameEvent

/**
 * « Ça va exploser ! » : la mèche de la bombe n° [bomb] s'allume ([fuseMs], tirée au sort), la bombe part de [holder] ;
 * [teams] jouent.
 */
data class PotatoLit(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val holder: String,
    val fuseMs: Long,
    val teams: List<String>,
    val bomb: Int = 1,
    /** Nombre de bombes de la partie (absent des journaux d'avant le 26/10 : 3). */
    val total: Int = POTATO_BOMBS,
) : GameEvent

/**
 * « Ça va exploser ! » : Sarah arrête après cette bombe (téléphone). Bombe en cours : c'est la dernière. Entre deux
 * bombes (la suivante pas encore partie) : on s'arrête là, bilan des scores, puis le jeu suivant.
 */
data class PotatoStopped(override val seq: Int, override val at: Long, val qid: String) : GameEvent

/** « Ça va exploser ! » : [from] envoie la bombe à [to]. */
data class PotatoPassed(override val seq: Int, override val at: Long, val qid: String, val from: String, val to: String) : GameEvent

/** « Ça va exploser ! » : la bombe explose chez [holder] ; après la dernière bombe, révélation. */
data class PotatoExploded(override val seq: Int, override val at: Long, val qid: String, val holder: String) : GameEvent

data class BuzzJudged(override val seq: Int, override val at: Long, val ok: Boolean, val bonus: Boolean = false) : GameEvent

/**
 * Le Duel des robots : le duel n° [n] est prêt entre [teams] (2 équipes), avec leurs joueurs [players] ; [extra] =
 * choisi à la volée par Sarah. Un duel prêt pas encore lancé peut être remplacé (même numéro).
 */
data class DuelReady(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val n: Int,
    val teams: List<String>,
    val players: List<Int>,
    val extra: Boolean = false,
) : GameEvent

/** Le Duel des robots : le face-à-face du duel [n] commence ; le PAN tombera à [panAt] (heure du serveur, secrète). */
data class DuelStarted(override val seq: Int, override val at: Long, val qid: String, val n: Int, val panAt: Long) : GameEvent

/** Le Duel des robots : la tablette de [team] a buzzé, appui à [t] (heure du serveur estimée par la tablette). */
data class DuelBuzzed(override val seq: Int, override val at: Long, val qid: String, val n: Int, val team: String, val t: Long) : GameEvent

/**
 * Le Duel des robots : le PAN est apparu à l'écran de la TV à [shownAt] (heure du serveur, image réellement envoyée à
 * l'écran) ; la box juge les buzz par rapport à cet instant (cedric, 27/10 : un PAN affiché en retard ne doit
 * pénaliser personne).
 */
data class DuelPanShown(override val seq: Int, override val at: Long, val qid: String, val n: Int, val shownAt: Long) : GameEvent

/** Le Duel des robots : plus d'appui à attendre (fenêtre après le premier buzz, ou personne 10 s après le PAN). */
data class DuelSettled(override val seq: Int, override val at: Long, val qid: String, val n: Int) : GameEvent

/** Le Duel des robots : Sarah arrête le face-à-face ; la même paire reste prête, sans points. */
data class DuelStopped(override val seq: Int, override val at: Long, val qid: String, val n: Int) : GameEvent

/**
 * Le Simon du Prof : le tour [tour] est prêt entre les équipes [teams], avec sa suite secrète [sequence] (tirée par la
 * box) ; la suite n° 1 attend le lancement de Sarah.
 */
data class SimonTourReady(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val tour: Int,
    val sequence: List<String>,
    val teams: List<String>,
) : GameEvent

/** Le Simon du Prof : la suite n° [suite] du tour [tour] commence (le robot la montre, puis le chrono part). */
data class SimonSuiteStarted(override val seq: Int, override val at: Long, val qid: String, val tour: Int, val suite: Int) : GameEvent

/** Le Simon du Prof : la suite n° [suite] est jugée d'après ce que chaque équipe a tapé ([answers]). */
data class SimonJudged(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val tour: Int,
    val suite: Int,
    val answers: Map<String, SimonAnswer>,
) : GameEvent

/** Le Simon du Prof : Sarah arrête la suite en cours ; elle se relancera telle quelle, sans élimination. */
data class SimonStopped(override val seq: Int, override val at: Long, val qid: String, val tour: Int, val suite: Int) : GameEvent

/** Le Chrono de Buzzy : le tour [tour] est prêt, avec la [cible] (secondes) ; il attend « ▶ Lancer le chrono ». */
data class ChronoReady(override val seq: Int, override val at: Long, val qid: String, val tour: Int, val cible: Int) : GameEvent

/** Le Chrono de Buzzy : Sarah change la [cible] du tour prêt [tour] (− / + du téléphone). */
data class ChronoTargetSet(override val seq: Int, override val at: Long, val qid: String, val tour: Int, val cible: Int) : GameEvent

/**
 * Le Chrono de Buzzy : le tour [tour] est lancé entre les équipes [teams] ; le 0 du chrono à [goAt] (après le décompte),
 * le drap de Buzzy tombe [cacheMs] après le 0.
 */
data class ChronoStarted(
    override val seq: Int,
    override val at: Long,
    val qid: String,
    val tour: Int,
    val goAt: Long,
    val cacheMs: Long,
    val teams: List<String>,
) : GameEvent

/** Le Chrono de Buzzy : la tablette de [team] a buzzé, appui à [t] (heure du serveur estimée par la tablette). */
data class ChronoBuzzed(override val seq: Int, override val at: Long, val qid: String, val tour: Int, val team: String, val t: Long) : GameEvent

/** Le Chrono de Buzzy : le 0 du chrono est apparu à l'écran de la TV à [shownAt] (heure du serveur). */
data class ChronoShown(override val seq: Int, override val at: Long, val qid: String, val tour: Int, val shownAt: Long) : GameEvent

/** Le Chrono de Buzzy : plus de buzz à attendre (toutes ont buzzé, ou [CHRONO_ATTENTE_MS] après la cible) : le bilan. */
data class ChronoSettled(override val seq: Int, override val at: Long, val qid: String, val tour: Int, val force: Boolean = false) : GameEvent

/** Le Chrono de Buzzy : Sarah arrête le tour en cours ; il reste prêt, sans points. */
data class ChronoStopped(override val seq: Int, override val at: Long, val qid: String, val tour: Int) : GameEvent

/**
 * Saut de la régie vers la question [index] (début d'un jeu de la prestation), en avant comme en arrière.
 * Les points des questions [clear] sont retirés : un jeu rejoué ne compte jamais deux fois.
 */
data class Jumped(override val seq: Int, override val at: Long, val index: Int, val qid: String, val clear: List<String> = emptyList()) : GameEvent
