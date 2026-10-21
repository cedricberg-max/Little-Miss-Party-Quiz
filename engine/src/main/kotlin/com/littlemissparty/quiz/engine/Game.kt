package com.littlemissparty.quiz.engine

import kotlin.random.Random

enum class Phase(val code: String) {
    LOBBY("lobby"),
    QUESTION("question"),
    CLOSED("closed"),
    REVEAL("reveal"),
    SCORES("scores"),
    ENDED("ended"),
}

/** Période pendant laquelle le chrono tourne ([end] nul tant qu'il tourne encore). */
data class Segment(val start: Long, val end: Long? = null)

/** Écart toléré entre l'horloge de la box et celle du serveur pour dater une réponse. */
const val ANSWER_CLOCK_MARGIN_MS = 2_000L

/** Vrai ou Faux express : temps entre la fermeture et la révélation (la TV annonce « Temps écoulé »). */
const val EXPRESS_CLOSED_MS = 1_200L

/** Blind test : un extrait relancé à moins de ce temps de sa fin repart du début. */
const val BLIND_END_MARGIN_MS = 1_000L

/** Qui a disparu ? : le buzzer peut s'ouvrir un poil avant l'heure (minuterie de la box). */
const val ARM_TOLERANCE_MS = 250L

/**
 * Première des dernières questions à points multipliés : la TV annonce « × N » en plein écran pendant ce temps,
 * le chrono et les réponses partent ensuite (comme après le décompte d'une reprise).
 */
const val MULTIPLIER_INTRO_MS = 4_500L

/** Blind test : une équipe qui s'est trompée peut rebuzzer sur le même morceau, 3 s après la reprise de la musique. */
const val REBUZZ_DELAY_MS = 3_000L

/** Vrai ou Faux express : temps de la révélation avant l'affirmation suivante. */
const val EXPRESS_REVEAL_MS = 3_500L

/** Pictionary : nombre de mots proposés au dessinateur. */
const val PICTO_OFFER = 3

/** Image floue : l'équipe qui a buzzé et attend le verdict de l'animatrice, et les équipes déjà bloquées. */
data class BuzzRound(
    val team: String? = null,
    val blocked: List<String> = emptyList(),
    val armed: Boolean = true,
    /** Essais déjà jugés ou réautorisations : chaque tentative a sa clé de buzz, le premier qui écrit gagne. */
    val tries: Int = 0,
    /** Blind test : musique à l'arrêt, en attente du « Lancer » ou du « Relancer » de l'animatrice. */
    val waiting: Boolean = false,
)

/** Blind test : ce qu'est devenu un morceau de la playlist. */
enum class BlindStatus(val code: String) { TODO("todo"), PLAYING("playing"), FOUND("found"), REVEALED("revealed"), SKIPPED("skipped") }

/** Blind test : un morceau de la playlist, sa valeur (doublée en Super Finale) et l'équipe qui l'a trouvé. */
data class BlindTrack(val qid: String, val points: Int, val status: BlindStatus, val team: String?)

/** Pause en cours : qui l'a provoquée et depuis quand. */
data class Hold(val reason: String, val team: String?, val since: Long)

/** État de la partie, entièrement déduit du journal. */
data class GameState(
    val phase: Phase = Phase.LOBBY,
    val index: Int = -1,
    val qid: String? = null,
    val segments: List<Segment> = emptyList(),
    val awards: Map<String, Map<String, Award>> = emptyMap(),
    val adjustments: Map<Int, ScoreAdjusted> = emptyMap(),
    /** Question en cours au moment de chaque correction (numéro de l'événement → question) : le bonus compte dans ce jeu. */
    val adjustedIn: Map<Int, String> = emptyMap(),
    val lastSeq: Int = 0,
    val hold: Hold? = null,
    /** Heure du serveur où se termine le décompte de la dernière reprise. */
    val resumeAt: Long? = null,
    /** Mimes (ou dessins du Pictionary) trouvés, par manche puis par équipe. */
    val mimes: Map<String, Map<String, Int>> = emptyMap(),
    /** Points d'un mime ou d'un dessin trouvé, par manche (fixés à l'ouverture de la manche). */
    val turnPoints: Map<String, Int> = emptyMap(),
    /** Manche de mimes en cours (null pour une question ordinaire). */
    val mime: MimeRound? = null,
    /** Image floue en cours (null pour une autre question). */
    val buzz: BuzzRound? = null,
    /** Blind test : morceaux passés sans révélation. */
    val skipped: Set<String> = emptySet(),
    /** Blind test : morceau dont l'animatrice a raccourci la révélation. */
    val revealCut: String? = null,
    /** Dernières questions du quiz : multiplicateur choisi par l'animatrice, par première question de la série. */
    val factors: Map<Int, Int> = emptyMap(),
    /** Portes mystères : nombre de portes déjà ouvertes par l'animatrice (dans l'ordre de [Game.doorOrder]). */
    val doorsOpened: Int = 0,
    /** Portes mystères : valeurs changées par l'animatrice, par question puis par porte. */
    val doorValues: Map<String, Map<Int, Int>> = emptyMap(),
    /** Écran de présentation du jeu qui commence : rien ne part avant le lancement de l'animatrice ([GameLaunched]). */
    val intro: Boolean = false,
    /** Les coffres mystères : les coffres de chaque manche jouée (points compris), par question. */
    val chests: Map<String, ChestRound> = emptyMap(),
    /** « Ça va exploser ! » en cours (null hors de ce jeu, ou avant que la mèche soit allumée). */
    val potato: PotatoRound? = null,
) {
    val paused: Boolean get() = hold != null

    /** Heure d'ouverture de la question en cours (heure du serveur), null hors question. */
    val openedAt: Long? get() = segments.firstOrNull()?.start

    /**
     * Réponse donnée pendant cette ouverture de la question ? Une question rejouée depuis la régie repart de zéro :
     * une ancienne réponse encore en cache (même question, partie précédente) ne compte pas et ne ferme rien.
     */
    fun answeredSinceOpening(answerAt: Long): Boolean = openedAt?.let { answerAt >= it - ANSWER_CLOCK_MARGIN_MS } ?: true

    /** Image floue : une équipe a buzzé, le chrono attend le verdict de l'animatrice. */
    val buzzHeld: Boolean get() = buzz?.team != null

    /** Points d'un mime ou d'un dessin trouvé dans la manche [qid]. */
    fun pointsPerFound(qid: String): Int = turnPoints[qid] ?: Scoring.MIME

    /** Un tour de mimes est en cours : son chrono tourne (hors pause). */
    val mimeTurn: Boolean get() = mime?.team != null

    /** Temps de chrono écoulé à l'instant [t] (pauses exclues). */
    fun elapsedAt(t: Long): Long = segments.sumOf { s ->
        val end = minOf(s.end ?: Long.MAX_VALUE, t)
        (end - s.start).coerceAtLeast(0)
    }

    /** Total de chaque équipe : points des questions + corrections. Recalculé à chaque fois, jamais cumulé. */
    fun scores(): Map<String, Int> {
        val totals = mutableMapOf<String, Int>()
        awards.values.forEach { perTeam -> perTeam.forEach { (team, a) -> totals.merge(team, a.points, Int::plus) } }
        adjustments.values.forEach { totals.merge(it.team, it.delta, Int::plus) }
        mimes.forEach { (qid, perTeam) -> perTeam.forEach { (team, n) -> totals.merge(team, n * pointsPerFound(qid), Int::plus) } }
        chests.values.forEach { r -> r.opened.forEach { totals.merge(it.team, it.delta, Int::plus) } }
        return totals
    }
}

/**
 * Manche de mimes en cours. [deck] : cartes restantes (indices dans [Question.cards]), la première est
 * celle affichée ; [team] : équipe qui joue (null entre deux tours) ; [found]/[passed] : compteurs du tour ;
 * [last] : bilan du dernier tour terminé ; [turns] : équipes ayant joué, dans l'ordre.
 */
