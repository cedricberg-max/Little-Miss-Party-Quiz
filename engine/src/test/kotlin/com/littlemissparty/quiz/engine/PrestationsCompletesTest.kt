package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/*
 * Prestations complètes jouées de bout en bout par le vrai moteur, comme la box les joue : commandes de la
 * régie passées par Game.execute (numéro d'étape compris), minuteries de la box (fin du chrono, enchaînement
 * du Vrai ou Faux express, ouverture du buzzer de Qui a disparu ?), réponses et buzz des pupitres soumis aux
 * mêmes conditions que les règles Firebase.
 *
 * À chaque événement inscrit, la box simulée vérifie que :
 * - le journal, passé par Firebase (Codec, nombres en Long, valeurs nulles retirées), reconstruit exactement la
 *   même partie : c'est ce que fait la box au redémarrage ;
 * - le secours de la régie peut aller à chaque jeu de la prestation (jeu suivant, autre jeu, jeu rejoué), avec
 *   des points cohérents, même en pause ou après la fin ;
 * - le bouton « Suivant » de la régie (après « Reprendre » en pause) mène toujours jusqu'aux résultats.
 * Aucune étape ne peut donc laisser la partie bloquée.
 *
 * Le blind test (kind « blind ») n'est pas couvert ici : il est en cours de réécriture.
 */

private const val ROSE = "rose"
private const val BLEU = "bleu"
private const val VERT = "vert"
private val EQUIPES = setOf(ROSE, BLEU, VERT)
private const val T0 = 1_700_000_000_000L

/** GameViewModel.CLOSE_GRACE_MS : la box ferme la question un peu après la fin du chrono. */
private const val GRACE_MS = 500L

// ---------- Questions de chaque jeu ----------

private fun classique(id: String, manche: String = "Quiz", double: Boolean = false, audioId: String? = null) =
    Question(id, "Question $id ?", listOf("A", "B", "C", "D"), 1, durationSec = 20, roundTitle = manche, double = double, audioId = audioId)

private fun justeChiffre(id: String, manche: String = "Le Juste Chiffre") =
    Question(id, "Combien ?", emptyList(), 42, durationSec = 20, kind = QuestionKind.NUMBER, roundTitle = manche)

private fun express(id: String, correct: Int, manche: String = "Vrai ou Faux express", double: Boolean = false) =
    Question(id, "Affirmation $id", listOf("Vrai", "Faux"), correct, durationSec = 8, kind = QuestionKind.EXPRESS, roundTitle = manche, double = double)

private fun zoom(id: String, manche: String = "Zoom mystère") =
    Question(id, "Qu'est-ce que c'est ?", listOf("Chat", "Chien", "Lapin"), 0, durationSec = 20, kind = QuestionKind.ZOOM, roundTitle = manche, imageId = "photo-$id")

private fun mimes(id: String, manche: String = "Mimes") =
    Question(
        id, "Mimes", emptyList(), -1, durationSec = 60, kind = QuestionKind.MIME, roundTitle = manche,
        cards = listOf("Chat", "Pirate", "Pizza", "Danseuse").map { MimeCard(it, "🙂") },
    )

private fun flou(id: String, manche: String = "Image floue") =
    Question(id, "Image floue", listOf("Tour Eiffel", "Big Ben"), 0, durationSec = 30, kind = QuestionKind.FLOU, roundTitle = manche, imageId = "photo-$id")

private fun chante(id: String, manche: String = "Chante le mot !") =
    Question(id, "soleil", listOf("soleil"), 0, durationSec = 30, kind = QuestionKind.CHANTE, roundTitle = manche)

private fun quiSuis(id: String, manche: String = "Qui suis-je ?", double: Boolean = false) =
    Question(
        id, "Qui suis-je ?", listOf("Le lion"), 0, durationSec = 40, kind = QuestionKind.QUISUIS, roundTitle = manche, double = double,
        cards = listOf(MimeCard("Je rugis"), MimeCard("J'ai une crinière")),
    )

private fun disparu(id: String, manche: String = "Qui a disparu ?") =
    Question(
        id, "Qui a disparu ?", listOf("Fraise"), 0, durationSec = 45, kind = QuestionKind.DISPARU, roundTitle = manche,
        cards = listOf("Pomme", "Banane", "Fraise", "Cerise", "Raisin", "Poire").map { MimeCard(it) },
    )

private fun blind(id: String, points: Int = 100, manche: String = "Blind test · Comptines") =
    Question(id, "Quel est ce titre ?", listOf("Titre $id"), 0, durationSec = 25, kind = QuestionKind.BLIND, roundTitle = manche, audioId = "son-$id", points = points)

private fun statues(id: String) =
    Question(id, "Statues musicales", emptyList(), -1, durationSec = 90, kind = QuestionKind.STATUES, roundTitle = "Statues musicales")

/** Tous les jeux, Super Finale comprise. */
private val TOUS_LES_JEUX = Quiz(
    "tous", "Tous les jeux",
    listOf(
        classique("c1", audioId = "comptine"), classique("c2"),
        justeChiffre("n1"),
        express("e1", 0), express("e2", 1),
        zoom("z1"),
        mimes("m1"),
        flou("f1"),
        chante("h1"),
        quiSuis("w1"),
        disparu("d1"),
        blind("b1"), blind("b2", 200),
        statues("s1"),
        classique("x1", "Super Finale", double = true), express("x2", 0, "Super Finale", double = true),
    ),
)

/**
 * Points que rapporte [Box.joue] sur la question [q] : la même partie jouée à chaque fois, pour que les
 * totaux soient vérifiables au point près (Super Finale doublée).
 */
private fun gainAttendu(q: Question): Map<String, Int> {
    val f = if (q.double) 2 else 1
    return when {
        q.isMime -> mapOf(ROSE to 2 * Scoring.MIME, BLEU to Scoring.MIME)
        q.isBlind -> mapOf(BLEU to q.trackPoints * f)
        q.isBuzz -> mapOf(BLEU to Scoring.BUZZ_REBOUND * f)
        q.isStatues -> mapOf(VERT to Scoring.MINI_WIN, ROSE to Scoring.MINI_PLAYED, BLEU to Scoring.MINI_PLAYED)
        q.isNumber -> mapOf(ROSE to Scoring.NUMBER_CLOSEST, VERT to Scoring.NUMBER_CLOSEST)
        q.isExpress -> mapOf(ROSE to Scoring.EXPRESS * f)
        else -> mapOf(VERT to (Scoring.BASE + Scoring.MAX_BONUS) * f)
    }
}

