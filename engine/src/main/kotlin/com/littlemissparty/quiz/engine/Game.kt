package com.littlemissparty.quiz.engine

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

/** Vrai ou Faux express : temps de la révélation avant l'affirmation suivante. */
const val EXPRESS_REVEAL_MS = 3_500L

/** Image floue : l'équipe qui a buzzé et attend le verdict de l'animatrice, et les équipes déjà bloquées. */
data class BuzzRound(val team: String? = null, val blocked: List<String> = emptyList())

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
    val lastSeq: Int = 0,
    val hold: Hold? = null,
    /** Heure du serveur où se termine le décompte de la dernière reprise. */
    val resumeAt: Long? = null,
    /** Mimes trouvés, par manche de mimes puis par équipe. */
    val mimes: Map<String, Map<String, Int>> = emptyMap(),
    /** Manche de mimes en cours (null pour une question ordinaire). */
    val mime: MimeRound? = null,
    /** Image floue en cours (null pour une autre question). */
    val buzz: BuzzRound? = null,
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
        mimes.values.forEach { perTeam -> perTeam.forEach { (team, n) -> totals.merge(team, n * Scoring.MIME, Int::plus) } }
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
)

data class MimeTurn(val team: String, val found: Int, val passed: Int)

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
        return (q.durationMs - state.elapsedAt(now)).coerceAtLeast(0)
    }

    /** Le chrono de [q] est en marche (ou en pause) : question ouverte, ou tour de mimes en cours. */
    private fun timerRuns(q: Question) = state.phase == Phase.QUESTION && (!q.isMime || state.mimeTurn)

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
     * car les tablettes ne la reçoivent plus et ne peuvent plus répondre. Une seule fois par question et par
     * coupure ([alreadyFor] = question déjà mise en pause pendant cette coupure) : si l'animatrice relance
     * quand même à la télécommande, la box ne la contredit pas.
     */
    fun networkPause(now: Long, offlineMs: Long, alreadyFor: String?): GameEvent? {
        if (offlineMs < NETWORK_GRACE_MS || state.phase != Phase.QUESTION || state.paused) return null
        if (state.qid == alreadyFor || remainingMs(now) == 0L) return null
        return pause(now, PAUSE_NETWORK)
    }

    /** Heure du serveur à laquelle le chrono atteindra zéro, ou null s'il est en pause ou arrêté. */
    fun deadline(): Long? {
        val q = question ?: return null
        if (!timerRuns(q) || state.paused || state.buzzHeld) return null
        val running = state.segments.last()
        val before = state.elapsedAt(running.start)
        return running.start + q.durationMs - before
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

    private fun reduce(s: GameState, e: GameEvent): GameState? = when (e) {
        is QuestionOpened -> {
            val q = quiz.questions.getOrNull(e.index)
            val canOpen = s.phase == Phase.LOBBY || s.phase == Phase.SCORES || s.phase == Phase.REVEAL
            if (q == null || q.id != e.qid || !canOpen || e.index <= s.index || s.paused) null
            // Une manche de mimes s'ouvre sans chrono : il part au lancement du tour de chaque équipe.
            else open(s, e.index, q, e.at)
        }
        is Jumped -> {
            val q = quiz.questions.getOrNull(e.index)
            if (q == null || q.id != e.qid) null
            else open(s.copy(awards = s.awards - e.clear.toSet(), mimes = s.mimes - e.clear.toSet(), hold = null), e.index, q, e.at)
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
                    segments = if (s.phase == Phase.QUESTION && (s.mime == null || s.mimeTurn) && !s.buzzHeld) s.segments + Segment(start) else s.segments,
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
            if (s.phase != Phase.CLOSED || e.qid != s.qid || s.paused) null
            // Une seule attribution par question : la clé est l'identifiant de la question.
            else s.copy(phase = Phase.REVEAL, awards = s.awards + (e.qid to e.awards))
        is ScoresShown -> when {
            s.paused -> null
            s.phase == Phase.REVEAL -> s.copy(phase = Phase.SCORES)
            // Fin d'une manche de mimes, entre deux tours : les points sont déjà comptés, on passe au classement.
            s.phase == Phase.QUESTION && s.mime != null && !s.mimeTurn -> s.copy(phase = Phase.SCORES, mime = null)
            else -> null
        }
        is ScoreAdjusted ->
            if (e.delta == 0 || e.team.isBlank()) null
            else s.copy(adjustments = s.adjustments + (e.seq to e))
        is Undone ->
            if (e.target !in s.adjustments) null
            else s.copy(adjustments = s.adjustments - e.target)
        is GameEnded ->
            if (s.phase == Phase.ENDED) null else s.copy(phase = Phase.ENDED, hold = null, mime = null)
        is MimeTurnStarted -> {
            val m = s.mime
            val cards = quiz.questions.getOrNull(s.index)?.cards.orEmpty()
            if (m == null || m.team != null || s.paused || cards.isEmpty() || e.team.isBlank()) null
            else s.copy(
                segments = listOf(Segment(e.at)), resumeAt = null,
                // Paquet épuisé par les équipes précédentes : il est rebattu pour que chaque équipe ait son tour.
                mime = m.copy(
                    deck = m.deck.ifEmpty { cards.indices.toList() },
                    team = e.team, found = 0, passed = 0, turns = m.turns + e.team,
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
                // Paquet épuisé : le tour s'arrête de lui-même.
                if (next.mime!!.deck.isEmpty()) endTurn(next, e.at) else next
            }
        }
        is MimePassed -> {
            val m = s.mime
            if (m?.team == null || s.paused || m.deck.size < 2) null
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
        is MimeTurnEnded -> if (s.mime?.team == null) null else endTurn(s, e.at)
        is Buzzed -> {
            val b = s.buzz
            if (s.phase != Phase.QUESTION || b == null || b.team != null || s.paused || e.team.isBlank() || e.team in b.blocked) null
            else s.copy(
                buzz = b.copy(team = e.team),
                segments = s.segments.map { if (it.end == null) it.copy(end = maxOf(e.at, it.start)) else it },
            )
        }
        is BuzzJudged -> {
            val b = s.buzz
            val team = b?.team
            val q = quiz.questions.getOrNull(s.index)
            if (s.phase != Phase.QUESTION || b == null || team == null || s.paused || q == null) null
            else if (e.ok) {
                val factor = if (q.double) 2 else 1
                val points = (if (b.blocked.isEmpty()) Scoring.BUZZ else Scoring.BUZZ_REBOUND) * factor
                s.copy(phase = Phase.REVEAL, awards = s.awards + (q.id to mapOf(team to Award(q.correct, correct = true, points = points, bonus = 0))))
            }
            // Mauvaise réponse : l'équipe est bloquée sur cette image, le chrono repart.
            else s.copy(buzz = b.copy(team = null, blocked = b.blocked + team), segments = s.segments + Segment(e.at))
        }
    }

    /**
     * Question [q] ouverte : chrono lancé, ou manche de mimes sans chrono (il part au tour de chaque équipe).
     * Une manche de mimes rouverte (jeu rejoué) repart de zéro : ses mimes ne comptent jamais deux fois.
     */
    private fun open(s: GameState, index: Int, q: Question, at: Long): GameState =
        if (q.isMime) s.copy(
            phase = Phase.QUESTION, index = index, qid = q.id, segments = emptyList(), resumeAt = null,
            mimes = s.mimes - q.id, mime = MimeRound(deck = q.cards.indices.toList()),
        )
        else s.copy(
            phase = Phase.QUESTION, index = index, qid = q.id, segments = listOf(Segment(at)), resumeAt = null, mime = null,
            buzz = if (q.isBuzz) BuzzRound() else null,
        )

    /** Tour de mimes terminé : chrono arrêté, bilan gardé pour la TV et la régie. */
    private fun endTurn(s: GameState, at: Long): GameState {
        val m = s.mime!!
        return s.copy(
            segments = s.segments.map { if (it.end == null) it.copy(end = maxOf(at, it.start)) else it },
            mime = m.copy(team = null, found = 0, passed = 0, last = MimeTurn(m.team!!, m.found, m.passed)),
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
        Phase.QUESTION -> if (state.mime == null) close(now) else if (state.mimeTurn) mimeStop(now) else emit(ScoresShown(nextSeq, now))
        Phase.CLOSED -> reveal(now, answers)
        // Vrai ou Faux express : « suivant » passe à l'affirmation suivante, comme la box le fait seule.
        Phase.REVEAL -> if (question?.isExpress == true) expressStep(now, answers) else emit(ScoresShown(nextSeq, now))
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

    /** Questions du jeu (manche) qui commence ou contient la question [index]. */
    fun roundOf(index: Int): IntRange {
        val starts = rounds
        val start = starts.lastOrNull { it <= index } ?: 0
        val end = (starts.firstOrNull { it > index } ?: quiz.questions.size) - 1
        return start..end
    }

    /**
     * Saut de la régie au début du jeu qui contient [index] : jeu suivant, autre jeu, ou jeu rejoué.
     * Un jeu déjà commencé (le jeu en cours, ou un jeu d'avant) est rejoué : ses points sont retirés
     * avant d'être rejoués. Les équipes, les autres points et les corrections restent. Possible en pause
     * (la pause est levée) et après la fin de partie (fin demandée par erreur).
     */
    fun goto(index: Int, now: Long): GameEvent? {
        if (index !in quiz.questions.indices) return null
        val round = roundOf(index)
        val replay = state.index >= round.first
        val clear = if (replay) round.map { quiz.questions[it].id } else emptyList()
        return emit(Jumped(nextSeq, now, round.first, quiz.questions[round.first].id, clear))
    }

    fun pause(now: Long, reason: String = PAUSE_REGIE, team: String? = null): GameEvent? =
        emit(Paused(nextSeq, now, reason, team))

    /** Reprise avec le décompte 3, 2, 1 : le chrono repart quand il se termine. */
    fun resume(now: Long, countdownMs: Long = RESUME_COUNTDOWN_MS): GameEvent? = emit(Resumed(nextSeq, now, countdownMs))
    fun close(now: Long): GameEvent? = if (state.paused) null else emit(QuestionClosed(nextSeq, now))

    /** Calcule les points à partir des réponses reçues. Les réponses des équipes inconnues sont ignorées par l'appelant. */
    fun reveal(now: Long, answers: Map<String, Answer>): GameEvent? {
        val q = question ?: return null
        if (state.phase != Phase.CLOSED) return null
        // Image floue : les points viennent du buzzer ; chrono écoulé sans bonne réponse, personne ne marque.
        val awards = if (q.isBuzz) emptyMap()
        else if (q.isNumber) Scoring.awardNumber(q, answers)
        else if (q.isExpress) answers.mapValues { (_, a) -> Scoring.awardExpress(q, a) }
        else answers.mapValues { (_, a) ->
            val remaining = (q.durationMs - state.elapsedAt(a.at)).coerceAtLeast(0)
            Scoring.award(q, a, remaining.toDouble() / q.durationMs)
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

    /** Image floue : [team] a buzzé la première (refusé si une équipe attend déjà son verdict, ou si [team] est bloquée). */
    fun buzz(team: String, now: Long): GameEvent? = emit(Buzzed(nextSeq, now, team))

    /** Image floue : verdict de l'animatrice sur la réponse orale de l'équipe qui a buzzé. */
    fun judgeBuzz(ok: Boolean, now: Long): GameEvent? = emit(BuzzJudged(nextSeq, now, ok))

    /** Délai avant l'étape automatique du Vrai ou Faux express, ou null s'il n'y en a pas. */
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

    fun undo(target: Int, now: Long): GameEvent? = emit(Undone(nextSeq, now, target))

    fun end(now: Long): GameEvent? = emit(GameEnded(nextSeq, now))

    fun mimeStart(team: String, now: Long): GameEvent? = emit(MimeTurnStarted(nextSeq, now, team))
    fun mimeFound(now: Long): GameEvent? = emit(MimeFound(nextSeq, now))
    fun mimePass(now: Long): GameEvent? = emit(MimePassed(nextSeq, now))
    fun mimeFix(team: String, delta: Int, now: Long): GameEvent? = emit(MimeCorrected(nextSeq, now, team, delta))
    fun mimeStop(now: Long): GameEvent? = emit(MimeTurnEnded(nextSeq, now))

    /** Chrono à zéro : fin de la question, ou fin du tour de mimes. */
    fun timeUp(now: Long): GameEvent? = if (state.mime != null) mimeStop(now) else close(now)

    /** Carte affichée pendant le tour de mimes, ou null. */
    val mimeCard: MimeCard? get() = state.mime?.takeIf { it.team != null }?.deck?.firstOrNull()?.let { question?.cards?.getOrNull(it) }

    /**
     * Équipe qui joue ensuite aux mimes, pour la télécommande : la première de [order] qui a le moins joué
     * dans cette manche.
     */
    fun nextMimeTeam(order: List<String>): String? {
        val turns = state.mime?.turns ?: return null
        return order.minByOrNull { team -> turns.count { it == team } }
    }
}