data class MimeRound(
    val deck: List<Int>,
    val team: String? = null,
    val found: Int = 0,
    val passed: Int = 0,
    val last: MimeTurn? = null,
    val turns: List<String> = emptyList(),
    /** Pictionary : équipe qui choisit son mot sur sa tablette, avant que le chrono parte. */
    val secret: String? = null,
    /** Pictionary : les mots proposés au dessinateur (indices dans [Question.cards]), et celui qu'il a choisi. */
    val offer: List<Int> = emptyList(),
    val pick: Int? = null,
    /** Pictionary : heure où les mots ont été proposés (clé du choix envoyé par la tablette). */
    val shownAt: Long? = null,
    /** Heure du serveur où le tour en cours (ou le dernier) a commencé : clé du dessin de ce tour. */
    val started: Long? = null,
)

/** Bilan d'un tour ; [card] : le mot joué (Pictionary), montré à tous une fois le tour fini. */
data class MimeTurn(val team: String, val found: Int, val passed: Int, val card: Int? = null)

/**
 * La partie vue par la box, seule arbitre des points.
 * Chaque méthode d'action renvoie l'événement à enregistrer, ou null si l'action
 * n'a pas de sens dans l'état courant (double clic, commande en retard…) : rien n'est alors modifié.
 */
class Game(val quiz: Quiz, history: List<GameEvent> = emptyList()) {

    private val log = mutableListOf<GameEvent>()
    var state = GameState()
        private set

    val events: List<GameEvent> get() = log

    init {
        history.sortedBy { it.seq }.forEach { record(it) }
    }

    val question: Question? get() = state.index.takeIf { it >= 0 }?.let { quiz.questions.getOrNull(it) }
    val isLastQuestion: Boolean get() = state.index >= quiz.questions.lastIndex

    /** Millisecondes restantes au chrono à l'instant [now]. */
    fun remainingMs(now: Long): Long {
        val q = question ?: return 0
        if (!timerRuns(q)) return 0
        return (durationOf(q) - state.elapsedAt(now)).coerceAtLeast(0)
    }

    /**
     * Le chrono de [q] est en marche (ou en pause) : question ouverte, ou tour de mimes en cours. Portes mystères :
     * jamais de chrono, chacun prend son temps et l'animatrice ferme les choix quand tout le monde est prêt.
     */
    private fun timerRuns(q: Question) = state.phase == Phase.QUESTION && !state.intro && !q.isPortes && !q.isCoffres && (!q.isTurns || state.mimeTurn) &&
        (!q.isPatate || state.potato?.exploded == false) &&
        (!q.isBlind || (state.buzz?.waiting == false && state.segments.isNotEmpty()))

    /** Durée du chrono de [q] : la mèche tirée au sort pour « Ça va exploser ! », sinon celle de la question. */
    fun durationOf(q: Question): Long = if (q.isPatate) state.potato?.fuseMs ?: q.durationMs else q.durationMs

    /**
     * Le chrono vient de (re)partir, il y a moins de [ms] : un appui sur « Arrêter le chrono » à cet instant
     * est presque toujours le second appui d'un double clic sur OK (celui qui a lancé la question ou la reprise).
     * Mesuré sur l'heure du serveur, il ne dépend pas du moment où la télécommande livre l'appui.
     */
    fun justStarted(now: Long, ms: Long = CLOSE_GUARD_MS): Boolean {
        val q = question ?: return false
        if (!timerRuns(q) || state.paused) return false
        val start = state.segments.lastOrNull()?.start ?: return false
        return now - start < ms
    }

    /**
     * Box sans Internet depuis [offlineMs] : une question en cours (ou lancée hors connexion) se met en pause,
     * car les tablettes ne la reçoivent plus et ne peuvent plus répondre. Une seule fois par coupure
     * ([alreadyPaused]) : l'écran de pause explique la suite (cartes A B C D, points à la télécommande) et,
     * si l'animatrice relance, la fête continue hors connexion sans se figer à chaque question.
     */
    fun networkPause(now: Long, offlineMs: Long, alreadyPaused: Boolean): GameEvent? {
        if (offlineMs < NETWORK_GRACE_MS || state.phase != Phase.QUESTION || state.paused) return null
        if (alreadyPaused || remainingMs(now) == 0L) return null
        return pause(now, PAUSE_NETWORK)
    }

    /** Heure du serveur à laquelle le chrono atteindra zéro, ou null s'il est en pause ou arrêté. */
    fun deadline(): Long? {
        val q = question ?: return null
        if (!timerRuns(q) || state.paused || state.buzzHeld) return null
        val running = state.segments.last()
        val before = state.elapsedAt(running.start)
        return running.start + durationOf(q) - before
    }

    /**
     * Ajoute un événement au journal s'il est valide. Un événement déjà vu (même numéro)
     * ou impossible dans l'état courant est ignoré : rejouer deux fois le journal ne change rien.
     */
    fun record(event: GameEvent): Boolean {
        if (event.seq <= state.lastSeq) return false
        val next = reduce(state, event) ?: return false
        state = next.copy(lastSeq = event.seq)
        log += event
        return true
    }

    /**
     * Pendant la présentation d'un jeu, seuls comptent le lancement, la pause, les points de la régie, le saut
     * vers un autre jeu, la fin de partie et les réglages (multiplicateur, portes) : aucune réponse, aucun buzz.
     */
    private fun reduce(s: GameState, e: GameEvent): GameState? =
        if (s.intro && e !is GameLaunched && e !is Paused && e !is Resumed && e !is ScoreAdjusted && e !is Undone &&
            e !is Jumped && e !is GameEnded && e !is FactorChosen && e !is DoorSet) null
        else reduceEvent(s, e)

    /** Jeu qui commence à la question [index] : il s'ouvre sur son écran de présentation, sans chrono ni buzzer. */
    private fun presented(s: GameState, index: Int): GameState =
        if (quiz.intros && index in rounds) s.copy(intro = true, segments = emptyList(), resumeAt = null, mime = null, buzz = null)
        else s.copy(intro = false)