private fun plus(a: Map<String, Int>, b: Map<String, Int>): Map<String, Int> = (a.keys + b.keys).associateWith { (a[it] ?: 0) + (b[it] ?: 0) }
private fun moins(a: Map<String, Int>, b: Map<String, Int>): Map<String, Int> = (a.keys + b.keys).associateWith { (a[it] ?: 0) - (b[it] ?: 0) }
private fun sansZero(m: Map<String, Int>) = m.filterValues { it != 0 }
private fun scores(rose: Int, bleu: Int, vert: Int) = mapOf(ROSE to rose, BLEU to bleu, VERT to vert)

/** Ce que Firebase rend d'une écriture : pas de valeur nulle ni de collection vide, nombres entiers en Long. */
private fun firebase(v: Any?): Any? = when (v) {
    null -> null
    is Int -> v.toLong()
    is Map<*, *> -> v.entries.mapNotNull { (k, x) -> firebase(x)?.let { k.toString() to it } }.toMap().takeIf { it.isNotEmpty() }
    is List<*> -> v.mapNotNull { firebase(it) }.takeIf { it.isNotEmpty() }
    else -> v
}

/**
 * La box : la partie (seule arbitre), le journal Firebase (`log/`), les statuts des commandes (`commandStatus/`),
 * les réponses des pupitres (`answers/`) et les minuteries, comme dans GameViewModel.
 */
private class Box(val quiz: Quiz, val teams: Set<String> = EQUIPES) {
    var game = Game(quiz)
        private set
    var now = T0
    val log = sortedMapOf<String, Map<*, *>>()
    val status = mutableMapOf<String, CommandResult>()
    private val reponses = mutableMapOf<String, MutableMap<String, Answer>>()
    private var ids = 0

    /** Chaque commande d'avancement est envoyée deux fois (double appui, deux téléphones) et livrée deux fois. */
    var doubleAppui = false

    /** La box redémarre après chaque événement : la suite se joue sur la partie relue depuis le journal. */
    var redemarreAChaqueEvenement = false

    /** Appelé aux moments clés d'une question (pause testée partout, par exemple). */
    var etape: (String) -> Unit = {}

    val state: GameState get() = game.state

    fun attend(ms: Long) {
        now += ms
    }

    fun scores(): Map<String, Int> {
        val s = state.scores()
        assertTrue(s.keys.all { it in teams }, "aucune équipe inconnue au classement : ${s.keys}")
        return teams.associateWith { s[it] ?: 0 }
    }

    // ---------- Journal ----------

    private fun commit(e: GameEvent?): GameEvent? {
        if (e == null) return null
        val key = Codec.key(e.seq)
        assertFalse(key in log, "log/$key existe déjà : les règles refuseraient toute l'écriture (état, statut compris)")
        log[key] = firebase(Codec.encode(e)) as Map<*, *>
        // GameViewModel.commit : les réponses d'une question rouverte ou d'un jeu rejoué sont effacées.
        when (e) {
            is QuestionOpened -> reponses.remove(e.qid)
            is Jumped -> e.clear.forEach { reponses.remove(it) }
            else -> Unit
        }
        val relue = Game(quiz, log.values.map { m -> assertNotNull(Codec.decode(m), "événement illisible : $m") })
        assertEquals(state, relue.state, "box redémarrée après $e : même partie")
        assertEquals(Codec.publicState(game), Codec.publicState(relue), "box redémarrée après $e : même état publié")
        scores()
        secoursToujoursPossible()
        if (redemarreAChaqueEvenement) game = relue
        return e
    }

    /** Box redémarrée : la partie est relue depuis le journal ; les statuts des commandes déjà traitées restent. */
    fun restart() {
        val relue = Game(quiz, log.values.map { Codec.decode(it)!! })
        assertEquals(state, relue.state)
        game = relue
    }

    /**
     * Depuis l'état actuel, la régie reprend toujours la main : le secours va à chaque jeu (jeu déjà commencé
     * rejoué de zéro, autres points gardés), et « Suivant » (après « Reprendre ») mène jusqu'aux résultats.
     */
    private fun secoursToujoursPossible() {
        val g = game
        g.rounds.forEach { start ->
            val copie = Game(quiz, g.events)
            val manche = g.roundOf(start).map { quiz.questions[it].id }
            val r = copie.execute(Command.Goto("secours", copie.state.lastSeq, start, manche.first()), now, teams)
            assertEquals(CommandStatus.APPLIED, r.status, "secours vers ${manche.first()} refusé en ${g.state.phase} ${g.state.qid} : ${r.reason}")
            val saut = assertIs<Jumped>(r.event)
            assertEquals(start, copie.state.index)
            assertEquals(Phase.QUESTION, copie.state.phase)
            assertFalse(copie.state.paused, "le secours lève la pause")
            assertNull(copie.state.mime?.team)
            assertNull(copie.state.buzz?.team)
            val dejaCommence = g.state.index >= start ||
                g.events.any { (it is QuestionOpened && it.qid in manche) || (it is Jumped && it.qid in manche) }
            assertEquals(
                if (dejaCommence) manche else emptyList(), saut.clear,
                "secours vers ${manche.first()} depuis ${g.state.qid} : un jeu déjà commencé repart de zéro, un jeu jamais joué n'efface rien",
            )
            val attendu = g.state.copy(awards = g.state.awards - saut.clear.toSet(), mimes = g.state.mimes - saut.clear.toSet()).scores()
            assertEquals(sansZero(attendu), sansZero(copie.state.scores()), "secours vers ${manche.first()} : seuls les points de ce jeu partent")
        }
        val copie = Game(quiz, g.events)
        var t = now
        var appuis = 0
        while (copie.state.phase != Phase.ENDED) {
            t += 1_000
            if (copie.state.paused) {
                assertEquals(CommandStatus.APPLIED, copie.execute(Command.Resume("r$appuis", copie.state.lastSeq), t, teams).status)
                t += RESUME_COUNTDOWN_MS
            }
            // Blind test : « Suivant » lance ou arrête la musique ; l'animatrice juge, puis révèle sans points.
            val blindEnCours = copie.question?.isBlind == true && copie.state.phase == Phase.QUESTION
            val c = when {
                copie.state.intro -> Command.Next("n$appuis", copie.state.lastSeq)
                blindEnCours && copie.state.buzz?.team != null -> Command.Judge("j$appuis", copie.state.lastSeq, false)
                blindEnCours -> Command.BlindReveal("v$appuis", copie.state.lastSeq)
                else -> Command.Next("n$appuis", copie.state.lastSeq)
            }
            val r = copie.execute(c, t, teams)
            assertEquals(CommandStatus.APPLIED, r.status, "« Suivant » bloqué en ${copie.state} : ${r.reason}")
            assertTrue(++appuis < 10 * quiz.questions.size + 10, "« Suivant » n'atteint jamais la fin")
        }
    }

    // ---------- Régie ----------

    /** GameViewModel.onCommand : une commande déjà traitée (même identifiant) n'est jamais rejouée. */
    fun send(c: Command): CommandResult {
        status[c.id]?.let { return it }
        val answers = if (c is Command.Next && state.phase == Phase.CLOSED) collectAnswers() else emptyMap()
        val r = game.execute(c, now, teams, answers)
        status[c.id] = r
        commit(r.event)
        return r
    }

    fun cmd(make: (String, Int) -> Command): CommandResult {
        val seq = state.lastSeq
        val first = make("c${++ids}", seq)
        val r = send(first)
        if (doubleAppui && r.status == CommandStatus.APPLIED && first !is Command.Adjust && first !is Command.Undo && first !is Command.MimeFix) {
            val avant = log.size
            assertEquals(r, send(first), "même commande livrée deux fois : même réponse, rien n'est refait")
            val encore = send(make("c${++ids}", seq))
            val attendu = if (first is Command.Pause || first is Command.Resume) CommandStatus.REFUSED else CommandStatus.STALE
            assertEquals(attendu, encore.status, "second appui sur $first")
            assertEquals(avant, log.size, "un double appui n'avance que d'une étape")
        }
        return r
    }

    fun ok(make: (String, Int) -> Command): GameEvent {
        val r = cmd(make)
        assertEquals(CommandStatus.APPLIED, r.status, "commande refusée (${r.reason}) en ${state.phase} ${state.qid}")
        return r.event!!
    }

    fun next() = ok { i, s -> Command.Next(i, s) }
    fun pause() = ok { i, s -> Command.Pause(i, s) }
    fun resume() = ok { i, s -> Command.Resume(i, s) }
    fun end() = ok { i, s -> Command.End(i, s) }
    fun goto(index: Int) = ok { i, s -> Command.Goto(i, s, index, quiz.questions[index].id) } as Jumped
    fun mimeStart(team: String) = ok { i, s -> Command.MimeStart(i, s, team) }
    fun found() = ok { i, s -> Command.MimeFound(i, s) }
    fun pass() = ok { i, s -> Command.MimePass(i, s) }
    fun mimeStop() = ok { i, s -> Command.MimeStop(i, s) }
    fun judge(good: Boolean) = ok { i, s -> Command.Judge(i, s, good) }
    fun statuesWin(team: String) = ok { i, s -> Command.StatuesWin(i, s, team) }
    fun blindPlay() = ok { i, s -> Command.BlindPlay(i, s) }

    // ---------- Pupitres (soumis aux règles Firebase) ----------

    /** answers/<qid>/<équipe> : question ouverte, pas en pause, décompte fini, avant la fin du chrono, une seule fois. */
    fun tryAnswer(team: String, choice: Int): Boolean {
        val qid = state.qid ?: return false
        val deadline = game.deadline() ?: return false
        if (state.phase != Phase.QUESTION || state.paused || state.resumeAt?.let { now < it } == true || now > deadline + 2_000) return false
        val q = game.question!!
        if (!q.isNumber && choice !in q.choices.indices) return false
        val deja = reponses.getOrPut(qid) { mutableMapOf() }
        if (team in deja) return false
        deja[team] = Answer(choice, now)
        return true
    }

    fun answer(team: String, choice: Int) = assertTrue(tryAnswer(team, choice), "le pupitre de $team peut répondre à ${state.qid}")

    /** GameViewModel.collectAnswers : équipes inscrites, réponses données pendant cette ouverture de la question. */
    private fun collectAnswers(): Map<String, Answer> =
        reponses[state.qid].orEmpty().filter { (team, a) -> team in teams && state.answeredSinceOpening(a.at) }

    /** Buzz d'un pupitre : les règles ne l'acceptent que buzzer ouvert et équipe non bloquée. */
    fun tryBuzz(team: String): GameEvent? {
        if (Codec.publicState(game)["buzzOpen"] != true || team in state.buzz?.blocked.orEmpty()) return null
        return commit(game.buzz(team, now))
    }

    fun buzz(team: String) = assertNotNull(tryBuzz(team), "$team buzze")

    // ---------- Minuteries de la box ----------

    /** GameViewModel.schedule : fin du chrono (question ou tour de mimes), vérifiée au réveil. */
    inner class Minuterie(private val deadline: Long) {
        fun fire(): GameEvent? {
            now = maxOf(now, deadline + GRACE_MS)
            val g = game
            return if (g.state.phase == Phase.QUESTION && !g.state.paused && g.remainingMs(now) == 0L) commit(g.timeUp(now)) else null
        }
    }

    fun minuterie() = Minuterie(assertNotNull(game.deadline(), "un chrono tourne"))
    fun timeUp() = assertNotNull(minuterie().fire(), "le chrono à zéro termine la question ou le tour")

    /** GameViewModel.scheduleExpress : étape oubliée si la partie a bougé entre-temps. */
    inner class EtapeExpress(private val seq: Int, private val wait: Long) {
        fun fire(): GameEvent? {
            now += wait
            if (state.lastSeq != seq) return null
            val answers = if (state.phase == Phase.CLOSED) collectAnswers() else emptyMap()
            return commit(game.expressStep(now, answers))
        }
    }

    fun etapeExpress() = EtapeExpress(state.lastSeq, assertNotNull(game.expressDelayMs(), "étape automatique du Vrai ou Faux express"))
    fun expressAuto() = assertNotNull(etapeExpress().fire())

    /** GameViewModel.scheduleArm : Qui a disparu ?, buzzer ouvert après la mémorisation. */
    fun arm(): GameEvent {
        now += assertNotNull(game.armDelayMs(now), "mémorisation en cours")
        return assertNotNull(commit(game.armBuzz(now)))
    }

    /** Action de la box elle-même (télécommande, minuterie) passée au journal. */
    fun box(action: (Game) -> GameEvent?): GameEvent? = commit(action(game))

    // ---------- Une partie type ----------