    private fun reduceEvent(s: GameState, e: GameEvent): GameState? = when (e) {
        is GameLaunched -> {
            val q = quiz.questions.getOrNull(s.index)
            if (!s.intro || s.phase != Phase.QUESTION || q == null || s.paused) null else open(s.copy(intro = false), s.index, q, e.at)
        }
        is QuestionOpened -> {
            val q = quiz.questions.getOrNull(e.index)
            val canOpen = s.phase == Phase.LOBBY || s.phase == Phase.SCORES || s.phase == Phase.REVEAL
            if (q == null || q.id != e.qid || !canOpen || e.index <= s.index || s.paused) null
            // Une manche de mimes s'ouvre sans chrono : il part au lancement du tour de chaque équipe.
            else presented(open(s, e.index, q, e.at), e.index)
        }
        is Jumped -> {
            val q = quiz.questions.getOrNull(e.index)
            if (q == null || q.id != e.qid) null
            else presented(
                open(
                    s.copy(
                        awards = s.awards - e.clear.toSet(), mimes = s.mimes - e.clear.toSet(), skipped = s.skipped - e.clear.toSet(),
                        chests = s.chests - e.clear.toSet(), hold = null,
                    ),
                    e.index, q, e.at,
                ),
                e.index,
            )
        }
        is Paused ->
            if (s.phase == Phase.LOBBY || s.phase == Phase.ENDED || s.paused) null
            else s.copy(
                hold = Hold(e.reason, e.team, e.at),
                segments = if (s.phase == Phase.QUESTION && s.segments.lastOrNull()?.end == null && s.segments.isNotEmpty()) {
                    // Un chrono encore dans son décompte de reprise n'a pas commencé : rien n'est décompté.
                    s.segments.dropLast(1) + s.segments.last().let { it.copy(end = maxOf(e.at, it.start)) }
                } else s.segments,
            )
        is Resumed ->
            if (!s.paused) null
            else {
                val start = e.at + e.countdownMs.coerceIn(0, 10_000)
                s.copy(
                    hold = null,
                    resumeAt = start,
                    // Entre deux tours de mimes, ou pendant la réponse d'une équipe qui a buzzé, aucun chrono ne tourne.
                    // Blind test en attente du « Lancer » de l'animatrice : la musique ne repart pas toute seule.
                    // Présentation d'un jeu : le chrono attend le lancement.
                    segments = if (s.phase == Phase.QUESTION && !s.intro && (s.mime == null || s.mimeTurn) && !s.buzzHeld && s.buzz?.waiting != true) s.segments + Segment(start) else s.segments,
                )
            }
        // Accepté en pause pour rejouer les journaux d'avant la pause générale (la fermeture levait la pause) ;
        // les actions de la box et de la régie, elles, ne ferment jamais une question en pause.
        is QuestionClosed ->
            if (s.phase != Phase.QUESTION || s.mime != null) null
            else s.copy(
                phase = Phase.CLOSED,
                hold = null,
                segments = s.segments.map { if (it.end == null) it.copy(end = e.at) else it },
            )
        is Revealed ->
            // Blind test : l'animatrice peut révéler un morceau sans gagnant directement, musique arrêtée ou non.
            if (e.qid == s.qid && !s.paused && s.phase == Phase.QUESTION && quiz.questions.getOrNull(s.index)?.isBlind == true && s.buzz?.team == null)
                s.copy(phase = Phase.REVEAL, awards = s.awards + (e.qid to e.awards), segments = closeSegments(s, e.at), buzz = s.buzz?.copy(waiting = true))
            else if (s.phase != Phase.CLOSED || e.qid != s.qid || s.paused) null
            // Une seule attribution par question : la clé est l'identifiant de la question.
            else s.copy(phase = Phase.REVEAL, awards = s.awards + (e.qid to e.awards))
        is FactorChosen ->
            if (e.factor !in FACTORS || doubleRunStart(e.start) != e.start) null else s.copy(factors = s.factors + (e.start to e.factor))
        is ScoresShown -> when {
            s.paused -> null
            s.phase == Phase.REVEAL -> s.copy(phase = Phase.SCORES)
            // Fin d'une manche de mimes, entre deux tours : les points sont déjà comptés, on passe au classement.
            s.phase == Phase.QUESTION && s.mime != null && !s.mimeTurn -> s.copy(phase = Phase.SCORES, mime = null)
            else -> null
        }
        is DoorSet -> {
            val q = quiz.questions.getOrNull(s.index)
            if (q == null || !q.isPortes || e.qid != s.qid || (s.phase != Phase.QUESTION && s.phase != Phase.CLOSED) ||
                e.door !in q.choices.indices || e.value !in DOOR_VALUES) null
            else s.copy(doorValues = s.doorValues + (e.qid to (s.doorValues[e.qid].orEmpty() + (e.door to e.value))))
        }
        is DoorOpened -> {
            val q = quiz.questions.getOrNull(s.index)
            if (q == null || !q.isPortes || e.qid != s.qid || s.phase != Phase.REVEAL || s.doorsOpened >= q.choices.size) null
            else s.copy(doorsOpened = s.doorsOpened + 1)
        }
        is PotatoLit -> {
            val q = quiz.questions.getOrNull(s.index)
            val p = s.potato
            // La première bombe, ou la suivante une fois la précédente explosée (jamais plus de POTATO_BOMBS).
            val suite = if (p == null) e.bomb == 1 else p.exploded && e.bomb == p.bomb + 1 && e.bomb <= POTATO_BOMBS
            if (s.phase != Phase.QUESTION || q == null || !q.isPatate || q.id != e.qid || !suite || s.paused ||
                e.teams.size < 2 || e.teams.distinct().size != e.teams.size || e.holder !in e.teams || e.fuseMs !in POTATO_FUSE_MIN_MS..POTATO_FUSE_MAX_MS) null
            // Bombe suivante : le temps de l'explosion et de l'annonce « Bombe 2 sur 3 » avant qu'elle parte.
            else (e.at + if (p == null) POTATO_GO_MS else POTATO_NEXT_MS).let { go ->
                s.copy(
                    potato = PotatoRound(e.fuseMs, e.teams, e.holder, since = go, bomb = e.bomb, booms = p?.booms.orEmpty()),
                    segments = listOf(Segment(go)), resumeAt = go,
                )
            }
        }
        is PotatoPassed -> {
            val p = s.potato
            if (s.phase != Phase.QUESTION || s.qid != e.qid || p == null || p.exploded || s.paused || p.holder != e.from || e.to !in p.targets) null
            else s.copy(potato = p.copy(holder = e.to, from = e.from, since = e.at, hit = p.hit + e.to, passes = p.passes + 1))
        }
        is PotatoExploded -> {
            val p = s.potato
            val q = quiz.questions.getOrNull(s.index)
            if (s.phase != Phase.QUESTION || s.qid != e.qid || p == null || p.exploded || q == null || p.holder != e.holder) null
            else {
                val factor = factorIn(s, s.index)
                val lost = minOf(POTATO_POINTS * factor, (s.scores()[e.holder] ?: 0).coerceAtLeast(0))
                // Les points de chaque bombe s'ajoutent à ceux des bombes précédentes du même jeu.
                val before = s.awards[q.id].orEmpty()
                val awards = before + p.teams.associateWith {
                    val points = (before[it]?.points ?: 0) + if (it == e.holder) -lost else POTATO_POINTS * factor
                    Award(null, correct = points > 0, points = points, bonus = 0)
                }
                val next = p.copy(booms = p.booms + PotatoBoom(e.holder, e.at, lost, POTATO_POINTS * factor))
                s.copy(
                    // Après la dernière bombe, le bilan ; sinon la box allume la mèche de la suivante.
                    phase = if (next.last) Phase.REVEAL else s.phase, hold = null, segments = closeSegments(s, e.at),
                    awards = s.awards + (q.id to awards), potato = next,
                )
            }
        }
        is ChestsDealt -> {
            val q = quiz.questions.getOrNull(s.index)
            if (s.phase != Phase.QUESTION || q == null || !q.isCoffres || q.id != e.qid || s.qid != e.qid || e.qid in s.chests || s.paused ||
                e.order.isEmpty() || e.order.distinct().size != e.order.size || e.order.any { it.isBlank() } ||
                e.count !in 2..MAX_CHESTS || e.safe !in 0 until e.count) null
            else s.copy(chests = s.chests + (e.qid to ChestRound(e.count, e.order, e.safe, e.at)))
        }
        is ChestOpened -> {
            val r = s.chests[e.qid]
            if (s.phase != Phase.QUESTION || s.qid != e.qid || r == null || s.paused || r.team != e.team || e.chest !in r.closed ||
                (e.bomb && !r.danger) || (e.bomb && e.delta > 0) ||
                (e.gold && (e.bomb || !r.danger || r.goldFound || e.delta != GOLD_POINTS))) null
            else {
                val next = r.copy(opened = r.opened + ChestOpen(e.team, e.chest, e.delta, e.bomb, e.at, e.gold))
                // La bombe arrête le jeu : bilan des coffres, puis classement.
                s.copy(chests = s.chests + (e.qid to next), phase = if (next.team == null) Phase.REVEAL else s.phase)
            }
        }
        is ScoreAdjusted ->
            if (e.delta == 0 || e.team.isBlank()) null
            else s.copy(adjustments = s.adjustments + (e.seq to e), adjustedIn = s.qid?.let { s.adjustedIn + (e.seq to it) } ?: s.adjustedIn)
        is Undone ->
            if (e.target !in s.adjustments) null
            else s.copy(adjustments = s.adjustments - e.target)
        is GameEnded ->
            if (s.phase == Phase.ENDED) null else s.copy(phase = Phase.ENDED, hold = null, mime = null, intro = false)
        is PictoShown -> {
            val m = s.mime
            val cards = quiz.questions.getOrNull(s.index)?.takeIf { it.isPicto }?.cards.orEmpty()
            if (m == null || m.team != null || m.secret == e.team || s.paused || cards.isEmpty() || e.team.isBlank()) null
            // Paquet épuisé par les équipes précédentes : il est rebattu pour que chaque équipe ait son tour.
            else {
                val deck = m.deck.ifEmpty { cards.indices.toList() }
                s.copy(mime = m.copy(deck = deck, secret = e.team, offer = deck.take(PICTO_OFFER), pick = null, shownAt = e.at))
            }
        }
        is PictoChosen -> {
            val m = s.mime
            if (m?.secret == null || m.team != null || s.paused || e.choice !in m.offer.indices || m.pick == m.offer[e.choice]) null
            else s.copy(mime = m.copy(pick = m.offer[e.choice]))
        }
        is MimeTurnStarted -> {
            val m = s.mime
            val q = quiz.questions.getOrNull(s.index)
            val cards = q?.cards.orEmpty()
            // Pictionary : le dessin commence seulement après que l'équipe a vu son mot.
            val picto = q?.isPicto == true
            // Pictionary : le dessin commence seulement après que l'équipe a choisi son mot.
            if (m == null || m.team != null || s.paused || cards.isEmpty() || e.team.isBlank() || (picto && (m.secret != e.team || m.pick == null))) null
            else s.copy(
                segments = listOf(Segment(e.at)), resumeAt = null,
                // Paquet épuisé par les équipes précédentes : il est rebattu pour que chaque équipe ait son tour.
                mime = m.copy(
                    // Pictionary : le mot choisi passe en tête du paquet ; les deux autres mots déjà montrés repartent tout
                    // au fond, pour qu'aucune autre équipe ne les revoie avant que le paquet soit épuisé.
                    deck = if (picto) listOf(m.pick!!) + (m.deck - m.offer.toSet()) + (m.offer - m.pick) else m.deck.ifEmpty { cards.indices.toList() },
                    team = e.team, found = 0, passed = 0, turns = m.turns + e.team, secret = null, offer = emptyList(), pick = null, started = e.at,
                ),
            )
        }
        is MimeFound -> {
            val m = s.mime
            val team = m?.team
            if (m == null || team == null || s.paused) null
            else {
                val qid = s.qid!!
                val counts = s.mimes[qid].orEmpty()
                val next = s.copy(
                    mimes = s.mimes + (qid to counts + (team to (counts[team] ?: 0) + 1)),
                    mime = m.copy(deck = m.deck.drop(1), found = m.found + 1),
                )
                // Paquet épuisé, ou dessin du Pictionary trouvé (un mot par tour) : le tour s'arrête de lui-même.
                if (next.mime!!.deck.isEmpty() || quiz.questions.getOrNull(s.index)?.isPicto == true) endTurn(next, e.at, m.deck.firstOrNull())
                else next
            }
        }
        is MimePassed -> {
            val m = s.mime
            val picto = quiz.questions.getOrNull(s.index)?.isPicto == true
            // Pictionary : « Autres mots » seulement pendant que le dessinateur choisit, avant de dessiner.
            if (m == null || s.paused) null
            else if (picto) {
                if (m.secret == null || m.team != null || m.deck.size <= m.offer.size) null
                else {
                    val deck = m.deck.drop(m.offer.size) + m.deck.take(m.offer.size)
                    // Nouvelle heure de présentation = nouvelle clé de choix : la tablette remplace ses cartes, et un choix
                    // fait sur les anciens mots ne peut jamais désigner un des nouveaux.
                    s.copy(mime = m.copy(deck = deck, offer = deck.take(PICTO_OFFER), pick = null, passed = m.passed + 1, shownAt = e.at))
                }
            }
            else if (m.team == null || m.deck.size < 2) null
            else s.copy(mime = m.copy(deck = m.deck.drop(1) + m.deck.first(), passed = m.passed + 1))
        }
        is MimeCorrected -> {
            val m = s.mime
            val qid = s.qid
            val counts = qid?.let { s.mimes[it] }.orEmpty()
            val now = counts[e.team] ?: 0
            val after = (now + e.delta).coerceAtLeast(0)
            if (m == null || qid == null || e.team.isBlank() || e.delta !in listOf(-1, 1) || after == now) null
            else s.copy(
                mimes = s.mimes + (qid to counts + (e.team to after)),
                mime = when (e.team) {
                    m.team -> m.copy(found = (m.found + e.delta).coerceAtLeast(0))
                    m.last?.team -> m.copy(last = m.last.copy(found = (m.last.found + e.delta).coerceAtLeast(0)))
                    else -> m
                },
            )
        }
        is MimeTurnEnded -> {
            val m = s.mime
            if (m?.team == null) null
            // Pictionary, chrono écoulé ou tour arrêté : le mot a été vu et dessiné, il ne resservira pas.
            else if (quiz.questions.getOrNull(s.index)?.isPicto == true) endTurn(s.copy(mime = m.copy(deck = m.deck.drop(1))), e.at, m.deck.firstOrNull())
            else endTurn(s, e.at)
        }
        is Buzzed -> {
            val b = s.buzz
            if (s.phase != Phase.QUESTION || b == null || !b.armed || b.waiting || b.team != null || s.paused || e.team.isBlank() ||
                (e.team in b.blocked && !rebuzzOpen(s, e.at))) null
            else s.copy(
                buzz = b.copy(team = e.team),
                segments = s.segments.map { if (it.end == null) it.copy(end = maxOf(e.at, it.start)) else it },
            )
        }
        is BlindPlayed -> {
            val b = s.buzz
            val q = quiz.questions.getOrNull(s.index)
            if (s.phase != Phase.QUESTION || q == null || !q.isBlind || b == null || !b.waiting || b.team != null || s.paused) null
            else {
                // Extrait déjà joué jusqu'au bout : il repart du début.
                val rewind = s.segments.isEmpty() || s.elapsedAt(e.at) >= q.durationMs - BLIND_END_MARGIN_MS
                s.copy(
                    segments = if (rewind) listOf(Segment(e.at)) else s.segments + Segment(e.at),
                    resumeAt = null,
                    buzz = if (e.unblock) b.copy(waiting = false, blocked = emptyList(), tries = b.tries + 1) else b.copy(waiting = false),
                )
            }
        }
        is BlindStopped -> {
            val b = s.buzz
            if (s.phase != Phase.QUESTION || quiz.questions.getOrNull(s.index)?.isBlind != true || b == null || b.waiting || b.team != null || s.paused) null
            else s.copy(segments = closeSegments(s, e.at), buzz = b.copy(waiting = true))
        }
        is BuzzUnblocked -> {
            val b = s.buzz
            if (s.phase != Phase.QUESTION || quiz.questions.getOrNull(s.index)?.isBlind != true || b == null || b.team != null || b.blocked.isEmpty()) null
            else s.copy(buzz = b.copy(blocked = emptyList(), tries = b.tries + 1))
        }
        is BlindSkipped -> {
            val q = quiz.questions.getOrNull(s.index)
            if (s.phase != Phase.QUESTION || q == null || !q.isBlind || e.qid != s.qid || s.buzz?.team != null || s.paused) null
            else {
                val skipped = s.copy(skipped = s.skipped + q.id, segments = closeSegments(s, e.at))
                val following = quiz.questions.getOrNull(s.index + 1)
                // Morceau suivant de la même playlist, ou bilan du blind test.
                if (following != null && following.isBlind && s.index + 1 in roundOf(s.index)) open(skipped, s.index + 1, following, e.at)
                else skipped.copy(phase = Phase.SCORES, buzz = null)
            }
        }
        is RevealCut ->
            if (s.phase != Phase.REVEAL || e.qid != s.qid || quiz.questions.getOrNull(s.index)?.isBlind != true || s.revealCut == e.qid) null
            else s.copy(revealCut = e.qid)
        is BuzzArmed -> {
            val b = s.buzz
            if (s.phase != Phase.QUESTION || b == null || b.armed || s.paused) null else s.copy(buzz = b.copy(armed = true))
        }
        is StatuesWon -> {
            val q = quiz.questions.getOrNull(s.index)
            if ((s.phase != Phase.QUESTION && s.phase != Phase.CLOSED) || q == null || !q.isStatues || s.paused || e.team.isBlank()) null
            else {
                val factor = factorIn(s, s.index)
                val others = e.others.filter { it != e.team && it.isNotBlank() }.associateWith { Award(null, correct = false, points = Scoring.MINI_PLAYED * factor, bonus = 0) }
                s.copy(
                    phase = Phase.REVEAL,
                    segments = s.segments.map { if (it.end == null) it.copy(end = maxOf(e.at, it.start)) else it },
                    awards = s.awards + (q.id to others + (e.team to Award(null, correct = true, points = Scoring.MINI_WIN * factor, bonus = 0))),
                )
            }
        }
        is BalloonBurst -> {
            val q = quiz.questions.getOrNull(s.index)
            if (s.phase != Phase.QUESTION || q == null || !q.isGonfleur || q.id != e.qid || s.paused || e.teams.isEmpty() ||
                (e.team != NO_WINNER && e.team !in e.teams)) null
            else {
                val factor = factorIn(s, s.index)
                val awards = e.teams.filter { it.isNotBlank() }.associateWith {
                    if (it == e.team) Award(null, correct = true, points = Scoring.MINI_WIN * factor, bonus = 0)
                    else Award(null, correct = false, points = Scoring.MINI_PLAYED * factor, bonus = 0)
                }
                s.copy(phase = Phase.REVEAL, segments = closeSegments(s, e.at), awards = s.awards + (q.id to awards))
            }
        }
        is BuzzJudged -> {
            val b = s.buzz
            val team = b?.team
            val q = quiz.questions.getOrNull(s.index)
            if (s.phase != Phase.QUESTION || b == null || team == null || s.paused || q == null) null
            else if (e.ok) {
                val factor = if (q.isBlind) (if (q.double) 2 else 1) else factorIn(s, s.index)
                // Blind test : la valeur du morceau, quel que soit le moment du buzz.
                val points = if (q.isBlind) q.trackPoints * factor
                else (if (b.blocked.isEmpty()) Scoring.BUZZ else Scoring.BUZZ_REBOUND) * factor
                s.copy(phase = Phase.REVEAL, awards = s.awards + (q.id to mapOf(team to Award(q.correct, correct = true, points = points, bonus = 0))))
            }
            // Blind test, mauvaise réponse : la musique attend la relance ; l'équipe pourra rebuzzer 3 s après la reprise.
            else if (q.isBlind) s.copy(buzz = b.copy(team = null, blocked = (b.blocked + team).distinct(), tries = b.tries + 1, waiting = true))
            // Mauvaise réponse : l'équipe est bloquée sur cette image, le chrono repart.
            else s.copy(buzz = b.copy(team = null, blocked = b.blocked + team, tries = b.tries + 1), segments = s.segments + Segment(e.at))
        }
    }