    /** Joue la question ouverte, toujours de la même façon, jusqu'à sa révélation (ou entre deux tours de mimes). */
    fun joue() {
        val q = assertNotNull(game.question)
        assertEquals(Phase.QUESTION, state.phase, "${q.id} ouverte")
        assertFalse(state.paused)
        // Annonce « × N » avant la première question multipliée : les pupitres attendent qu'elle finisse.
        game.multiplierIntroUntil()?.let { attend(it - now) }
        // Question rouverte par « Suivant » après un retour en arrière : ses anciens points sont remplacés à la
        // révélation, jamais ajoutés (les mimes, eux, repartent de zéro dès l'ouverture).
        val avant = moins(scores(), state.awards[q.id].orEmpty().mapValues { it.value.points })
        when {
            q.isMime -> {
                assertNull(game.deadline(), "mimes : pas de chrono avant le tour d'une équipe")
                etape("entre deux tours")
                mimeStart(ROSE)
                assertNotNull(game.deadline())
                etape("tour de mimes")
                // Roulement : chaque mime trouvé laisse place au changement de joueur, « Image suivante » montre la suivante.
                found(); pass(); found(); pass(); pass(); mimeStop()
                mimeStart(BLEU)
                found()
                timeUp()
                assertNull(state.mime?.team, "tour fini au chrono")
                etape("entre deux tours")
            }
            q.isBlind -> {
                assertNull(game.deadline(), "blind test : la musique attend « Lancer le morceau »")
                assertNull(tryBuzz(ROSE), "pas de buzz avant la musique")
                etape("morceau annoncé")
                next()
                etape("musique")
                buzz(ROSE)
                etape("buzz en attente")
                judge(false)
                assertNull(tryBuzz(BLEU), "musique arrêtée après une erreur : personne ne buzze")
                etape("après une erreur")
                blindPlay()
                assertNull(tryBuzz(ROSE), "une équipe qui s'est trompée est bloquée sur ce morceau")
                buzz(BLEU)
                judge(true)
            }
            q.isBuzz -> {
                if (q.isDisparu) {
                    assertNull(tryBuzz(ROSE), "on ne buzze pas pendant la mémorisation")
                    etape("mémorisation")
                    arm()
                }
                etape("question ouverte")
                buzz(ROSE)
                etape("buzz en attente")
                judge(false)
                assertNull(tryBuzz(ROSE), "une équipe qui s'est trompée est bloquée sur cette question")
                buzz(BLEU)
                judge(true)
            }
            q.isStatues -> {
                etape("question ouverte")
                timeUp()
                etape("fermée")
                statuesWin(VERT)
            }
            q.isNumber -> {
                answer(ROSE, 40); answer(BLEU, 45); answer(VERT, 44)
                etape("question ouverte")
                next()
                etape("fermée")
                next()
            }
            q.isExpress -> {
                answer(ROSE, q.correct); answer(BLEU, 1 - q.correct)
                etape("question ouverte")
                timeUp()
                etape("fermée")
                expressAuto()
            }
            else -> {
                answer(VERT, q.correct); answer(ROSE, (q.correct + 1) % q.choices.size)
                etape("question ouverte")
                next()
                etape("fermée")
                next()
            }
        }
        if (!q.isMime) assertEquals(Phase.REVEAL, state.phase, "${q.id} révélée")
        assertEquals(plus(avant, gainAttendu(q)), scores(), "points de ${q.id}")
    }

    /** Après [joue] : classement de la question, ou affirmation suivante du Vrai ou Faux express. */
    fun termine() {
        val q = game.question!!
        val avant = scores()
        when {
            q.isMime -> next()
            q.isExpress -> {
                etape("révélation")
                expressAuto()
            }
            else -> {
                etape("révélation")
                next()
            }
        }
        if (state.phase != Phase.QUESTION) assertEquals(Phase.SCORES, state.phase)
        assertNull(state.mime, "manche de mimes terminée")
        assertEquals(avant, scores(), "le classement ne change aucun score")
    }

    /** La question qui vient de s'ouvrir part de zéro : rien d'un jeu précédent ne traîne. */
    fun verifieOuverture(index: Int) {
        val q = quiz.questions[index]
        assertEquals(index, state.index)
        assertEquals(q.id, state.qid)
        assertEquals(Phase.QUESTION, state.phase)
        assertFalse(state.paused)
        // Premier écran d'un jeu : sa présentation, qui attend l'animatrice (rien ne part tout seul).
        assertEquals(quiz.intros && index in game.rounds, state.intro, "présentation de ${q.id}")
        if (state.intro) {
            val public = Codec.publicState(game)
            assertEquals(PHASE_INTRO, public["phase"])
            assertEquals(game.gameStep()?.title, (public["game"] as Map<*, *>)["title"], "nom du jeu présenté")
            assertNull(public["text"], "ni question ni propositions pendant la présentation")
            assertNull(public["choices"])
            assertEquals(false, public["buzzOpen"])
            assertNull(game.deadline(), "présentation : pas de chrono")
            assertFalse(tryAnswer(teams.first(), 0), "pas de réponse pendant la présentation")
            assertNull(tryBuzz(ROSE), "pas de buzz pendant la présentation")
            assertNull(game.armDelayMs(now), "Qui a disparu ? : la mémorisation attend le lancement")
            assertNull(game.expressDelayMs(), "Vrai ou Faux express : rien ne s'enchaîne avant le lancement")
            val avant = state
            attend(60_000)
            assertNull(game.timeUp(now), "la box ne ferme jamais une présentation")
            assertEquals(avant, state, "une minute plus tard, toujours la présentation")
            etape("présentation")
            next()
            assertFalse(state.intro, "l'animatrice a lancé ${q.id}")
        }
        val buzzer = when {
            q.isBlind -> BuzzRound(waiting = true)
            q.isBuzz -> BuzzRound(armed = q.buzzFromMs == 0L)
            else -> null
        }
        assertEquals(buzzer, state.buzz, "buzzer de ${q.id}")
        assertEquals(if (q.isMime) MimeRound(deck = q.cards.indices.toList()) else null, state.mime, "mimes de ${q.id}")
        // Première des questions multipliées : la TV annonce « × N », le chrono et les réponses partent ensuite.
        val intro = q.double && !q.isBlind && !q.isBuzz && game.doubleRunStart(index) == index
        assertEquals(if (intro) now + MULTIPLIER_INTRO_MS else null, game.multiplierIntroUntil(), "annonce × N avant ${q.id}")
        val depart = game.multiplierIntroUntil() ?: now
        if (q.isMime || q.isBlind) assertNull(game.deadline()) else assertEquals(depart + q.durationMs, game.deadline(), "chrono de ${q.id}")
        if (intro) {
            assertFalse(tryAnswer(teams.first(), 0), "pas de réponse pendant l'annonce")
            attend(depart - now)
        }
    }

    /** Joue toute la prestation avec les boutons de la régie et les minuteries, du salon d'attente aux résultats. */
    fun joueJusquAuBout() {
        if (state.phase == Phase.LOBBY) {
            next()
            verifieOuverture(0)
        }
        while (state.phase != Phase.ENDED) {
            val i = state.index
            joue()
            termine()
            if (state.phase == Phase.SCORES) {
                etape("classement")
                val gardes = scores()
                next()
                assertEquals(gardes, scores(), "scores et équipes gardés d'un jeu à l'autre")
            }
            if (state.phase == Phase.ENDED) assertEquals(quiz.questions.lastIndex, i, "fin seulement après la dernière question")
            else verifieOuverture(i + 1)
        }
    }

    /** Joue le jeu (manche) en cours jusqu'à son dernier classement. */
    fun joueManche() {
        val manche = game.roundOf(state.index)
        while (true) {
            joue()
            termine()
            if (state.phase == Phase.SCORES && state.index == manche.last) return
            if (state.phase == Phase.SCORES) next()
            assertTrue(state.index in manche)
        }
    }

    /** Pause générale à l'étape actuelle : tout est figé, rien n'avance, puis la reprise retrouve tout. */
    fun pauseVerifiee(ou: String) {
        val avant = state
        val reste = game.remainingMs(now)
        val minuterie = game.deadline()?.let { Minuterie(it) }
        val auto = game.expressDelayMs()?.let { EtapeExpress(state.lastSeq, it) }
        pause()
        assertTrue(state.paused, ou)
        assertNull(game.deadline(), "$ou : chrono figé")
        assertNull(game.expressDelayMs(), "$ou : rien d'automatique en pause")
        assertNull(game.armDelayMs(now), "$ou : le buzzer n'ouvre pas en pause")
        val bloquees = listOf<(String, Int) -> Command>(
            { i, s -> Command.Next(i, s) }, { i, s -> Command.Close(i, s) }, { i, s -> Command.MimeStart(i, s, VERT) },
            { i, s -> Command.MimeFound(i, s) }, { i, s -> Command.MimePass(i, s) }, { i, s -> Command.MimeStop(i, s) },
            { i, s -> Command.Judge(i, s, true) }, { i, s -> Command.StatuesWin(i, s, VERT) },
        )
        bloquees.forEach { make ->
            val r = send(make("p${++ids}", state.lastSeq))
            assertEquals(CommandStatus.REFUSED, r.status, "$ou : ${make("x", 0)} en pause")
            assertEquals("paused", r.reason)
        }
        assertNull(tryBuzz(VERT), "$ou : pas de buzz en pause")
        assertFalse(tryAnswer(VERT, 0), "$ou : pas de réponse en pause")
        attend(30_000)
        assertNull(minuterie?.fire(), "$ou : la fin du chrono ne passe pas pendant la pause")
        assertNull(auto?.fire(), "$ou : l'enchaînement automatique attend la reprise")
        assertEquals(reste, game.remainingMs(now), "$ou : chrono figé")
        resume()
        assertFalse(state.paused)
        assertEquals(avant.copy(segments = state.segments, lastSeq = state.lastSeq, resumeAt = state.resumeAt), state, "$ou : la reprise retrouve tout")
        attend(RESUME_COUNTDOWN_MS)
        assertEquals(reste, game.remainingMs(now), "$ou : le chrono repart après le décompte, là où il s'était arrêté")
        game.deadline()?.let { assertEquals(now + reste, it) }
    }
}

class PrestationsCompletesTest {

    @Test
    fun `quiz, mimes, image floue, statues puis Super Finale, étape par étape`() {
        val quiz = Quiz(
            "lea", "Les 8 ans de Léa",
            listOf(
                classique("q1", audioId = "comptine"), classique("q2"),
                mimes("m1"),
                flou("f1"),
                statues("s1"),
                classique("x1", "Super Finale", double = true), express("x2", 0, "Super Finale", double = true),
            ),
        )
        val b = Box(quiz)
        assertEquals(listOf(0, 2, 3, 4, 5), b.game.rounds)

        // Quiz (musical pour la première question) : Rose répond juste dès l'ouverture, Bleu se trompe.
        b.next()
        b.verifieOuverture(0)
        b.answer(ROSE, 1); b.answer(BLEU, 0)
        b.attend(5_000)
        b.next()
        assertEquals(Phase.CLOSED, b.state.phase)
        b.next()
        assertEquals(Phase.REVEAL, b.state.phase)
        assertEquals(scores(120, 0, 0), b.scores())
        b.next()
        assertEquals(Phase.SCORES, b.state.phase)
        b.next()
        b.verifieOuverture(1)
        // Deuxième question fermée par le chrono.
        b.answer(BLEU, 1)
        b.timeUp()
        assertEquals(Phase.CLOSED, b.state.phase)
        b.next(); b.next()
        assertEquals(scores(120, 120, 0), b.scores())

        // Fin du quiz : « Suivant » lance les mimes (l'incident de la prestation).
        b.next()
        b.verifieOuverture(2)
        b.mimeStart(ROSE); b.found(); b.pass(); b.found(); b.pass(); b.pass(); b.mimeStop()
        b.mimeStart(BLEU); b.found(); b.timeUp()
        b.mimeStart(VERT); b.found()
        assertNull(b.state.mime?.team, "paquet épuisé : le tour de Vert s'arrête seul")
        assertEquals(listOf(ROSE, BLEU, VERT), b.state.mime?.turns)
        assertEquals(scores(220, 170, 50), b.scores())
        b.next()
        assertEquals(Phase.SCORES, b.state.phase)

        // Image floue : Rose se trompe, Bleu trouve au rebond.
        b.next()
        b.verifieOuverture(3)
        b.buzz(ROSE); b.judge(false); b.buzz(BLEU); b.judge(true)
        assertEquals(Phase.REVEAL, b.state.phase)
        assertEquals(scores(220, 270, 50), b.scores())
        b.next(); b.next()

        // Statues musicales : chrono jusqu'au bout, puis Vert désignée gagnante.
        b.verifieOuverture(4)
        b.timeUp()
        b.statuesWin(VERT)
        assertEquals(scores(370, 420, 350), b.scores())
        b.next(); b.next()

        // Super Finale : question doublée, puis Vrai ou Faux express doublé qui s'enchaîne seul.
        b.verifieOuverture(5)
        b.answer(VERT, 1)
        b.next(); b.next()
        assertEquals(scores(370, 420, 590), b.scores())
        b.next(); b.next()
        b.verifieOuverture(6)
        b.answer(ROSE, 0); b.answer(BLEU, 1)
        b.timeUp()
        b.expressAuto()
        assertEquals(Phase.REVEAL, b.state.phase)
        b.expressAuto()
        assertEquals(Phase.SCORES, b.state.phase, "dernière affirmation : classement")
        b.next()
        assertEquals(Phase.ENDED, b.state.phase)
        assertEquals(scores(470, 420, 590), b.scores())
    }