    /**
     * Question [q] ouverte : chrono lancé, ou manche de mimes sans chrono (il part au tour de chaque équipe).
     * Une manche de mimes rouverte (jeu rejoué) repart de zéro : ses mimes ne comptent jamais deux fois.
     */
    private fun open(s0: GameState, index: Int, q: Question, at: Long): GameState = s0.copy(potato = null).let { s ->
        if (q.isTurns) s.copy(
            phase = Phase.QUESTION, index = index, qid = q.id, segments = emptyList(), resumeAt = null,
            mimes = s.mimes - q.id, mime = MimeRound(deck = q.cards.indices.toList()), turnPoints = s.turnPoints + (q.id to q.foundPoints),
            // Le buzz d'un jeu précédent (équipe validée) ne doit jamais figer le chrono des mimes.
            buzz = null,
        )
        // Les coffres mystères : pas de chrono ; la box installe les coffres dès que le jeu est lancé.
        else if (q.isCoffres) s.copy(
            phase = Phase.QUESTION, index = index, qid = q.id, segments = emptyList(), resumeAt = null, mime = null, buzz = null,
            chests = s.chests - q.id,
        )
        // « Ça va exploser ! » : pas de chrono tant que la box n'a pas allumé la mèche ([lightPotato]), ni entre deux bombes.
        else if (q.isPatate) s.copy(phase = Phase.QUESTION, index = index, qid = q.id, segments = emptyList(), resumeAt = null, mime = null, buzz = null)
        // Gonfleur fou : le chrono de secours part après le décompte 3, 2, 1 de la TV, comme après une reprise.
        else if (q.isGonfleur) (at + PUMP_GO_MS).let { go ->
            s.copy(
                phase = Phase.QUESTION, index = index, qid = q.id, segments = listOf(Segment(go)), resumeAt = go, mime = null, buzz = null,
            )
        }
        // Blind test : le morceau s'annonce, la musique attend le « Lancer le morceau » de l'animatrice.
        else if (q.isBlind) s.copy(
            phase = Phase.QUESTION, index = index, qid = q.id, segments = emptyList(), resumeAt = null, mime = null,
            buzz = BuzzRound(waiting = true), revealCut = null,
        )
        else {
            // Dernières questions multipliées : la première attend la fin de l'annonce « × N » de la TV.
            val start = at + if (!q.isBuzz && doubleRunStart(index) == index) MULTIPLIER_INTRO_MS else 0L
            s.copy(
                phase = Phase.QUESTION, index = index, qid = q.id, segments = listOf(Segment(start)), resumeAt = start.takeIf { it > at }, mime = null,
                buzz = if (q.isBuzz) BuzzRound(armed = q.buzzFromMs == 0L) else null, doorsOpened = 0,
            )
        }
    }