    @Test
    fun `mimes en premier, puis Vrai ou Faux express, Juste Chiffre et quiz`() {
        val quiz = Quiz(
            "p2", "Mimes d'abord",
            listOf(mimes("m1"), express("e1", 0), express("e2", 1), justeChiffre("n1"), classique("c1", audioId = "comptine"), classique("c2")),
        )
        val b = Box(quiz)
        b.joueJusquAuBout()
        assertEquals(scores(rose = 100 + 50 + 50 + 100, bleu = 50, vert = 100 + 120 + 120), b.scores())
    }

    @Test
    fun `jeu au buzzer, mimes, express puis finale, avec double appui et box relancée après chaque événement`() {
        val quiz = Quiz(
            "p3", "Buzzer d'abord",
            listOf(
                chante("h1"), mimes("m1"), express("e1", 0), express("e2", 1),
                quiSuis("w1", "Super Finale", double = true), classique("x1", "Super Finale", double = true),
            ),
        )
        val b = Box(quiz).apply { doubleAppui = true; redemarreAChaqueEvenement = true }
        b.joueJusquAuBout()
        assertEquals(scores(rose = 100 + 50 + 50, bleu = 100 + 50 + 200, vert = 240), b.scores())
    }

    @Test
    fun `Qui a disparu au milieu de la prestation, avec pause et redémarrage pendant la mémorisation`() {
        val quiz = Quiz(
            "p4", "Qui a disparu au milieu",
            listOf(classique("c1"), classique("c2"), disparu("d1"), mimes("m1"), quiSuis("w1"), justeChiffre("n1")),
        )
        val b = Box(quiz)
        b.next()
        b.joueManche()
        b.next()
        b.verifieOuverture(2)
        assertEquals(false, Codec.publicState(b.game)["buzzOpen"])
        b.attend(5_000)
        assertNull(b.tryBuzz(ROSE), "trop tôt : pas de buzz")
        assertNull(b.box { it.armBuzz(b.now) }, "jamais avant la fin de la mémorisation")
        b.pause()
        b.attend(20_000)
        b.restart()
        b.resume()
        b.attend(RESUME_COUNTDOWN_MS)
        assertEquals(10_000, b.game.armDelayMs(b.now), "la pause et le redémarrage repoussent l'ouverture")
        b.restart()
        b.arm()
        b.buzz(VERT); b.judge(true)
        assertEquals(scores(0, 0, 240 + Scoring.BUZZ), b.scores())
        b.next()
        b.next()
        b.verifieOuverture(3)
        b.joueJusquAuBout()
        assertEquals(scores(rose = 100 + 100, bleu = 50 + 100, vert = 240 + 150 + 100), b.scores())
    }

    @Test
    fun `tous les jeux à la suite, avec un double appui sur chaque bouton`() {
        val b = Box(TOUS_LES_JEUX).apply { doubleAppui = true }
        b.joueJusquAuBout()
        assertEquals(scores(rose = 550, bleu = 900, vert = 1000), b.scores())
    }

    @Test
    fun `chaque jeu s'ouvre sur sa présentation et attend l'animatrice, double appui et box relancée après chaque événement`() {
        val b = Box(TOUS_LES_JEUX.copy(intros = true)).apply { doubleAppui = true; redemarreAChaqueEvenement = true }
        b.joueJusquAuBout()
        assertEquals(scores(rose = 550, bleu = 900, vert = 1000), b.scores(), "mêmes points qu'en jouant sans présentation")
    }

    @Test
    fun `présentation des jeux, pause et reprise à chaque étape`() {
        val b = Box(TOUS_LES_JEUX.copy(intros = true))
        var presentations = 0
        b.etape = { ou ->
            if (ou == "présentation") presentations++
            b.pauseVerifiee("${b.state.qid} $ou")
        }
        b.joueJusquAuBout()
        assertEquals(b.game.rounds.size, presentations, "une présentation par jeu")
        assertEquals(scores(rose = 550, bleu = 900, vert = 1000), b.scores())
    }

    @Test
    fun `pause et reprise à chaque étape de chaque jeu`() {
        val b = Box(TOUS_LES_JEUX)
        val vues = mutableSetOf<String>()
        b.etape = { ou ->
            vues += "${b.game.question?.kind?.code} $ou"
            b.pauseVerifiee("${b.state.qid} $ou")
        }
        b.joueJusquAuBout()
        assertEquals(scores(rose = 550, bleu = 900, vert = 1000), b.scores(), "les pauses ne changent aucun point")
        assertTrue(
            vues.containsAll(listOf("mime tour de mimes", "mime entre deux tours", "flou buzz en attente", "disparu mémorisation", "express fermée", "statues fermée", "classic classement")),
            "étapes vues : $vues",
        )
    }

    @Test
    fun `passer au jeu suivant depuis le milieu de chaque jeu, les points gagnés restent`() {
        val b = Box(TOUS_LES_JEUX)
        b.next()
        while (true) {
            val q = b.game.question!!
            when {
                q.isMime -> { b.mimeStart(ROSE); b.found() }
                q.isBlind -> { b.next(); b.buzz(ROSE) }
                q.isDisparu -> { b.arm(); b.buzz(ROSE) }
                q.isBuzz -> b.buzz(ROSE)
                q.isStatues -> b.attend(10_000)
                else -> b.answer(VERT, q.correct)
            }
            val gardes = b.scores()
            val suivant = b.game.rounds.firstOrNull { it > b.state.index } ?: break
            val saut = b.goto(suivant)
            assertEquals(emptyList(), saut.clear, "jeu jamais joué : rien n'est effacé")
            assertEquals(gardes, b.scores())
            b.verifieOuverture(suivant)
        }
        // Dernier jeu : la régie termine la prestation, puis rouvre la finale (fin demandée par erreur).
        b.end()
        assertEquals(scores(Scoring.MIME, 0, 0), b.scores())
        val finale = b.game.rounds.last()
        b.goto(finale)
        b.verifieOuverture(finale)
        b.joueJusquAuBout()
        assertEquals(scores(Scoring.MIME + 100, 0, 240), b.scores())
    }