    private fun closeSegments(s: GameState, at: Long) = s.segments.map { if (it.end == null) it.copy(end = maxOf(at, it.start)) else it }

    /** Tour de mimes terminé : chrono arrêté, bilan gardé pour la TV et la régie. */
    private fun endTurn(s: GameState, at: Long, card: Int? = null): GameState {
        val m = s.mime!!
        val picto = quiz.questions.getOrNull(s.index)?.isPicto == true
        return s.copy(
            segments = s.segments.map { if (it.end == null) it.copy(end = maxOf(at, it.start)) else it },
            mime = m.copy(team = null, found = 0, passed = 0, last = MimeTurn(m.team!!, m.found, m.passed, card.takeIf { picto })),
        )
    }

    private val nextSeq get() = state.lastSeq + 1

    private fun <E : GameEvent> emit(event: E): E? = event.takeIf { record(it) }

    /**
     * Le bouton « suivant » de l'animatrice : fait avancer la partie d'une étape.
     * [answers] sert seulement à l'étape de révélation.
     */
    fun next(now: Long, answers: Map<String, Answer> = emptyMap()): GameEvent? = if (state.paused) null else when (state.phase) {
        Phase.LOBBY -> openQuestion(0, now)
        // Mimes : « suivant » arrête le tour en cours, ou termine la manche entre deux tours.
        Phase.QUESTION -> when {
            // Écran de présentation : l'animatrice lance le jeu (première question, premier tour ou premier morceau).
            state.intro -> emit(GameLaunched(nextSeq, now))
            // Blind test à la télécommande : OK lance la musique, ou l'arrête.
            question?.isBlind == true -> if (state.buzz?.waiting == true) blindPlay(now) else blindStop(now)
            // Les coffres mystères : seules les équipes ouvrent les coffres, depuis leur tablette.
            question?.isCoffres == true -> null
            // Gonfleur fou : l'arrêt de la course a besoin des tapes des tablettes ([balloon]).
            question?.isGonfleur == true -> null
            // « Ça va exploser ! » : seule la mèche décide de la fin.
            question?.isPatate == true -> null
            state.mime == null -> close(now)
            state.mimeTurn -> mimeStop(now)
            else -> emit(ScoresShown(nextSeq, now))
        }
        Phase.CLOSED -> reveal(now, answers)
        // Vrai ou Faux express : « suivant » passe à l'affirmation suivante, comme la box le fait seule.
        Phase.REVEAL -> when {
            question?.isExpress == true -> expressStep(now, answers)
            // Portes mystères : « suivant » ouvre la porte suivante, puis montre le classement final.
            question?.isPortes == true && state.doorsOpened < question!!.choices.size -> openDoor(now)
            // Blind test : « Titre suivant » annonce le morceau suivant de la playlist, sans le lancer.
            nextTrack() != null -> openQuestion(state.index + 1, now)
            else -> emit(ScoresShown(nextSeq, now))
        }
        Phase.SCORES -> if (isLastQuestion) end(now) else openQuestion(state.index + 1, now)
        Phase.ENDED -> null
    }

    fun openQuestion(index: Int, now: Long): GameEvent? {
        val q = quiz.questions.getOrNull(index) ?: return null
        return emit(QuestionOpened(nextSeq, now, index, q.id))
    }

    /** Première question de chaque jeu de la prestation (manche), dans l'ordre du programme. */
    val rounds: List<Int>
        get() = quiz.questions.indices.filter { i ->
            i == 0 || quiz.questions[i].roundTitle == null || quiz.questions[i].roundTitle != quiz.questions[i - 1].roundTitle
        }

    /**
     * Première question de la série à points multipliés (dernières questions d'une manche de quiz) qui contient
     * [index], ou null hors d'une telle série. Le blind test garde ses propres morceaux doublés, hors de ce réglage.
     */
    fun doubleRunStart(index: Int): Int? {
        val q = quiz.questions.getOrNull(index)?.takeIf { it.double && !it.isBlind } ?: return null
        var i = index
        while (quiz.questions.getOrNull(i - 1)?.let { it.double && !it.isBlind && it.roundTitle == q.roundTitle } == true) i--
        return i
    }

    /**
     * Annonce « × N » en cours (première des questions multipliées, avant que le chrono parte) : l'heure de départ
     * du chrono ; null sinon. Une pause pendant l'annonce la remplace par le décompte ordinaire de la reprise.
     */
    fun multiplierIntroUntil(): Long? {
        val s = state
        if (s.phase != Phase.QUESTION || s.index < 0 || doubleRunStart(s.index) != s.index) return null
        return s.resumeAt?.takeIf { s.segments.size == 1 && it == s.openedAt && !s.paused }
    }

    /** Nombre de questions à points multipliés de la série en cours, à partir de la question [index] comprise. */
    fun multipliedLeft(index: Int): Int {
        val q = quiz.questions.getOrNull(index)?.takeIf { it.double && !it.isBlind } ?: return 0
        var n = 0
        while (quiz.questions.getOrNull(index + n)?.let { it.double && !it.isBlind && it.roundTitle == q.roundTitle } == true) n++
        return n
    }

    /** Multiplicateur des points de la question [index] : 1, ou celui choisi pour sa série (×2 par défaut). */
    fun factorOf(index: Int): Int = factorIn(state, index)

    private fun factorIn(s: GameState, index: Int): Int =
        quiz.questions.getOrNull(index)?.takeIf { it.isBlind }?.let { if (it.double) 2 else 1 }
            ?: doubleRunStart(index)?.let { s.factors[it] ?: FACTORS.first() } ?: 1

    /**
     * Série à points multipliés dont l'animatrice peut encore choisir le multiplicateur : celle qui commence à la
     * question suivante, entre deux questions (jamais pendant une question déjà affichée avec sa valeur).
     */
    fun factorChoice(): Int? {
        if (state.phase != Phase.LOBBY && state.phase != Phase.REVEAL && state.phase != Phase.SCORES) return null
        val next = state.index + 1
        return next.takeIf { doubleRunStart(it) == it }
    }

    fun chooseFactor(factor: Int, now: Long): GameEvent? {
        val start = factorChoice() ?: return null
        if (factor !in FACTORS) return null
        return emit(FactorChosen(nextSeq, now, start, factor))
    }

    /** Questions du jeu (manche) qui commence ou contient la question [index]. */
    fun roundOf(index: Int): IntRange {
        val starts = rounds
        val start = starts.lastOrNull { it <= index } ?: 0
        val end = (starts.firstOrNull { it > index } ?: quiz.questions.size) - 1
        return start..end
    }

    /**
     * Saut de la régie au début du jeu qui contient [index] : jeu suivant, autre jeu, ou jeu rejoué.
     * Un jeu déjà commencé (le jeu en cours, un jeu d'avant, ou un jeu plus loin déjà ouvert avant un retour
     * en arrière) est rejoué : ses points sont retirés avant d'être rejoués, et la box efface ses anciennes
     * réponses (sinon les règles refuseraient les nouvelles et le jeu ne rapporterait plus rien). Les équipes,
     * les autres points et les corrections restent. Possible en pause (la pause est levée) et après la fin de
     * partie (fin demandée par erreur).
     */
    fun goto(index: Int, now: Long): GameEvent? {
        if (index !in quiz.questions.indices) return null
        val round = roundOf(index)
        val ids = round.map { quiz.questions[it].id }
        val replay = state.index >= round.first ||
            log.any { (it is QuestionOpened && it.qid in ids) || (it is Jumped && it.qid in ids) }
        val clear = if (replay) ids else emptyList()
        return emit(Jumped(nextSeq, now, round.first, quiz.questions[round.first].id, clear))
    }

    fun pause(now: Long, reason: String = PAUSE_REGIE, team: String? = null): GameEvent? =
        emit(Paused(nextSeq, now, reason, team))

    /** Reprise avec le décompte 3, 2, 1 : le chrono repart quand il se termine. */
    fun resume(now: Long, countdownMs: Long = RESUME_COUNTDOWN_MS): GameEvent? = emit(Resumed(nextSeq, now, countdownMs))
    fun close(now: Long): GameEvent? =
        if (state.paused || question?.isGonfleur == true || question?.isPatate == true) null else emit(QuestionClosed(nextSeq, now))

    /** « Ça va exploser ! » : une mèche est à allumer (jeu lancé, pas encore de bombe, ou la précédente vient d'exploser). */
    fun needsPotato(): Boolean {
        val q = question ?: return false
        val p = state.potato
        return q.isPatate && state.phase == Phase.QUESTION && !state.intro && !state.paused && (p == null || (p.exploded && !p.last))
    }

    /**
     * « Ça va exploser ! » : allume la mèche (durée tirée au sort) ; la bombe part d'une équipe tirée au sort parmi [teams],
     * jamais celle chez qui la bombe précédente vient d'exploser.
     */
    fun lightPotato(teams: List<String>, now: Long, random: Random = Random.Default): GameEvent? {
        val q = question ?: return null
        val playing = teams.distinct()
        if (!needsPotato() || playing.size < 2) return null
        val p = state.potato
        val start = playing.filter { it != p?.booms?.lastOrNull()?.holder }.random(random)
        return emit(PotatoLit(nextSeq, now, q.id, start, drawFuse(random), playing, bomb = (p?.bomb ?: 0) + 1))
    }

    /**
     * « Ça va exploser ! » : [team] envoie la bombe à [to]. Refusé si [team] ne la tient pas, avant la fin de la mèche qui
     * colle, vers l'envoyeur (sauf à 2 équipes), en pause ou pendant un décompte.
     */
    fun passPotato(team: String, to: String, now: Long, sentAt: Long = now): GameEvent? {
        val p = state.potato ?: return null
        if (state.paused || state.phase != Phase.QUESTION || p.exploded || p.holder != team || to !in p.targets) return null
        if (now + ARM_TOLERANCE_MS < p.readyAt || (state.resumeAt ?: Long.MIN_VALUE) > now + ARM_TOLERANCE_MS) return null
        // Envoi parti avant la fin de la mèche (heure du serveur de l'écriture) : il compte, même reçu un peu après.
        if (remainingMs(minOf(sentAt, now)) == 0L) return null
        return emit(PotatoPassed(nextSeq, maxOf(now, p.readyAt), state.qid!!, team, to))
    }

    /** « Ça va exploser ! », secours de la régie : la bombe part au hasard chez une équipe permise (tablette en panne). */
    fun passPotatoRandom(now: Long, random: Random = Random.Default): GameEvent? {
        val p = state.potato ?: return null
        return passPotato(p.holder, p.targets.randomOrNull(random) ?: return null, now)
    }

    /** « Ça va exploser ! » : la mèche est arrivée au bout, la bombe explose chez l'équipe qui la tient. */
    fun explode(now: Long): GameEvent? {
        val p = state.potato ?: return null
        if (state.paused || state.phase != Phase.QUESTION || p.exploded || remainingMs(now) > 0) return null
        return emit(PotatoExploded(nextSeq, now, state.qid!!, p.holder))
    }

    /**
     * Gonfleur fou : fin de la course d'après les tapes des tablettes ([pumps], équipes inscrites [teams]). Un ballon
     * éclaté la termine toujours ; [stop] (arrêt de l'animatrice, fin du chrono de secours) donne la victoire au plus
     * gros ballon. Rien pendant le décompte du départ ou d'une reprise, ni en pause.
     */
    fun balloon(pumps: Map<String, Pump>, teams: Collection<String>, now: Long, stop: Boolean): GameEvent? {
        val q = question ?: return null
        if (!q.isGonfleur || state.phase != Phase.QUESTION || state.intro || state.paused || teams.isEmpty()) return null
        if (stop && (state.resumeAt ?: Long.MIN_VALUE) > now) return null
        val winner = pumpWinner(pumps.filterKeys { it in teams }, teams, stop) ?: return null
        return emit(BalloonBurst(nextSeq, now, q.id, winner, teams.toList()))
    }