    @Test
    fun `rejouer chaque jeu, depuis son classement ou en plein milieu, ne compte jamais deux fois`() {
        val b = Box(TOUS_LES_JEUX)
        b.next()
        while (b.state.phase != Phase.ENDED) {
            val debut = b.state.index
            val manche = b.game.roundOf(debut)
            val avant = b.scores()
            b.joueManche()
            val apres = b.scores()
            // Rejouer depuis le classement du jeu : ses points partent, les autres restent.
            val saut = b.goto(debut)
            assertEquals(manche.map { b.quiz.questions[it].id }, saut.clear)
            assertEquals(avant, b.scores(), "${saut.qid} rejoué : ses points sont retirés")
            b.verifieOuverture(debut)
            // Rejouer encore en plein milieu (première question jouée), puis le jeu entier.
            b.joue()
            b.goto(debut)
            assertEquals(avant, b.scores())
            b.joueManche()
            assertEquals(apres, b.scores(), "${saut.qid} rejoué en entier : mêmes points, jamais deux fois")
            b.next()
        }
        assertEquals(scores(rose = 550, bleu = 900, vert = 1000), b.scores())
    }

    @Test
    fun `retour à un jeu précédent, puis on repart en avant, points cohérents`() {
        val quiz = Quiz(
            "retour", "Retour en arrière",
            listOf(classique("c1"), classique("c2"), mimes("m1"), justeChiffre("n1"), zoom("z1"), classique("x1", "Super Finale", double = true)),
        )
        val b = Box(quiz)
        b.next()
        repeat(4) {
            b.joueManche()
            b.next()
        }
        // Premier passage : quiz, mimes, Juste Chiffre, zoom ; la finale vient de s'ouvrir.
        b.verifieOuverture(5)
        val p1 = scores(rose = 100 + 100, bleu = 50, vert = 240 + 100 + 120)
        assertEquals(p1, b.scores())

        // La régie revient au quiz : ses points seulement sont retirés, puis rejoués.
        val retour = b.goto(0)
        assertEquals(listOf("c1", "c2"), retour.clear)
        assertEquals(moins(p1, scores(0, 0, 240)), b.scores())
        b.joueManche()
        assertEquals(p1, b.scores())

        // Puis saute directement au Juste Chiffre (déjà joué au premier passage), sans repasser par les mimes.
        val enAvant = b.goto(3)
        assertEquals(listOf("n1"), enAvant.clear, "un jeu déjà joué plus loin repart de zéro : ses points et ses réponses sont effacés")
        assertEquals(moins(p1, scores(100, 0, 100)), b.scores())
        b.joueManche()
        assertEquals(p1, b.scores(), "Juste Chiffre rejoué : mêmes points, jamais deux fois")
        b.next()
        b.verifieOuverture(4)
        b.joueManche()
        assertEquals(p1, b.scores(), "zoom rouvert par « Suivant » : ses anciens points sont remplacés, pas ajoutés")

        // Encore en arrière : les mimes, rejoués autrement ; puis la finale.
        b.goto(2)
        assertEquals(moins(p1, scores(100, 50, 0)), b.scores())
        b.mimeStart(VERT); b.found(); b.mimeStop()
        b.next()
        val p2 = scores(rose = 100, bleu = 0, vert = 460 + Scoring.MIME)
        assertEquals(p2, b.scores())
        val finale = b.goto(5)
        assertEquals(listOf("x1"), finale.clear, "finale ouverte au premier passage : elle repart de zéro")
        b.joueJusquAuBout()
        assertEquals(plus(p2, scores(0, 0, 240)), b.scores())
    }

    @Test
    fun `commandes en double, en retard ou rejouées après un redémarrage`() {
        val b = Box(TOUS_LES_JEUX)
        b.next()
        val perime = b.state.lastSeq - 1
        val avant = b.log.size
        listOf(
            Command.Next("a", perime), Command.Close("b", perime), Command.End("c", perime), Command.MimeStart("d", perime, ROSE),
            Command.MimeFound("e", perime), Command.MimePass("f", perime), Command.MimeStop("g", perime),
            Command.Goto("h", perime, 6, "m1"), Command.Judge("i", perime, true), Command.StatuesWin("j", perime, VERT),
        ).forEach { assertEquals(CommandStatus.STALE, b.send(it).status, "$it en retard : rien ne bouge") }
        assertEquals(avant, b.log.size)
        assertEquals("c1", b.state.qid)

        // Une correction livrée deux fois (Firebase rejoue la commande à la reconnexion) ne compte qu'une fois,
        // même après un redémarrage de la box (les statuts déjà écrits sont relus).
        val bonus = Command.Adjust("adj", b.state.lastSeq, ROSE, 10)
        assertEquals(CommandStatus.APPLIED, b.send(bonus).status)
        assertEquals(CommandStatus.APPLIED, b.send(bonus).status)
        b.restart()
        b.send(bonus)
        assertEquals(scores(10, 0, 0), b.scores())

        // « Suivant » livré deux fois, avant et après un redémarrage : une seule étape.
        val suivant = Command.Next("suivant", b.state.lastSeq)
        b.send(suivant)
        assertEquals(Phase.CLOSED, b.state.phase)
        b.restart()
        b.send(suivant)
        assertEquals(Phase.CLOSED, b.state.phase)
        // Sans le registre de la box, le moteur seul la refuse aussi : la partie a déjà avancé.
        assertEquals(CommandStatus.STALE, b.game.execute(suivant, b.now, EQUIPES).status)

        // Deux téléphones envoient « Jeu suivant » en même temps : un seul saut.
        val seq = b.state.lastSeq
        assertEquals(CommandStatus.APPLIED, b.send(Command.Goto("tel1", seq, 2, "n1")).status)
        assertEquals(CommandStatus.STALE, b.send(Command.Goto("tel2", seq, 2, "n1")).status)
        assertEquals("n1", b.state.qid)
        // Programme modifié entre-temps : le saut est refusé, la partie ne bouge pas.
        assertEquals("stale_program", b.send(Command.Goto("vieux", b.state.lastSeq, 3, "n1")).reason)
        assertEquals("n1", b.state.qid)
        assertEquals(scores(10, 0, 0), b.scores())
    }