    /** Gonfleur fou : heure du serveur du « GONFLEZ ! » de cette course (null hors course). */
    val pumpGoAt: Long? get() = state.openedAt?.takeIf { question?.isGonfleur == true && !state.intro }

    /** Calcule les points à partir des réponses reçues. Les réponses des équipes inconnues sont ignorées par l'appelant. */
    fun reveal(now: Long, answers: Map<String, Answer>): GameEvent? {
        val q = question ?: return null
        if (state.phase != Phase.CLOSED) return null
        // Image floue : les points viennent du buzzer ; chrono écoulé sans bonne réponse, personne ne marque.
        val awards = if (q.isBuzz || q.isStatues) emptyMap()
        else if (q.isPortes) Scoring.awardPortes(q.copy(doors = doorsOf(q)), answers, state.scores())
        else if (q.isNumber) Scoring.awardNumber(q, answers, factorOf(state.index))
        else if (q.isExpress) answers.mapValues { (_, a) -> Scoring.awardExpress(q, a, factorOf(state.index)) }
        else answers.mapValues { (_, a) ->
            val remaining = (q.durationMs - state.elapsedAt(a.at)).coerceAtLeast(0)
            Scoring.award(q, a, remaining.toDouble() / q.durationMs, factorOf(state.index))
        }
        return emit(Revealed(nextSeq, now, q.id, awards))
    }

    /**
     * Vrai ou Faux express : l'étape que la box fait toute seule après un court délai ([expressDelayMs]).
     * Question fermée : révélation. Révélation : affirmation suivante de la même manche, ou scores à la
     * fin de la manche. Rien en pause, ni hors d'une manche express.
     */
    fun expressStep(now: Long, answers: Map<String, Answer>): GameEvent? {
        val q = question ?: return null
        if (!q.isExpress || state.paused) return null
        return when (state.phase) {
            Phase.CLOSED -> reveal(now, answers)
            Phase.REVEAL -> {
                val following = quiz.questions.getOrNull(state.index + 1)
                if (following != null && following.isExpress && following.roundTitle == q.roundTitle) openQuestion(state.index + 1, now)
                else emit(ScoresShown(nextSeq, now))
            }
            else -> null
        }
    }

    /** Portes mystères : valeurs derrière les portes de [q], avec celles changées par l'animatrice. */
    fun doorsOf(q: Question): List<Int> = q.doors.mapIndexed { i, v -> state.doorValues[q.id]?.get(i) ?: v }

    /** Portes mystères : change la valeur d'une porte, tant qu'aucune n'est ouverte (choix en cours ou fermés). */
    fun setDoor(door: Int, value: Int, now: Long): GameEvent? {
        val q = question ?: return null
        if (!q.isPortes || (state.phase != Phase.QUESTION && state.phase != Phase.CLOSED)) return null
        if (door !in q.choices.indices || value !in DOOR_VALUES || doorsOf(q).getOrNull(door) == value) return null
        return emit(DoorSet(nextSeq, now, q.id, door, value))
    }

    /** Portes mystères : ouvre la porte suivante (rien hors de la révélation, ni quand toutes sont ouvertes). */
    fun openDoor(now: Long): GameEvent? {
        val q = question ?: return null
        if (!q.isPortes || state.phase != Phase.REVEAL || state.doorsOpened >= q.choices.size) return null
        return emit(DoorOpened(nextSeq, now, q.id))
    }

    /**
     * Portes mystères : ordre d'ouverture des portes, de gauche à droite (porte 1, porte 2…), comme sur les tablettes.
     * Le suspense vient des valeurs tirées au hasard, pas de l'ordre.
     */
    fun doorOrder(): List<Int> = question?.takeIf { it.isPortes }?.choices?.indices?.toList() ?: emptyList()

    /** Les coffres mystères : les coffres du jeu en cours, ou null (autre jeu, coffres pas encore installés). */
    val chestRound: ChestRound? get() = state.qid?.let { state.chests[it] }?.takeIf { question?.isCoffres == true }

    /** Les coffres mystères : le jeu vient d'être lancé, la box doit installer les coffres ([dealChests]). */
    fun needsChests(): Boolean {
        val q = question ?: return false
        return q.isCoffres && state.phase == Phase.QUESTION && !state.intro && !state.paused && q.id !in state.chests
    }

    /**
     * Les coffres mystères : installe les coffres pour les équipes [teams] (dans l'ordre d'inscription). L'équipe la plus en
     * retard commence ; à égalité, l'ordre d'inscription.
     */
    fun dealChests(teams: List<String>, now: Long): GameEvent? {
        val q = question ?: return null
        if (!needsChests() || teams.isEmpty()) return null
        val scores = state.scores()
        val order = teams.distinct().sortedBy { scores[it] ?: 0 }
        return emit(ChestsDealt(nextSeq, now, q.id, order, chestCount(order.size), order.size * safeRounds(order.size)))
    }

    /**
     * Les coffres mystères : l'équipe [team] ouvre le coffre [chest] ; son contenu est tiré au sort maintenant. Refusé
     * avant la fin de l'animation précédente ([ChestRound.readyAt]), en pause, ou si ce n'est pas le tour de [team].
     */
    fun openChest(team: String, chest: Int, now: Long, random: Random = Random.Default): GameEvent? {
        val r = chestRound ?: return null
        if (state.paused || r.team != team || chest !in r.closed || now + ARM_TOLERANCE_MS < r.readyAt) return null
        val score = (state.scores()[team] ?: 0).coerceAtLeast(0)
        val value = drawChest(r, random)
        val delta = if (value == null) -minOf(BOMB_POINTS, score) else if (value < 0) maxOf(value, -score) else value
        return emit(ChestOpened(nextSeq, now, r.let { question!!.id }, team, chest, delta, bomb = value == null, gold = value == GOLD_POINTS))
    }

    /** Les coffres mystères, secours de la régie : un coffre fermé au hasard pour l'équipe qui joue (tablette en panne). */
    fun openRandomChest(now: Long, random: Random = Random.Default): GameEvent? {
        val r = chestRound ?: return null
        val team = r.team ?: return null
        val chest = r.closed.randomOrNull(random) ?: return null
        return openChest(team, chest, now, random)
    }

    /** Blind test : le morceau qui suit le morceau en cours dans la même playlist, s'il y en a un. */
    fun nextTrack(): Question? {
        if (question?.isBlind != true) return null
        return quiz.questions.getOrNull(state.index + 1)?.takeIf { it.isBlind && state.index + 1 in roundOf(state.index) }
    }

    /** Blind test : les morceaux de la playlist en cours, dans l'ordre, avec leur valeur et ce qu'ils sont devenus. */
    fun blindTracks(): List<BlindTrack> {
        val s = state
        if (question?.isBlind != true) return emptyList()
        return roundOf(s.index).filter { quiz.questions[it].isBlind }.map { i ->
            val t = quiz.questions[i]
            val award = s.awards[t.id]
            val winner = award?.entries?.firstOrNull { it.value.correct }
            BlindTrack(
                qid = t.id,
                points = t.trackPoints * (if (t.double) 2 else 1),
                status = when {
                    winner != null -> BlindStatus.FOUND
                    award != null -> BlindStatus.REVEALED
                    t.id in s.skipped -> BlindStatus.SKIPPED
                    i == s.index && s.phase == Phase.QUESTION -> BlindStatus.PLAYING
                    else -> BlindStatus.TODO
                },
                team = winner?.key,
            )
        }
    }

    /** Blind test : lance ou relance la musique. [unblock] : toutes les équipes peuvent de nouveau buzzer. */
    fun blindPlay(now: Long, unblock: Boolean = false): GameEvent? = emit(BlindPlayed(nextSeq, now, unblock))

    /** Blind test : arrête la musique (fin de l'extrait) ; on attend la relance de l'animatrice. */
    fun blindStop(now: Long): GameEvent? = emit(BlindStopped(nextSeq, now))

    /** Blind test : toutes les équipes peuvent de nouveau buzzer sur ce morceau. */
    fun blindUnblock(now: Long): GameEvent? = emit(BuzzUnblocked(nextSeq, now))

    /**
     * Blind test : heure à partir de laquelle les équipes qui se sont trompées peuvent rebuzzer sur ce morceau
     * (3 s après la reprise de la musique, après le décompte 3, 2, 1 s'il y en a un) ; null hors musique en cours.
     */
    fun rebuzzAt(): Long? = rebuzzAtIn(state)

    private fun rebuzzAtIn(s: GameState): Long? {
        val seg = s.segments.lastOrNull()
        if (s.phase != Phase.QUESTION || quiz.questions.getOrNull(s.index)?.isBlind != true || s.buzz?.waiting != false || seg == null || seg.end != null) return null
        return seg.start + REBUZZ_DELAY_MS
    }

    // Petite tolérance : l'heure du buzz vient de la tablette, celle de la reprise de la box.
    private fun rebuzzOpen(s: GameState, at: Long): Boolean = rebuzzAtIn(s)?.let { at + ARM_TOLERANCE_MS >= it } == true

    /** Blind test : révèle le morceau sans gagnant (aucun point). */
    fun blindReveal(now: Long): GameEvent? {
        val q = question?.takeIf { it.isBlind } ?: return null
        return emit(Revealed(nextSeq, now, q.id, emptyMap()))
    }

    /** Blind test : passe le morceau sans le révéler. */
    fun blindSkip(now: Long): GameEvent? {
        val q = question?.takeIf { it.isBlind } ?: return null
        return emit(BlindSkipped(nextSeq, now, q.id))
    }

    /** Blind test : raccourcit la révélation en cours. */
    fun blindCut(now: Long): GameEvent? {
        val q = question?.takeIf { it.isBlind } ?: return null
        return emit(RevealCut(nextSeq, now, q.id))
    }

    /** Statues musicales : l'animatrice désigne l'équipe gagnante ; [others] = les autres équipes inscrites. */
    fun statuesWin(team: String, others: Collection<String>, now: Long): GameEvent? = emit(StatuesWon(nextSeq, now, team, others.toList()))

    /** Image floue : [team] a buzzé la première (refusé si une équipe attend déjà son verdict, ou si [team] est bloquée). */
    fun buzz(team: String, now: Long): GameEvent? = emit(Buzzed(nextSeq, now, team))

    /** Image floue : verdict de l'animatrice sur la réponse orale de l'équipe qui a buzzé. */
    fun judgeBuzz(ok: Boolean, now: Long, bonus: Boolean = false): GameEvent? = emit(BuzzJudged(nextSeq, now, ok, bonus && ok))

    /** Délai avant l'étape automatique du Vrai ou Faux express, ou null s'il n'y en a pas. */
    /**
     * Qui a disparu ? : temps de chrono à attendre avant d'ouvrir le buzzer, ou null s'il n'y a rien à
     * attendre (autre jeu, buzzer déjà ouvert, pause).
     */
    fun armDelayMs(now: Long): Long? {
        val q = question ?: return null
        val b = state.buzz ?: return null
        if (state.phase != Phase.QUESTION || b.armed || state.paused) return null
        // Décompte 3, 2, 1 d'une reprise : le chrono n'a pas encore repris, la mémorisation attend aussi.
        val countdown = state.segments.lastOrNull()?.takeIf { it.end == null }?.let { it.start - now }?.coerceAtLeast(0) ?: 0
        return countdown + (q.buzzFromMs - state.elapsedAt(now)).coerceAtLeast(0)
    }

    /** Ouvre le buzzer de Qui a disparu ? une fois la mémorisation finie (jamais avant). */
    fun armBuzz(now: Long): GameEvent? {
        val wait = armDelayMs(now) ?: return null
        return if (wait > ARM_TOLERANCE_MS) null else emit(BuzzArmed(nextSeq, now))
    }

    fun expressDelayMs(): Long? {
        if (question?.isExpress != true || state.paused) return null
        return when (state.phase) {
            Phase.CLOSED -> EXPRESS_CLOSED_MS
            Phase.REVEAL -> EXPRESS_REVEAL_MS
            else -> null
        }
    }

    fun adjust(team: String, delta: Int, reason: String, now: Long): GameEvent? =
        emit(ScoreAdjusted(nextSeq, now, team, delta, reason))

    /**
     * Points donnés à la télécommande (fête sans Internet : les équipes montrent leurs cartes A B C D) :
     * un malus ne fait jamais passer l'équipe sous zéro, et au-delà de [Command.MAX_DELTA] rien ne part.
     */
    fun remotePoints(team: String, delta: Int, now: Long): GameEvent? {
        if (delta == 0 || kotlin.math.abs(delta) > Command.MAX_DELTA) return null
        val applied = if (delta < 0) maxOf(delta, -(state.scores()[team] ?: 0).coerceAtLeast(0)) else delta
        return if (applied == 0) null else adjust(team, applied, REASON_REMOTE, now)
    }

    fun undo(target: Int, now: Long): GameEvent? = emit(Undone(nextSeq, now, target))

    fun end(now: Long): GameEvent? = emit(GameEnded(nextSeq, now))

    fun mimeStart(team: String, now: Long): GameEvent? = emit(MimeTurnStarted(nextSeq, now, team))

    /** Pictionary : montrer le mot à l'équipe [team], sur sa tablette. */
    fun pictoShow(team: String, now: Long): GameEvent? = emit(PictoShown(nextSeq, now, team))

    /** Pictionary : le dessinateur a choisi le mot [choice] (0 à 2) parmi ceux proposés sur sa tablette. */
    fun pictoChoose(choice: Int, now: Long): GameEvent? = emit(PictoChosen(nextSeq, now, choice))

    /** Pictionary : masquer le mot, la tablette devient une feuille à dessin et le chrono part. */
    fun pictoDraw(now: Long): GameEvent? = state.mime?.secret?.let { mimeStart(it, now) }
    fun mimeFound(now: Long): GameEvent? = emit(MimeFound(nextSeq, now))
    fun mimePass(now: Long): GameEvent? = emit(MimePassed(nextSeq, now))
    fun mimeFix(team: String, delta: Int, now: Long): GameEvent? = emit(MimeCorrected(nextSeq, now, team, delta))
    fun mimeStop(now: Long): GameEvent? = emit(MimeTurnEnded(nextSeq, now))

    /** Chrono à zéro : fin de la question, ou fin du tour de mimes. */
    fun timeUp(now: Long): GameEvent? = when {
        state.intro -> null
        // Gonfleur fou : la fin du chrono de secours a besoin des tapes des tablettes ([balloon]).
        question?.isGonfleur == true -> null
        question?.isPatate == true -> explode(now)
        state.mime != null -> mimeStop(now)
        // Blind test : chrono à zéro sans bonne réponse, « Personne n'a trouvé » puis la révélation (titre, pochette,
        // refrain pour chanter tous ensemble), sans points.
        // Seulement musique en cours et extrait joué jusqu'au bout : jamais pendant l'attente du « Lancer » (reprise
        // après une pause) ni pendant la réponse d'une équipe qui a buzzé.
        question?.isBlind == true -> if (state.buzz?.waiting == false && state.buzz?.team == null && remainingMs(now) == 0L) blindReveal(now) else null
        else -> close(now)
    }

    /** Carte affichée pendant le tour de mimes, ou null. */
    val mimeCard: MimeCard? get() {
        val m = state.mime ?: return null
        // Pictionary, pendant le choix : le mot choisi par le dessinateur (aucun tant qu'il hésite).
        if (m.secret != null) return m.pick?.let { question?.cards?.getOrNull(it) }
        return m.takeIf { it.team != null }?.deck?.firstOrNull()?.let { question?.cards?.getOrNull(it) }
    }

    /** Pictionary : les mots proposés au dessinateur pendant qu'il choisit. */
    val offerCards: List<MimeCard> get() = state.mime?.takeIf { it.secret != null }?.offer.orEmpty().mapNotNull { question?.cards?.getOrNull(it) }

    /** Pictionary : le mot du dernier tour terminé, montré à tous (TV comprise) une fois le tour fini. */
    val lastCard: MimeCard? get() = state.mime?.last?.card?.let { question?.cards?.getOrNull(it) }

    /**
     * Équipe qui joue ensuite aux mimes, pour la télécommande : la première de [order] qui a le moins joué
     * dans cette manche.
     */
    fun nextMimeTeam(order: List<String>): String? {
        val turns = state.mime?.turns ?: return null
        return order.minByOrNull { team -> turns.count { it == team } }
    }
}