    @Test
    fun `fin du chrono en même temps qu'une commande de la régie, dans les deux ordres`() {
        val quiz = Quiz(
            "course", "Courses",
            listOf(classique("c1"), mimes("m1"), flou("f1"), express("e1", 0), express("e2", 1), statues("s1"), disparu("d1"), classique("c2", "Fin")),
        )
        val b = Box(quiz)
        b.next()

        // Quiz : le chrono ferme la question pendant que la régie appuie sur « Arrêter le chrono ».
        b.answer(VERT, 1)
        val vue = b.state.lastSeq
        b.timeUp()
        assertEquals(CommandStatus.STALE, b.send(Command.Next("tard", vue)).status, "l'appui en retard ne révèle pas à la place de l'animatrice")
        assertEquals(Phase.CLOSED, b.state.phase)
        b.next()
        assertEquals(scores(0, 0, 120), b.scores())
        // Dans l'autre ordre : la régie révèle, la minuterie qui attendait le verrou ne fait plus rien.
        b.next(); b.next()

        // Mimes : « Trouvé » arrivé après la fin du tour ne compte pas.
        b.mimeStart(ROSE); b.found()
        val vu = b.state.lastSeq
        b.timeUp()
        assertEquals(CommandStatus.STALE, b.send(Command.MimeFound("tard", vu)).status)
        assertEquals(1, b.state.mimes["m1"]?.get(ROSE))
        // « Trouvé » juste avant la fin : compté, puis la minuterie termine le tour.
        b.mimeStart(BLEU)
        val tour = b.minuterie()
        b.found()
        assertNotNull(tour.fire())
        assertNull(b.state.mime?.team)
        assertEquals(scores(50, 50, 120), b.scores())
        b.next(); b.next()

        // Image floue : un buzz à une seconde de la fin ; la minuterie déjà lancée ne ferme rien pendant la réponse.
        val image = b.minuterie()
        b.attend(29_000)
        b.buzz(ROSE)
        assertNull(image.fire(), "une équipe a buzzé : la question reste ouverte")
        assertEquals(Phase.QUESTION, b.state.phase)
        b.judge(false)
        assertEquals(1_000, b.game.remainingMs(b.now), "le chrono repart avec la seconde qui restait")
        val vu2 = b.state.lastSeq
        b.timeUp()
        assertEquals(CommandStatus.STALE, b.send(Command.Judge("tard", vu2, true)).status, "verdict arrivé après la fin du chrono")
        b.next()
        assertEquals(scores(50, 50, 120), b.scores(), "personne n'a trouvé l'image")
        b.next(); b.next()

        // Vrai ou Faux express : la régie révèle avant l'étape automatique, qui est oubliée.
        b.answer(ROSE, 0)
        b.timeUp()
        val auto = b.etapeExpress()
        b.next()
        assertNull(auto.fire())
        assertEquals(scores(100, 50, 120), b.scores())
        // L'étape automatique passe avant le « Suivant » de la régie, qui ne saute pas l'affirmation suivante.
        val vu3 = b.state.lastSeq
        assertNotNull(b.etapeExpress().fire())
        assertEquals(CommandStatus.STALE, b.send(Command.Next("tard", vu3)).status)
        assertEquals("e2", b.state.qid)
        assertEquals(Phase.QUESTION, b.state.phase)
        b.next()
        b.expressAuto(); b.expressAuto()
        assertEquals(Phase.SCORES, b.state.phase)
        b.next()

        // Statues : la gagnante désignée avant la fin du chrono ; la minuterie ne referme rien.
        val musique = b.minuterie()
        b.attend(60_000)
        b.statuesWin(VERT)
        assertNull(musique.fire())
        assertEquals(scores(250, 200, 420), b.scores())
        b.next(); b.next()

        // Qui a disparu ? : la pause arrive juste avant l'ouverture du buzzer, qui attend la reprise.
        b.attend(14_900)
        b.pause()
        assertNull(b.box { it.armBuzz(b.now + 1_000) })
        b.resume()
        // Réveil de la minuterie de la box 100 ms plus tard, en plein décompte 3, 2, 1 : le chrono n'a pas
        // repris, la mémorisation n'est pas finie, le buzzer reste fermé.
        b.attend(100)
        assertNull(b.box { it.armBuzz(b.now) }, "pas de buzzer pendant le décompte de la reprise")
        b.arm()
        assertTrue(b.now >= b.state.resumeAt!! + 100, "buzzer ouvert après le décompte et la fin de la mémorisation")
        // Saut de la régie contre la fin du chrono : la fin passe d'abord, le saut vu avant est refusé puis renvoyé.
        val vu4 = b.state.lastSeq
        b.timeUp()
        assertEquals(CommandStatus.STALE, b.send(Command.Goto("tard", vu4, 7, "c2")).status)
        b.goto(7)
        // Dans l'autre ordre : la minuterie de la question précédente se réveille sur la nouvelle question.
        b.verifieOuverture(7)
        assertNull(b.Minuterie(b.now - 1).fire(), "ancienne minuterie : la nouvelle question n'est pas fermée")
        assertEquals(Phase.QUESTION, b.state.phase)
        b.joueJusquAuBout()
        assertEquals(scores(250, 200, 540), b.scores())
    }

    @Test
    fun `box redémarrée après la fin d'un tour de mimes, la fin du chrono termine le tour`() {
        val b = Box(Quiz("redemarrage", "Redémarrage", listOf(mimes("m1"), classique("c1", "Fin"))))
        b.next()
        b.mimeStart(ROSE); b.found()
        // La box est éteinte pendant que le chrono du tour s'écoule, puis relit le journal.
        b.attend(70_000)
        b.restart()
        assertEquals(0L, b.game.remainingMs(b.now))
        assertEquals(ROSE, b.state.mime?.team)
        // Ce que GameViewModel.recover() appelle aujourd'hui : sans effet sur un tour de mimes.
        assertNull(b.game.close(b.now), "close() ne termine pas un tour de mimes : la reprise doit appeler timeUp()")
        // timeUp(), celui de la minuterie, termine bien le tour ; la manche continue.
        assertNotNull(b.box { it.timeUp(b.now) })
        assertNull(b.state.mime?.team)
        b.mimeStart(BLEU); b.found(); b.timeUp()
        b.next(); b.next()
        assertEquals(scores(50, 50, 0), b.scores())
        assertEquals("c1", b.state.qid)
    }
}
