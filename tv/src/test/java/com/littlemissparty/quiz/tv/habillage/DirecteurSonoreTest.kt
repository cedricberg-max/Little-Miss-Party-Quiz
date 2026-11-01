package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Les sons d'une partie : jamais en double, jamais pendant une pause, jamais de générique en pleine partie. */
class DirecteurSonoreTest {

    private val salon = Instant(Ecran.SALON, partie = "ABCD", equipes = 0)
    private val q1 = Instant(Ecran.QUESTION, partie = "ABCD", index = 0, equipes = 2, premiere = true)
    private val q2 = q1.copy(index = 1, premiere = false)

    private fun List<Ordre>.sons() = filterIsInstance<Ordre.Jouer>().map { it.son }
    private fun List<Ordre>.musique() = filterIsInstance<Ordre.Musique>().lastOrNull()?.ambiance

    @Test
    fun `le generique se joue une seule fois par partie, puis la musique du salon`() {
        val d = DirecteurSonore()
        val o = d.observer(salon)
        assertEquals(listOf(Son.GENERIQUE), o.sons())
        assertEquals(Ambiance.SALON, o.musique())
        // Pas de blanc entre le générique et le salon : la boucle repart de sa première mesure sur le temps fort
        // qui suit la dernière note (16 temps), presque aussi fort, puis redescend en douceur.
        assertTrue(Ordre.Caler(Tempo.GENERIQUE_RELAIS) in o)
        val musiques = o.filterIsInstance<Ordre.Musique>()
        val relais = musiques.first { it.ambiance == Ambiance.SALON_ARRIVEE }
        assertEquals(Tempo.GENERIQUE_RELAIS, relais.dansMs)
        assertEquals(16 * Tempo.TEMPS, relais.dansMs)
        assertTrue(relais.fonduMs <= 200)
        assertTrue(musiques.last().dansMs > relais.dansMs && musiques.last().fonduMs >= 2_000)
        assertTrue(d.observer(salon).isEmpty())
        // La box perd la partie puis la retrouve : pas de second générique.
        d.observer(Instant(Ecran.HORS_PARTIE))
        val retour = d.observer(salon)
        assertFalse(Son.GENERIQUE in retour.sons())
        assertEquals(Ambiance.SALON, retour.musique())
    }

    @Test
    fun `une box qui redemarre en pleine partie reprend la musique sans generique`() {
        val o = DirecteurSonore().observer(q2.copy(reponses = 1))
        assertEquals(listOf(Ordre.Musique(Ambiance.QUESTION)), o)
    }

    @Test
    fun `une nouvelle partie rejoue le generique`() {
        val d = DirecteurSonore()
        d.observer(salon)
        d.observer(Instant(Ecran.FIN, partie = "ABCD", index = 10))
        assertTrue(Son.GENERIQUE in d.observer(salon.copy(partie = "WXYZ")).sons())
    }

    @Test
    fun `Game Show, l'accueil part directement sur la boucle de Get Lucky, sans generique, meme pour une nouvelle partie`() {
        val d = DirecteurSonore()
        val accueil = salon.copy(gameShow = true)
        val o = d.observer(accueil)
        assertTrue(o.sons().isEmpty())
        assertEquals(Ambiance.SALON, o.musique())
        assertEquals(0.49f, Ambiance.SALON.volume(Lit.ACCUEIL, gs = true))
        assertEquals(0f, Ambiance.SALON.volume(Lit.COMPLET, gs = true))
        // Classique : la boucle de Get Lucky n'existe pas.
        assertEquals(0f, Ambiance.SALON.volume(Lit.ACCUEIL, gs = false))
        assertNull(Lit.ACCUEIL.fichierPour(false))
        assertEquals("gs_accueil", Lit.ACCUEIL.fichierPour(true))
        // « Fin de la fête » puis nouvelle partie : toujours Get Lucky, jamais le générique.
        d.observer(Instant(Ecran.FIN, partie = "ABCD", index = 10, gameShow = true))
        val nouvelle = d.observer(accueil.copy(partie = "WXYZ"))
        assertFalse(Son.GENERIQUE in nouvelle.sons())
        assertEquals(Ambiance.SALON, nouvelle.musique())
    }

    @Test
    fun `Game Show, intro du lancement, silence pendant la video puis la presentation du premier jeu entre`() {
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        val presentation = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 0, equipes = 2, epreuve = "quiz|Quiz", gameShow = true)
        val debut = d.observer(presentation.copy(lancement = true))
        assertEquals(listOf(Ordre.Couper, Ordre.Musique(Ambiance.SILENCE)), debut)
        // Rien ne passe par-dessus la vidéo : ni équipe, ni buzzer.
        assertTrue(d.observer(presentation.copy(lancement = true, buzzeur = 0, buzzs = 1)).isEmpty())
        val fin = d.observer(presentation)
        assertEquals(Ambiance.PRESENTATION, fin.musique())
        assertFalse(Son.TRANSITION in fin.sons())
        assertTrue(d.observer(presentation).isEmpty())
        // Sarah lance l'épreuve : le jingle de manche, comme d'habitude.
        assertTrue(Son.MANCHE in d.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = 0, equipes = 2, epreuve = "quiz|Quiz", gameShow = true)).sons())
    }

    @Test
    fun `Game Show, la fete lancee depuis l'accueil compte comme intro des la premiere image, sans jingle de rideau`() {
        // Cedric, 25/10 : un écran noir et le jingle du rideau passaient avant le réveil du robot. Dès la première image de
        // la présentation, l'intro est « en vue » : la bande-son se tait au lieu de jouer la transition.
        assertTrue(lancementEnVue(gameShow = true, phase = Phase.QUESTION, presentation = true, enPause = false, introAttendue = true))
        assertFalse(lancementEnVue(gameShow = false, phase = Phase.QUESTION, presentation = true, enPause = false, introAttendue = true))
        assertFalse(lancementEnVue(gameShow = true, phase = Phase.QUESTION, presentation = true, enPause = false, introAttendue = false))
        assertFalse(lancementEnVue(gameShow = true, phase = Phase.QUESTION, presentation = false, enPause = false, introAttendue = true))
        assertFalse(lancementEnVue(gameShow = true, phase = Phase.QUESTION, presentation = true, enPause = true, introAttendue = true))
        assertFalse(lancementEnVue(gameShow = true, phase = Phase.LOBBY, presentation = false, enPause = false, introAttendue = true))
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        val premiere = d.observer(Instant(Ecran.PRESENTATION, partie = "ABCD", index = 0, equipes = 2, epreuve = "quiz|Quiz", gameShow = true, lancement = true))
        assertFalse(Son.TRANSITION in premiere.sons())
        assertEquals(Ambiance.SILENCE, premiere.musique())
    }

    @Test
    fun `Game Show, intro du lancement coupee par l'epreuve lancee, la question entre avec sa musique`() {
        val presentation = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 0, equipes = 2, epreuve = "quiz|Quiz", gameShow = true)
        val question = Instant(Ecran.QUESTION, partie = "ABCD", index = 0, equipes = 2, epreuve = "quiz|Quiz", gameShow = true)
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        d.observer(presentation.copy(lancement = true))
        val q = d.observer(question)
        // Exactement comme une question lancée après une présentation sans intro.
        val habituelle = DirecteurSonore().run {
            observer(salon.copy(gameShow = true, equipes = 2))
            observer(presentation)
            observer(question)
        }
        assertEquals(habituelle, q)
        assertEquals(listOf(Son.MANCHE, Son.IMPACT), q.sons().take(2))
        assertEquals(Ambiance.QUESTION, q.musique())
    }

    @Test
    fun `le son d'arrivee d'une equipe seulement quand une equipe arrive`() {
        val d = DirecteurSonore()
        d.observer(salon)
        assertEquals(listOf(Son.EQUIPE_1), d.observer(salon.copy(equipes = 1)).sons())
        assertEquals(listOf(Son.EQUIPE_2), d.observer(salon.copy(equipes = 2)).sons())
        assertTrue(d.observer(salon.copy(equipes = 2)).isEmpty())
        assertTrue(d.observer(salon.copy(equipes = 1)).isEmpty())
    }

    @Test
    fun `premiere question annoncee, les suivantes enchainees, une bulle par proposition`() {
        val d = DirecteurSonore()
        d.observer(salon)
        val premiere = d.observer(q1)
        assertEquals(Ordre.Couper, premiere.first())
        assertTrue(Son.MANCHE in premiere.sons())
        assertEquals(4, premiere.sons().count { it.name.startsWith("POP") })
        assertEquals(Ambiance.QUESTION, premiere.musique())
        val suivante = d.observer(q2.copy(propositions = 2))
        assertFalse(Son.MANCHE in suivante.sons())
        assertTrue(Son.WHOOSH in suivante.sons())
        assertEquals(2, suivante.sons().count { it.name.startsWith("POP") })
    }

    @Test
    fun `les dernieres questions a points doubles ne sonnent pas comme un nouveau jeu`() {
        val d = DirecteurSonore()
        d.observer(salon)
        d.observer(q1)
        d.observer(q2)
        // Passage aux points ×2 : un éclat « points doublés », une seule fois, sans jingle de manche ni transition.
        val basculeOrdres = d.observer(q2.copy(index = 8, superFinale = true))
        val bascule = basculeOrdres.sons()
        assertTrue(Son.BT_DOUBLE in bascule)
        // La musique devient un peu plus pressante pendant ces questions.
        assertEquals(Ambiance.DECISIVE, basculeOrdres.musique())
        assertFalse(Son.MANCHE in bascule || Son.TRANSITION in bascule)
        // Les questions ×2 suivantes s'enchaînent comme les autres.
        val suivante = d.observer(q2.copy(index = 9, superFinale = true)).sons()
        assertTrue(Son.WHOOSH in suivante)
        assertFalse(Son.BT_DOUBLE in suivante || Son.MANCHE in suivante)
    }

    @Test
    fun `Game Show, la super finale garde la musique de la manche, sans blanc`() {
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true))
        d.observer(q1.copy(gameShow = true))
        d.observer(q2.copy(gameShow = true))
        val bascule = d.observer(q2.copy(index = 8, superFinale = true, gameShow = true))
        // Un impact, jamais les cuivres du Classique par-dessus Daft Punk (cedric, 25/10 au soir : deux musiques).
        assertTrue(Son.IMPACT in bascule.sons())
        assertFalse(Son.BT_DOUBLE in bascule.sons())
        assertEquals(listOf(Ambiance.DECISIVE), bascule.filterIsInstance<Ordre.Musique>().map { it.ambiance })
    }

    @Test
    fun `Game Show, annonce x N (choix C du 31-10), roulement qui monte puis le boum pile sur x N, la musique repart avec lui`() {
        // Le même pour ×2, ×3, ×4 et ×5 : le chiffre ne change pas les sons de l'annonce.
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true))
        d.observer(q2.copy(gameShow = true, propositions = 4))
        val o = d.observer(q2.copy(index = 8, superFinale = true, annonceFacteur = true, gameShow = true, propositions = 4))
        val jouer = o.filterIsInstance<Ordre.Jouer>()
        assertTrue(Ordre.Jouer(Son.ROULEMENT_LONG) in o && Ordre.Jouer(Son.MONTEE) in o)
        assertEquals(Tempo.ANNONCE_FACTEUR_BOUM, jouer.single { it.son == Son.IMPACT }.dansMs)
        // Rien d'autre pendant l'annonce : ni bulles (les propositions sont cachées dessous), ni cuivres.
        assertFalse(jouer.any { it.son == Son.BT_DOUBLE || it.son.name.startsWith("POP") })
        val musiques = o.filterIsInstance<Ordre.Musique>()
        assertEquals(Ambiance.SILENCE, musiques.first().ambiance)
        assertEquals(Ordre.Musique(Ambiance.DECISIVE, Tempo.ANNONCE_FACTEUR_BOUM), musiques.last())
        // Zoom : la photo et sa montée attendent la fin de l'annonce ; quiz musical : le boum aussi, le disque après.
        val dz = DirecteurSonore()
        dz.observer(q2.copy(gameShow = true))
        val zoom = dz.observer(q2.copy(index = 8, superFinale = true, annonceFacteur = true, gameShow = true, zoom = true, chronoMs = 20_000))
        assertEquals(Tempo.PROPOSITIONS_DEBUT + ANNONCE_MULTIPLICATEUR_MS, zoom.filterIsInstance<Ordre.Jouer>().single { it.son == Son.FLOU_MONTEE }.dansMs)
        val d2 = DirecteurSonore()
        d2.observer(q2.copy(gameShow = true))
        val musical = d2.observer(q2.copy(index = 8, superFinale = true, annonceFacteur = true, gameShow = true, musical = true, quizMusical = true))
        assertEquals(Tempo.ANNONCE_FACTEUR_BOUM, musical.filterIsInstance<Ordre.Jouer>().single { it.son == Son.IMPACT }.dansMs)
        assertEquals(ANNONCE_MULTIPLICATEUR_MS, musical.filterIsInstance<Ordre.Jouer>().single { it.son == Son.BT_DIAMANT }.dansMs)
        // Jeux au buzzer (pas d'annonce plein écran) : l'impact d'avant, tout de suite.
        val d3 = DirecteurSonore()
        d3.observer(q2.copy(gameShow = true))
        val buzz = d3.observer(q2.copy(index = 8, superFinale = true, gameShow = true, jeuBuzz = true))
        assertEquals(0L, buzz.filterIsInstance<Ordre.Jouer>().single { it.son == Son.IMPACT }.dansMs)
    }

    @Test
    fun `Game Show, le classement en cours de partie n'a que sa musique, sans compteur ni couronne du Classique`() {
        val d = DirecteurSonore()
        d.observer(q2.copy(gameShow = true))
        val ordres = d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 2, meneurAPoints = true, gameShow = true))
        assertFalse(Son.COMPTEUR in ordres.sons() || Son.COURONNE in ordres.sons())
        assertEquals(Ambiance.BILAN, ordres.musique())
    }

    @Test
    fun `Game Show, Qui suis-je sur la musique des mimes, en retrait, silence quand une equipe a buzze`() {
        val d = DirecteurSonore()
        val qui = q2.copy(jeuBuzz = true, quiSuis = true, gameShow = true)
        d.observer(salon.copy(gameShow = true))
        assertEquals(Ambiance.MIMES_ENTRE, d.observer(qui).musique())
        assertEquals(Ambiance.PAROLE, d.observer(qui.copy(buzzEquipe = 0)).musique())
        // Look Classique : rien ne change.
        assertEquals(Ambiance.SUSPENSE, DirecteurSonore().apply { observer(salon) }.observer(qui.copy(gameShow = false)).musique())
    }

    @Test
    fun `un tic par reponse recue, rien si rien ne change`() {
        val d = DirecteurSonore()
        d.observer(q2)
        assertEquals(listOf(Son.REPONSE), d.observer(q2.copy(reponses = 1)).sons())
        assertTrue(d.observer(q2.copy(reponses = 1)).isEmpty())
    }

    @Test
    fun `la tension des 5 dernieres secondes ne part qu'une fois et s'arrete quand tout le monde a repondu`() {
        val d = DirecteurSonore()
        d.observer(q2)
        assertEquals(listOf(Son.TENSION), d.observer(q2.copy(urgent = true)).sons())
        assertTrue(d.observer(q2.copy(urgent = true)).isEmpty())
        val o = d.observer(q2.copy(urgent = true, reponses = 2))
        assertTrue(Ordre.Arreter(Son.TENSION) in o)
        assertTrue(d.observer(q2.copy(urgent = true, reponses = 2)).isEmpty())
    }

    @Test
    fun `pas de tension si tout le monde a deja repondu`() {
        val d = DirecteurSonore()
        d.observer(q2.copy(reponses = 2))
        assertTrue(d.observer(q2.copy(reponses = 2, urgent = true)).sons().isEmpty())
    }

    @Test
    fun `la pause coupe tout, carillon puis musique d'intermede, et la reprise compte 3 2 1`() {
        val d = DirecteurSonore()
        d.observer(q2.copy(urgent = true))
        val pause = d.observer(q2.copy(enPause = true))
        assertEquals(Ordre.Couper, pause.first())
        assertEquals(listOf(Son.PAUSE), pause.sons())
        assertEquals(Ordre.Musique(Ambiance.INTERMEDE, Tempo.PAUSE_MUSIQUE), pause.last())
        // Une réponse ou une équipe pendant la pause ne fait aucun bruit.
        assertTrue(d.observer(q2.copy(enPause = true, reponses = 1, equipes = 3)).isEmpty())
        val reprise = d.observer(q2.copy(reponses = 1, equipes = 3, repriseDansMs = 3_000))
        val pops = reprise.filterIsInstance<Ordre.Jouer>().filter { it.son.name.startsWith("POP") }
        assertEquals(listOf(0L, 1_000L, 2_000L), pops.map { it.dansMs })
        assertTrue(Ordre.Jouer(Son.WHOOSH, 3_000) in reprise)
        assertEquals(Ordre.Musique(Ambiance.QUESTION, 3_000), reprise.last())
        // Un seul Couper, en tête : il fait taire le carillon et annule la musique d'intermède encore prévue.
        assertEquals(Ordre.Couper, reprise.first())
        assertEquals(1, reprise.count { it == Ordre.Couper })
    }

    @Test
    fun `une box qui se reconnecte pendant la pause remet la musique d'intermede, sans carillon`() {
        assertEquals(listOf(Ordre.Musique(Ambiance.INTERMEDE)), DirecteurSonore().observer(q2.copy(enPause = true)))
    }

    @Test
    fun `si l'ecran a change pendant la pause, son entree est jouee apres le decompte`() {
        val d = DirecteurSonore()
        d.observer(q2)
        d.observer(q2.copy(enPause = true))
        val reprise = d.observer(Instant(Ecran.VERROUILLEE, partie = "ABCD", index = 1, equipes = 2, repriseDansMs = 3_000))
        assertTrue(Ordre.Jouer(Son.VERROU, 3_000) in reprise)
        assertEquals(Ambiance.SUSPENSE, reprise.musique())
    }

    @Test
    fun `revelation dans l'ordre et en rythme`() {
        val d = DirecteurSonore()
        d.observer(Instant(Ecran.VERROUILLEE, partie = "ABCD", index = 1, equipes = 3))
        val o = d.observer(Instant(Ecran.REVELATION, partie = "ABCD", index = 1, equipes = 3, gagnants = 2))
        val jouer = o.filterIsInstance<Ordre.Jouer>()
        assertEquals(3, jouer.count { it.son == Son.ETEINT })
        assertEquals(2, jouer.count { it.son == Son.TAMPON })
        assertEquals(Tempo.REVELATION_OR, jouer.single { it.son == Son.BONNE_REPONSE }.dansMs)
        assertTrue(jouer.filter { it.son == Son.ETEINT }.all { it.dansMs < Tempo.REVELATION_OR })
        assertTrue(jouer.filter { it.son == Son.TAMPON }.all { it.dansMs > Tempo.REVELATION_OR })
        assertTrue(Son.POINTS in o.sons())
        // Personne n'a marqué : ni tampon ni points.
        val d2 = DirecteurSonore()
        d2.observer(Instant(Ecran.VERROUILLEE, partie = "ABCD", index = 1))
        val vide = d2.observer(Instant(Ecran.REVELATION, partie = "ABCD", index = 1, gagnants = 0)).sons()
        assertFalse(Son.TAMPON in vide || Son.POINTS in vide)
    }

    @Test
    fun `classement avec couronne seulement si le premier a des points`() {
        val d = DirecteurSonore()
        d.observer(q2)
        assertFalse(Son.COURONNE in d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 1)).sons())
        d.observer(q2.copy(index = 2))
        assertTrue(Son.COURONNE in d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 2, meneurAPoints = true)).sons())
    }

    @Test
    fun `la victoire finale une seule fois`() {
        val d = DirecteurSonore()
        d.observer(q2)
        val fin = Instant(Ecran.FIN, partie = "ABCD", index = 1)
        val o = d.observer(fin)
        assertEquals(1, o.sons().count { it == Son.FANFARE })
        assertTrue(Son.FIN in o.sons())
        assertTrue(d.observer(fin).isEmpty())
    }

    @Test
    fun `buzzer de l'accueil, chaque appui fait sonner l'equipe, jamais deux fois le meme appui`() {
        val d = DirecteurSonore()
        val salon = Instant(Ecran.SALON, partie = "ABCD", equipes = 2)
        d.observer(salon)
        assertEquals(listOf(Son.RIGOLO_2), d.observer(salon.copy(buzzeur = 1, buzzs = 1)).sons())
        assertTrue(d.observer(salon.copy(buzzeur = 1, buzzs = 1)).isEmpty())
        assertEquals(listOf(Son.RIGOLO_1), d.observer(salon.copy(buzzeur = 0, buzzs = 2)).sons())
        assertEquals(listOf(Son.RIGOLO_1), d.observer(salon.copy(buzzeur = 0, buzzs = 3)).sons())
    }

    @Test
    fun `Game Show, buzzer de l'accueil, chaque appui fait le mot robot de l'equipe, jamais l'ancien buzzer`() {
        val d = DirecteurSonore()
        val salon = Instant(Ecran.SALON, partie = "ABCD", equipes = 6, gameShow = true)
        d.observer(salon)
        assertEquals(listOf(Son.EQUIPE_2), d.observer(salon.copy(buzzeur = 1, buzzs = 1)).sons())
        assertEquals(listOf(Son.EQUIPE_2), d.observer(salon.copy(buzzeur = 1, buzzs = 2)).sons())
        assertEquals(listOf(Son.EQUIPE_6), d.observer(salon.copy(buzzeur = 5, buzzs = 3)).sons())
        assertTrue(d.observer(salon.copy(buzzeur = 5, buzzs = 3)).isEmpty())
    }

    private val mimes = Instant(Ecran.MIMES, partie = "ABCD", index = 3, equipes = 2)
    private val tour = mimes.copy(ecran = Ecran.MIMES_TOUR)

    @Test
    fun `manche de mimes annoncee, top depart, puis un son par mime trouve ou passe`() {
        val d = DirecteurSonore()
        d.observer(q2)
        val ouverture = d.observer(mimes)
        assertEquals(listOf(Son.MANCHE, Son.IMPACT), ouverture.sons())
        assertEquals(Ambiance.MIMES_ENTRE, ouverture.musique())
        val top = d.observer(tour)
        assertEquals(listOf(Son.MIME_TOP), top.sons())
        assertEquals(Ordre.Musique(Ambiance.MIMES, Tempo.MIME_TOP_IMPACT), top.filterIsInstance<Ordre.Musique>().last())
        // Trouvé, puis le souffle du « Changement de joueur ! » (roulement des mimes, cedric 24/10).
        val trouve = d.observer(tour.copy(trouves = 1))
        assertEquals(listOf(Son.MIME_TROUVE, Son.WHOOSH), trouve.sons())
        assertEquals(Ordre.Jouer(Son.WHOOSH, Tempo.MIME_RELAIS), trouve.filterIsInstance<Ordre.Jouer>().last())
        assertTrue("La musique du tour ne change pas", trouve.filterIsInstance<Ordre.Musique>().isEmpty())
        assertEquals(listOf(Son.MIME_PASSE), d.observer(tour.copy(trouves = 1, passes = 1)).sons())
        // La même carte montrée deux fois (reconnexion de la régie, rafraîchissement) ne rejoue rien.
        assertTrue(d.observer(tour.copy(trouves = 1, passes = 1)).isEmpty())
    }

    @Test
    fun `mimes en file, passer fait tourner les joueurs et l'image suivante fait pop`() {
        val d = DirecteurSonore()
        d.observer(tour)
        // « ⏭ Passer » (cedric, 26/10) : le son du passage, puis le souffle qui fait tourner les joueurs.
        val passe = d.observer(tour.copy(passes = 1, onTourne = true))
        assertEquals(listOf(Son.MIME_PASSE, Son.WHOOSH), passe.sons())
        assertTrue("La musique du tour ne change pas", passe.filterIsInstance<Ordre.Musique>().isEmpty())
        // Sarah montre l'image suivante : un seul petit pop.
        val image = d.observer(tour.copy(passes = 1))
        assertEquals(1, image.sons().size)
        assertTrue(image.sons().single().name.startsWith("POP"))
        // Trouvé : le son du mime trouvé et le même souffle, puis le pop de l'image suivante.
        assertEquals(listOf(Son.MIME_TROUVE, Son.WHOOSH), d.observer(tour.copy(trouves = 1, passes = 1, onTourne = true)).sons())
        assertTrue(d.observer(tour.copy(trouves = 1, passes = 1)).sons().single().name.startsWith("POP"))
    }

    @Test
    fun `tension des 10 dernieres secondes une seule fois, coupee par la fin du tour`() {
        val d = DirecteurSonore()
        d.observer(tour)
        val tension = d.observer(tour.copy(urgent = true))
        assertEquals(listOf(Son.MIME_TENSION), tension.sons())
        // La boucle des mimes, qui monte, ne s'arrête jamais pendant le tour (cedric, 26/10).
        assertTrue(tension.filterIsInstance<Ordre.Musique>().isEmpty())
        assertTrue(d.observer(tour.copy(urgent = true)).isEmpty())
        val fin = d.observer(mimes.copy(urgent = false))
        assertEquals(Ordre.Couper, fin.first())
        assertEquals(Son.MIME_FIN, fin.sons().first())
    }

    @Test
    fun `fin de tour applaudie seulement si l'equipe a trouve`() {
        val d = DirecteurSonore()
        d.observer(tour.copy(trouves = 2))
        assertTrue(Son.APPLAUDISSEMENTS in d.observer(mimes).sons())
        d.observer(tour)
        val rate = d.observer(mimes)
        assertEquals(listOf(Son.MIME_FIN), rate.sons())
        assertEquals(Ambiance.MIMES_ENTRE, rate.musique())
    }

    @Test
    fun `pause pendant un tour de mimes puis reprise sur la musique du tour`() {
        val d = DirecteurSonore()
        d.observer(tour.copy(trouves = 1))
        assertEquals(listOf(Son.PAUSE), d.observer(tour.copy(trouves = 1, enPause = true)).sons())
        val reprise = d.observer(tour.copy(trouves = 1, repriseDansMs = 3_000))
        assertFalse(Son.MIME_TROUVE in reprise.sons())
        assertEquals(Ordre.Musique(Ambiance.MIMES, 3_000), reprise.filterIsInstance<Ordre.Musique>().last())
    }

    private val dessin = tour.copy(pictionary = true)
    private val entreDessins = mimes.copy(pictionary = true)

    @Test
    fun `pictionary - top depart au crayon, trouve une seule fois, sifflet si le temps s'ecoule`() {
        val d = DirecteurSonore()
        d.observer(entreDessins)
        assertEquals(listOf(Son.PICTIO_TOP), d.observer(dessin).sons())
        // La régie valide « Trouvé ! » et finit le tour d'un coup : le « Trouvé ! » sonne à la fin du tour.
        val fin = d.observer(entreDessins.copy(pictioTrouve = true))
        assertEquals(listOf(Son.PICTIO_TROUVE, Son.APPLAUDISSEMENTS), fin.sons())
        assertTrue(d.observer(entreDessins.copy(pictioTrouve = true)).isEmpty())
        // Trouvé pendant le tour, puis fin du tour : pas de second « Trouvé ! ».
        d.observer(dessin)
        assertEquals(listOf(Son.PICTIO_TROUVE), d.observer(dessin.copy(trouves = 1)).sons())
        assertEquals(listOf(Son.APPLAUDISSEMENTS), d.observer(entreDessins.copy(pictioTrouve = true)).sons())
        // Temps écoulé : le sifflet, ni « Trouvé ! » ni applaudissements.
        d.observer(dessin)
        val rate = d.observer(entreDessins)
        assertEquals(listOf(Son.MIME_FIN), rate.sons())
        assertEquals(Ambiance.MIMES_ENTRE, rate.musique())
    }

    private val quizM1 = q1.copy(epreuve = "quiz|Manche 1")
    private val mimesM = mimes.copy(epreuve = "mimes|Les mimes")

    @Test
    fun `passage du quiz aux mimes annonce par le jingle de transition, une seule fois`() {
        val d = DirecteurSonore()
        d.observer(salon)
        // La première question du premier jeu garde son annonce habituelle.
        assertEquals(listOf(Son.MANCHE, Son.IMPACT), d.observer(quizM1).sons().take(2))
        d.observer(quizM1.copy(index = 1, premiere = false))
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 1, equipes = 2))
        val arrivee = d.observer(mimesM.copy(index = 2))
        assertEquals(listOf(Son.TRANSITION), arrivee.sons())
        assertFalse(Son.MANCHE in arrivee.sons())
        assertEquals(Ordre.Musique(Ambiance.MIMES_ENTRE, Tempo.TRANSITION_MUSIQUE), arrivee.last())
        // Les tours de mimes qui suivent sont dans la même épreuve : pas de nouvelle transition.
        assertEquals(listOf(Son.MIME_TOP), d.observer(tour.copy(index = 2, epreuve = mimesM.epreuve)).sons())
        assertFalse(Son.TRANSITION in d.observer(mimesM.copy(index = 2)).sons())
    }

    @Test
    fun `nouvelle manche de quiz annoncee par la transition, puis musique de question`() {
        val d = DirecteurSonore()
        d.observer(quizM1.copy(index = 4, premiere = false))
        val m2 = d.observer(quizM1.copy(index = 5, premiere = false, epreuve = "quiz|Manche 2"))
        assertEquals(Son.TRANSITION, m2.sons().first())
        assertEquals(Ambiance.QUESTION, m2.musique())
        assertFalse(Son.TRANSITION in d.observer(quizM1.copy(index = 6, premiere = false, epreuve = "quiz|Manche 2")).sons())
    }

    @Test
    fun `une box qui se reconnecte en plein jeu ne rejoue pas la transition`() {
        val d = DirecteurSonore()
        assertTrue(d.observer(mimesM).sons().isEmpty())
        assertFalse(Son.TRANSITION in d.observer(tour.copy(epreuve = mimesM.epreuve)).sons())
    }

    @Test
    fun `jeu change pendant la pause, la transition part apres le decompte`() {
        val d = DirecteurSonore()
        d.observer(quizM1.copy(index = 1, premiere = false))
        d.observer(quizM1.copy(index = 1, premiere = false, enPause = true))
        assertTrue(d.observer(mimesM.copy(index = 2, enPause = true)).isEmpty())
        val reprise = d.observer(mimesM.copy(index = 2, repriseDansMs = 3_000))
        assertTrue(Ordre.Jouer(Son.TRANSITION, 3_000) in reprise)
        assertFalse(Son.MANCHE in reprise.sons())
    }

    @Test
    fun `juste chiffre, roulette qui se pose sur l'or, fanfare seulement si une equipe tombe pile`() {
        val d = DirecteurSonore()
        val question = Instant(Ecran.QUESTION, partie = "ABCD", index = 4, equipes = 2, nombre = true, propositions = 0)
        d.observer(question)
        val proche = d.observer(question.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertEquals(Son.CHIFFRE_ROULETTE, proche.sons().first())
        assertFalse(Son.ROULEMENT_COURT in proche.sons())
        assertTrue(Ordre.Jouer(Son.BONNE_REPONSE, Tempo.REVELATION_OR) in proche)
        assertFalse(Son.CHIFFRE_PILE in proche.sons())
        d.observer(question.copy(index = 5))
        val pile = d.observer(question.copy(index = 5, ecran = Ecran.REVELATION, gagnants = 1, pile = true))
        assertTrue(Ordre.Jouer(Son.CHIFFRE_PILE, Tempo.REVELATION_OR) in pile)
        assertFalse(Son.BONNE_REPONSE in pile.sons())
    }

    @Test
    fun `juste chiffre du Game Show, tampons et points attendent la regle des ecarts, le Classique ne change pas`() {
        val question = Instant(Ecran.QUESTION, partie = "ABCD", index = 4, equipes = 2, nombre = true, propositions = 0)
        val gs = DirecteurSonore().let { d -> d.observer(question.copy(gameShow = true)); d.observer(question.copy(gameShow = true, ecran = Ecran.REVELATION, gagnants = 1)) }
        // Le son de la bonne réponse reste avec la machine à sous ; les points viennent avec le « +100 ».
        assertTrue(Ordre.Jouer(Son.BONNE_REPONSE, Tempo.REVELATION_OR) in gs)
        assertTrue(Ordre.Jouer(Son.TAMPON, Tempo.tampon(0) + Tempo.JUSTE_GS_RETARD) in gs)
        assertTrue(Ordre.Jouer(Son.POINTS, Tempo.REVELATION_POINTS + Tempo.JUSTE_GS_RETARD) in gs)
        assertFalse(Ordre.Jouer(Son.POINTS, Tempo.REVELATION_POINTS) in gs)
        // Personne de proche : aucun point, aucun son de points, même en retard.
        val rien = DirecteurSonore().let { d -> d.observer(question.copy(gameShow = true)); d.observer(question.copy(gameShow = true, ecran = Ecran.REVELATION, gagnants = 0)) }
        assertFalse(Son.POINTS in rien.sons())
        val classique = DirecteurSonore().let { d -> d.observer(question); d.observer(question.copy(ecran = Ecran.REVELATION, gagnants = 1)) }
        assertTrue(Ordre.Jouer(Son.TAMPON, Tempo.tampon(0)) in classique)
        assertTrue(Ordre.Jouer(Son.POINTS, Tempo.REVELATION_POINTS) in classique)
    }

    @Test
    fun `chrono à zéro sans toutes les réponses, le signal temps écoulé sous le verrou, jamais quand Sarah arrête le chrono`() {
        val d = DirecteurSonore()
        val question = Instant(Ecran.QUESTION, partie = "ABCD", index = 3, equipes = 3, reponses = 2)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 2, equipes = 3))
        d.observer(question)
        val temps = d.observer(question.copy(ecran = Ecran.VERROUILLEE, tempsEcoule = true))
        assertTrue(Son.VERROU in temps.sons())
        assertTrue(Son.MIME_FIN in temps.sons())
        d.observer(question.copy(index = 4, ecran = Ecran.CLASSEMENT))
        d.observer(question.copy(index = 5))
        val main = d.observer(question.copy(index = 5, ecran = Ecran.VERROUILLEE))
        assertTrue(Son.VERROU in main.sons())
        assertFalse(Son.MIME_FIN in main.sons())
    }

    @Test
    fun `vrai ou faux express, musique continue, verdict ding ou pouet, ni roulement ni tension`() {
        val d = DirecteurSonore()
        val question = Instant(Ecran.QUESTION, partie = "ABCD", index = 6, equipes = 2, propositions = 2, express = true, reponseVraie = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 5, equipes = 2))
        val entree = d.observer(question)
        assertEquals(Ambiance.EXPRESS, entree.musique())
        assertFalse(Son.TENSION in d.observer(question.copy(urgent = true)).sons())
        val verrou = d.observer(question.copy(ecran = Ecran.VERROUILLEE))
        assertEquals(null, verrou.musique())
        val vrai = d.observer(question.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertTrue(Ordre.Jouer(Son.VF_VRAI, Tempo.revelationOr(express = true)) in vrai)
        assertFalse(Son.ROULEMENT_COURT in vrai.sons() || Son.BONNE_REPONSE in vrai.sons())
        assertEquals(null, vrai.musique())
        assertTrue(vrai.filterIsInstance<Ordre.Jouer>().all { it.dansMs <= Tempo.EXPRESS_POINTS })
        // Question suivante : la musique express continue, pas de nouvelle entrée de musique.
        d.observer(question.copy(index = 7, reponseVraie = false))
        val faux = d.observer(question.copy(index = 7, reponseVraie = false, ecran = Ecran.REVELATION))
        assertTrue(Son.VF_FAUX in faux.sons())
        assertFalse(Son.VF_VRAI in faux.sons())
    }

    @Test
    fun `zoom mystere, ouverture a l'entree et revelation dediee`() {
        val d = DirecteurSonore()
        val question = Instant(Ecran.QUESTION, partie = "ABCD", index = 8, equipes = 2, propositions = 4, zoom = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 7, equipes = 2))
        val entree = d.observer(question)
        assertTrue(Son.ZOOM_OUVERTURE in entree.sons())
        // La même montée de tension que l'Image floue sous le dézoom, musique en retrait.
        assertTrue(Son.FLOU_MONTEE in entree.sons())
        assertEquals(Ambiance.SUSPENSE, entree.musique())
        val revele = d.observer(question.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertTrue(Son.ZOOM_REVELE in revele.sons())
        assertFalse(Son.ROULEMENT_COURT in revele.sons())
    }

    @Test
    fun `image floue, la montee dure tout le chrono sans jamais accelerer`() {
        val d = DirecteurSonore()
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 8, equipes = 3))
        // cedric, 25/10 : 30 s de montée pour 40 s de chrono, elle s'arrêtait avant la fin.
        val entree = d.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = 9, equipes = 3, propositions = 0, jeuBuzz = true, flou = true, chronoMs = 40_000))
        val montee = entree.filterIsInstance<Ordre.Jouer>().single { it.son == Son.FLOU_MONTEE }
        assertEquals(40_000 - Tempo.PROPOSITIONS_DEBUT, montee.etireSurMs)
        assertEquals(30_000f / 39_650f, vitesseEtiree(30_000, montee.etireSurMs), 0.001f)
        // Chrono plus court que le fichier : vitesse normale, coupée à la fin comme avant ; jamais trop pâteuse.
        assertEquals(1f, vitesseEtiree(30_000, 20_000), 0.0001f)
        assertEquals(1f, vitesseEtiree(30_000, 0), 0.0001f)
        assertEquals(1f, vitesseEtiree(0, 40_000), 0.0001f)
        assertEquals(VITESSE_MIN, vitesseEtiree(30_000, 120_000), 0.0001f)
    }

    @Test
    fun `image floue, montee puis buzz qui fige tout, rate gentil, revelation`() {
        val d = DirecteurSonore()
        val image = Instant(Ecran.QUESTION, partie = "ABCD", index = 9, equipes = 3, propositions = 0, jeuBuzz = true, flou = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 8, equipes = 3))
        val entree = d.observer(image)
        assertTrue(Son.FLOU_MONTEE in entree.sons())
        assertEquals(Ambiance.SUSPENSE, entree.musique())
        // L'équipe 2 buzze : gros buzz, sa note, suspense, plus de musique.
        val buzz = d.observer(image.copy(buzzEquipe = 1))
        assertEquals(listOf(Son.BUZZ_GROS, Son.EQUIPE_2), buzz.sons())
        assertEquals(Ordre.Couper, buzz.first())
        assertEquals(Ambiance.PAROLE, buzz.musique())
        // Le même état observé deux fois ne rejoue rien.
        assertTrue(d.observer(image.copy(buzzEquipe = 1)).isEmpty())
        // Raté : « pouet » gentil et la musique revient.
        val rate = d.observer(image.copy(ratees = 1))
        assertEquals(Ordre.Couper, rate.first())
        assertEquals(listOf(Son.RATE), rate.sons())
        assertEquals(Ambiance.SUSPENSE, rate.musique())
        // La montée dramatique repart là où le buzz l'avait figée, comme la photo.
        assertTrue(rate.contains(Ordre.Reprendre(Son.FLOU_MONTEE, Tempo.FLOU_REPRISE)))
        assertFalse(Son.TENSION in d.observer(image.copy(ratees = 1, urgent = true)).sons())
        // Une autre équipe buzze et trouve : révélation de la photo, sans roulement.
        d.observer(image.copy(ratees = 1, urgent = true, buzzEquipe = 0))
        val revele = d.observer(image.copy(ecran = Ecran.REVELATION, ratees = 1, gagnants = 1))
        assertEquals(Ordre.Couper, revele.first())
        assertTrue(Son.ZOOM_REVELE in revele.sons())
        assertFalse(Son.ROULEMENT_COURT in revele.sons())
    }

    @Test
    fun `bip a chacune des cinq dernieres secondes, le dernier plus aigu, jamais en double`() {
        val d = DirecteurSonore()
        val q = Instant(Ecran.QUESTION, partie = "ABCD", index = 3, equipes = 3, propositions = 4)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 2, equipes = 3))
        d.observer(q)
        val sons = (5 downTo 1).map { s -> d.observer(q.copy(urgent = true, decompte = s)).sons() }
        assertEquals(listOf(Son.BIP, Son.BIP, Son.BIP, Son.BIP), sons.take(4).map { it.single { s -> s == Son.BIP } })
        assertTrue(Son.BIP_FIN in sons.last())
        assertFalse(Son.BIP in sons.last())
        // Le même état observé deux fois ne rebipe pas.
        assertFalse(Son.BIP_FIN in d.observer(q.copy(urgent = true, decompte = 1)).sons())
    }

    @Test
    fun `pas de bip pendant la reponse d'une equipe qui a buzze, en express, ni quand tout le monde a repondu`() {
        val d = DirecteurSonore()
        val image = Instant(Ecran.QUESTION, partie = "ABCD", index = 9, equipes = 3, propositions = 0, jeuBuzz = true, flou = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 8, equipes = 3))
        d.observer(image)
        assertTrue(Son.BIP in d.observer(image.copy(decompte = 5)).sons())
        assertFalse(Son.BIP in d.observer(image.copy(decompte = 4, buzzEquipe = 0)).sons())
        val express = DirecteurSonore()
        val vf = Instant(Ecran.QUESTION, partie = "ABCD", index = 4, equipes = 2, propositions = 2, express = true)
        express.observer(vf)
        assertFalse(Son.BIP in express.observer(vf.copy(decompte = 3)).sons())
        val tous = DirecteurSonore()
        val quiz = Instant(Ecran.QUESTION, partie = "ABCD", index = 5, equipes = 2, propositions = 4)
        tous.observer(quiz)
        assertFalse(Son.BIP in tous.observer(quiz.copy(reponses = 2, decompte = 3)).sons())
    }

    @Test
    fun `deuxieme buzz juste apres un rate, la musique prevue ne repart pas sous la reponse`() {
        val d = DirecteurSonore()
        val image = Instant(Ecran.QUESTION, partie = "ABCD", index = 9, equipes = 3, propositions = 1, jeuBuzz = true, flou = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 8, equipes = 3))
        d.observer(image)
        d.observer(image.copy(buzzEquipe = 0))
        val rate = d.observer(image.copy(ratees = 1))
        assertTrue(rate.any { it is Ordre.Musique && it.dansMs > 0 })
        // L'équipe 2 buzze avant que la musique revienne : tout ce qui était prévu est annulé d'abord.
        val buzz = d.observer(image.copy(ratees = 1, buzzEquipe = 2))
        assertEquals(Ordre.Couper, buzz.first())
        assertEquals(Ambiance.PAROLE, buzz.musique())
        // Les deux changements arrivent d'un coup (raté de l'équipe 3, buzz de l'équipe 1) : pouet puis buzz.
        val coup = d.observer(image.copy(ratees = 2, buzzEquipe = 1))
        assertEquals(listOf(Son.RATE, Son.BUZZ_GROS, Son.EQUIPE_2), coup.sons())
        assertEquals(Ambiance.PAROLE, coup.musique())
    }

    @Test
    fun `chante le mot, pas de suspense pendant que l'equipe chante, applaudie si elle gagne`() {
        val d = DirecteurSonore()
        val mot = Instant(Ecran.QUESTION, partie = "ABCD", index = 10, equipes = 2, propositions = 1, jeuBuzz = true, chante = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 9, equipes = 2))
        val entree = d.observer(mot).sons()
        assertFalse(Son.FLOU_MONTEE in entree)
        // Pas de bulle de proposition : le mot s'affiche seul.
        assertFalse(Son.POP_1 in entree)
        val buzz = d.observer(mot.copy(buzzEquipe = 0))
        assertEquals(listOf(Son.BUZZ_GROS, Son.EQUIPE_1), buzz.sons())
        assertEquals(Ambiance.SILENCE, buzz.musique())
        val bravo = d.observer(mot.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertTrue(Ordre.Jouer(Son.APPLAUDISSEMENTS, Tempo.BUZZ_BRAVO) in bravo)
        assertFalse(Son.ROULEMENT_COURT in bravo.sons())
        val d2 = DirecteurSonore()
        d2.observer(mot)
        assertFalse(Son.APPLAUDISSEMENTS in d2.observer(mot.copy(ecran = Ecran.REVELATION)).sons())
    }

    @Test
    fun `qui suis-je, une note par nouvel indice, pas pendant qu'une equipe repond`() {
        val d = DirecteurSonore()
        val qui = Instant(Ecran.QUESTION, partie = "ABCD", index = 11, equipes = 2, propositions = 1, jeuBuzz = true, indices = 1)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 10, equipes = 2))
        assertFalse(Son.INDICE in d.observer(qui).sons())
        assertEquals(listOf(Son.INDICE), d.observer(qui.copy(indices = 2)).sons())
        assertTrue(d.observer(qui.copy(indices = 2)).isEmpty())
        d.observer(qui.copy(indices = 2, buzzEquipe = 1))
        assertFalse(Son.INDICE in d.observer(qui.copy(indices = 3, buzzEquipe = 1)).sons())
    }

    @Test
    fun `blind test, l'habillage se tait sous la chanson, diamant, scratch au buzz, rate gentil, pas de fete par-dessus`() {
        val d = DirecteurSonore()
        val bt = Instant(Ecran.QUESTION, partie = "ABCD", index = 12, equipes = 2, propositions = 1, jeuBuzz = true, musical = true, epreuve = "manche|Blind test")
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 11, equipes = 2, epreuve = ""))
        d.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = 10, equipes = 2, epreuve = "manche|Quiz"))
        val entree = d.observer(bt)
        assertEquals(Ambiance.SILENCE, entree.musique())
        assertEquals(listOf(Son.BT_DIAMANT), entree.sons())
        assertFalse(Son.TENSION in d.observer(bt.copy(urgent = true)).sons())
        val buzz = d.observer(bt.copy(urgent = true, buzzEquipe = 1))
        assertEquals(listOf(Son.BT_SCRATCH, Son.BUZZ_GROS, Son.EQUIPE_2), buzz.sons())
        assertEquals(Ambiance.PAROLE, buzz.musique())
        val rate = d.observer(bt.copy(urgent = true, ratees = 1))
        assertEquals(listOf(Son.RATE), rate.sons())
        assertEquals(Ambiance.SILENCE, rate.musique())
        val revele = d.observer(bt.copy(ecran = Ecran.REVELATION, ratees = 1, gagnants = 1))
        assertFalse(revele.any { it is Ordre.Musique && it.ambiance == Ambiance.FETE })
        assertFalse(Son.ROULEMENT_COURT in revele.sons())
        // Reprise après une pause : toujours le silence sous la chanson.
        d.observer(bt.copy(index = 13))
        d.observer(bt.copy(index = 13, enPause = true))
        assertEquals(Ambiance.SILENCE, d.observer(bt.copy(index = 13, repriseDansMs = 3_000)).musique())
    }

    @Test
    fun `blind test, generique a la presentation, diamant a chaque lancement, buzz dedie et attente, bravo, points doubles, outro`() {
        val d = DirecteurSonore()
        val bt = Instant(Ecran.QUESTION, partie = "ABCD", index = 12, equipes = 2, propositions = 0, jeuBuzz = true, musical = true,
            blind = true, epreuve = "manche|Blind test")
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 11, equipes = 2))
        // Présentation : le générique du blind test, pas encore de diamant ni de bulles.
        val presentation = d.observer(bt.copy(blindPresentation = true))
        assertEquals(listOf(Son.BT_GENERIQUE), presentation.sons())
        assertEquals(Ambiance.SILENCE, presentation.musique())
        // Sarah lance la chanson : le diamant se pose, une seule fois.
        assertEquals(listOf(Son.BT_DIAMANT), d.observer(bt.copy(blindLecture = true)).sons())
        assertTrue(d.observer(bt.copy(blindLecture = true)).isEmpty())
        // Buzz : le buzzer du blind test, la note de l'équipe, puis le silence pour répondre ; ni scratch ni gros buzz.
        val buzz = d.observer(bt.copy(buzzEquipe = 1))
        assertEquals(listOf(Son.BT_BUZZ, Son.EQUIPE_2), buzz.sons())
        assertEquals(Ambiance.SILENCE, buzz.musique())
        // Mauvaise réponse : petit « pouet », le silence continue ; puis Sarah relance la chanson.
        val rate = d.observer(bt.copy(ratees = 1))
        assertTrue(Ordre.Couper in rate)
        assertEquals(listOf(Son.RATE), rate.sons())
        assertEquals(Ambiance.SILENCE, rate.musique())
        assertEquals(listOf(Son.BT_DIAMANT), d.observer(bt.copy(ratees = 1, blindLecture = true)).sons())
        // Révélation avec un gagnant : fanfare du blind test, tampon et points ; raccourcie par Sarah, tout se tait.
        val revele = d.observer(bt.copy(ecran = Ecran.REVELATION, ratees = 1, gagnants = 1))
        assertEquals(listOf(Son.BT_BRAVO, Son.TAMPON, Son.POINTS), revele.sons())
        assertFalse(revele.any { it is Ordre.Musique && it.ambiance == Ambiance.FETE })
        assertEquals(listOf(Ordre.Couper), d.observer(bt.copy(ecran = Ecran.REVELATION, ratees = 1, gagnants = 1, blindCoupe = true)))
        // Personne n'a trouvé : un simple carillon, jamais moqueur.
        d.observer(bt.copy(index = 13, blindLecture = true))
        assertEquals(listOf(Son.BONNE_REPONSE), d.observer(bt.copy(index = 13, ecran = Ecran.REVELATION)).sons())
        // Premier morceau à points doublés : l'éclat de cuivres, une seule fois.
        assertEquals(listOf(Son.BT_DOUBLE, Son.BT_DIAMANT), d.observer(bt.copy(index = 14, blindDouble = true, blindLecture = true)).sons())
        d.observer(bt.copy(index = 14, ecran = Ecran.REVELATION, blindDouble = true))
        assertFalse(Son.BT_DOUBLE in d.observer(bt.copy(index = 15, blindDouble = true, blindLecture = true)).sons())
        // Bilan : l'outro, puis le classement et la fête une fois l'outro fini.
        val bilan = d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 15, equipes = 2, blind = true, blindBilan = true, meneurAPoints = true))
        assertEquals(listOf(Son.BT_OUTRO, Son.COMPTEUR, Son.COURONNE), bilan.sons())
        assertEquals(Ordre.Musique(Ambiance.BILAN, Tempo.BT_OUTRO_MUSIQUE), bilan.last())
    }

    @Test
    fun `blind test Game Show, musique d'attente sous Lancer le morceau, coupee net au lancement, Classique inchange`() {
        val bt = Instant(Ecran.QUESTION, partie = "ABCD", index = 12, equipes = 2, propositions = 0, jeuBuzz = true, musical = true,
            blind = true, epreuve = "manche|Blind test", gameShow = true)
        val d = DirecteurSonore()
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 11, equipes = 2, gameShow = true))
        // Premier morceau : le générique, puis la musique d'attente à sa fin.
        val presentation = d.observer(bt.copy(blindPresentation = true, blindAttente = true))
        assertEquals(listOf(Son.BT_GENERIQUE), presentation.sons())
        assertEquals(Ordre.Musique(Ambiance.BT_ATTENTE, Tempo.BT_ATTENTE_APRES_GENERIQUE), presentation.filterIsInstance<Ordre.Musique>().last())
        assertTrue(Tempo.BT_ATTENTE_APRES_GENERIQUE in 4_000L..4_800L)
        // Sarah lance le morceau : tout ce qui était prévu est annulé, la musique se coupe net, le diamant se pose.
        val lance = d.observer(bt.copy(blindLecture = true))
        assertEquals(Ordre.Couper, lance.first())
        assertEquals(Ordre.Musique(Ambiance.SILENCE, fonduMs = Tempo.FONDU_RELAIS), lance.filterIsInstance<Ordre.Musique>().single())
        assertEquals(listOf(Son.BT_DIAMANT), lance.sons())
        // Buzz puis mauvaise réponse : « Relancer la musique » garde le silence (pas de musique d'attente).
        d.observer(bt.copy(buzzEquipe = 1))
        assertEquals(Ambiance.SILENCE, d.observer(bt.copy(ratees = 1)).musique())
        // Morceau suivant : directement la musique d'attente, sans générique.
        d.observer(bt.copy(ecran = Ecran.REVELATION, ratees = 1))
        val suivant = d.observer(bt.copy(index = 13, blindAttente = true))
        assertFalse(Son.BT_GENERIQUE in suivant.sons())
        assertEquals(Ordre.Musique(Ambiance.BT_ATTENTE), suivant.filterIsInstance<Ordre.Musique>().last())
        // Une box qui redémarre sur cet écran retrouve la musique d'attente.
        assertEquals(listOf(Ordre.Musique(Ambiance.BT_ATTENTE)), DirecteurSonore().observer(bt.copy(index = 13, blindAttente = true)))
        // Le volume : celui de l'accueil ; la boucle n'existe qu'en Game Show.
        assertEquals(Ambiance.SALON.volume(Lit.ACCUEIL, gs = true), Ambiance.BT_ATTENTE.volume(Lit.BT_ATTENTE, gs = true))
        assertEquals("gs_bt_attente", Lit.BT_ATTENTE.fichierPour(true))
        assertNull(Lit.BT_ATTENTE.fichierPour(false))
        // Classique : le silence d'avant.
        val c = DirecteurSonore()
        c.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 11, equipes = 2))
        val classique = c.observer(bt.copy(gameShow = false, blindPresentation = true, blindAttente = true))
        assertFalse(classique.any { it is Ordre.Musique && it.ambiance == Ambiance.BT_ATTENTE })
        assertFalse(Ordre.Couper in c.observer(bt.copy(gameShow = false, blindLecture = true)))
    }

    @Test
    fun `la musique d'attente du blind test boucle sans blanc, 13,5 s en WAV 44,1 kHz stereo`() {
        val f = java.io.File("src/main/res/raw/gs_bt_attente.wav")
        val octets = f.readBytes()
        val e = lireEnteteWav(octets.copyOf(512), octets.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(2, e.canaux)
        val secondes = e.octetsDonnees / (44_100.0 * 2 * 2)
        assertEquals(13.52, secondes, 0.02)
    }

    @Test
    fun `blind test, une box qui se reconnecte ne rejoue ni le generique ni les points doubles`() {
        val d = DirecteurSonore()
        val o = d.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = 14, equipes = 2, jeuBuzz = true, musical = true,
            blind = true, blindDouble = true, blindLecture = true))
        assertEquals(listOf(Ordre.Musique(Ambiance.SILENCE)), o)
    }

    @Test
    fun `quiz musical a quatre titres, ni musique ni tension sur la chanson, revelation sans fete`() {
        val d = DirecteurSonore()
        val q = Instant(Ecran.QUESTION, partie = "ABCD", index = 14, equipes = 2, propositions = 4, musical = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 13, equipes = 2))
        assertEquals(Ambiance.SILENCE, d.observer(q).musique())
        assertFalse(Son.TENSION in d.observer(q.copy(urgent = true)).sons())
        d.observer(q.copy(ecran = Ecran.VERROUILLEE))
        val revele = d.observer(q.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertTrue(Son.BONNE_REPONSE in revele.sons())
        assertFalse(revele.any { it is Ordre.Musique && it.ambiance == Ambiance.FETE })
    }

    @Test
    fun `quiz musical (cedric 31-10), la chanson continue sous le verrou et la revelation, bruitages du quiz, jamais une seconde musique`() {
        val d = DirecteurSonore()
        val q = Instant(Ecran.QUESTION, partie = "ABCD", index = 14, equipes = 2, propositions = 4, musical = true, quizMusical = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 13, equipes = 2))
        d.observer(q)
        val verrou = d.observer(q.copy(ecran = Ecran.VERROUILLEE))
        assertTrue(Son.VERROU in verrou.sons())
        assertFalse(verrou.any { it is Ordre.Musique && it.ambiance != Ambiance.SILENCE })
        val revele = d.observer(q.copy(ecran = Ecran.REVELATION, gagnants = 2))
        val sons = revele.sons()
        assertTrue(Son.ROULEMENT_COURT in sons && Son.BONNE_REPONSE in sons && Son.IMPACT in sons && Son.POINTS in sons)
        assertEquals(2, sons.count { it == Son.TAMPON })
        assertFalse(revele.any { it is Ordre.Musique && it.ambiance != Ambiance.SILENCE })
        // Au classement, Aerodynamic comme d'habitude (la chanson, elle, s'arrête avec l'écran de la question).
        assertEquals(Ambiance.BILAN, d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 14, equipes = 2)).musique())
        // Blind test : le verrou garde sa nappe de suspense (rien ne change pour lui).
        val d2 = DirecteurSonore()
        val bt = q.copy(quizMusical = false)
        d2.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 13, equipes = 2))
        d2.observer(bt)
        assertEquals(Ambiance.SUSPENSE, d2.observer(bt.copy(ecran = Ecran.VERROUILLEE)).musique())
    }

    @Test
    fun `statues musicales, gel a chaque arret, elan a chaque reprise, jamais en double, rien par-dessus la musique du jeu`() {
        val d = DirecteurSonore()
        val danse = Instant(Ecran.QUESTION, partie = "ABCD", index = 15, equipes = 2, propositions = 0, musical = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 14, equipes = 2))
        assertEquals(Ambiance.SILENCE, d.observer(danse).musique())
        assertEquals(listOf(Son.STATUE_GEL), d.observer(danse.copy(statue = true)).sons())
        assertTrue(d.observer(danse.copy(statue = true)).isEmpty())
        assertEquals(listOf(Son.STATUE_REPART), d.observer(danse).sons())
        assertFalse(Son.TENSION in d.observer(danse.copy(urgent = true)).sons())
    }

    @Test
    fun `statues musicales, roulement de tambour puis fanfare pour les gagnantes, rien pour Personne, pas d'elan a l'annonce`() {
        val d = DirecteurSonore()
        val statue = Instant(Ecran.QUESTION, partie = "ABCD", index = 15, equipes = 2, propositions = 0, musical = true, statue = true)
        d.observer(statue)
        val suspense = statue.copy(statue = false, statuesAnnonce = 1, statuesGagnantes = true)
        assertEquals(listOf(Son.ROULEMENT_LONG), d.observer(suspense).sons())
        assertEquals(listOf(Son.FANFARE), d.observer(suspense.copy(statuesAnnonce = 2)).sons())
        assertTrue(d.observer(suspense.copy(statuesAnnonce = 3)).sons().isEmpty())
        // Chanson suivante, puis « Personne » : le roulement, et pas de fanfare.
        d.observer(statue.copy(statue = false, index = 15))
        val personne = statue.copy(statue = false, statuesAnnonce = 1)
        assertEquals(listOf(Son.ROULEMENT_LONG), d.observer(personne).sons())
        assertTrue(d.observer(personne.copy(statuesAnnonce = 2)).sons().isEmpty())
    }

    @Test
    fun `ca va exploser, sa propre musique, ni boucle, ni bips, ni tension par-dessus`() {
        val d = DirecteurSonore()
        val bombe = Instant(Ecran.QUESTION, partie = "ABCD", index = 20, equipes = 4, propositions = 0, patate = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 19, equipes = 4))
        assertEquals(Ambiance.SILENCE, d.observer(bombe).musique())
        val fin = d.observer(bombe.copy(urgent = true, decompte = 3))
        assertFalse(Son.TENSION in fin.sons())
        assertFalse(Son.BIP in fin.sons() || Son.BIP_FIN in fin.sons())
        assertTrue(fin.none { it is Ordre.Musique && it.ambiance != Ambiance.SILENCE })
        // Les autres jeux gardent leurs bips et leur tension.
        val quiz = Instant(Ecran.QUESTION, partie = "ABCD", index = 21, equipes = 4)
        d.observer(quiz)
        assertTrue(Son.TENSION in d.observer(quiz.copy(urgent = true, decompte = 3)).sons())
        // Le bilan de la dernière bombe : la fête reprend.
        assertEquals(Ambiance.FETE, d.observer(bombe.copy(ecran = Ecran.REVELATION)).musique())
    }

    @Test
    fun `qui a disparu, musique douce pour memoriser, abracadabra puis pouf, et le buzzer reprend la main`() {
        val d = DirecteurSonore()
        val q = Instant(Ecran.QUESTION, partie = "ABCD", index = 16, equipes = 2, propositions = 1, jeuBuzz = true, disparu = DISPARU_MEMORISER)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 15, equipes = 2))
        assertEquals(Ambiance.MEMOIRE, d.observer(q).musique())
        val magie = d.observer(q.copy(disparu = DISPARU_MAGIE))
        assertEquals(listOf(Son.MAGIE), magie.sons())
        assertEquals(Ambiance.ENVOUTEMENT, magie.musique())
        assertTrue(d.observer(q.copy(disparu = DISPARU_MAGIE)).isEmpty())
        val chercher = q.copy(disparu = DISPARU_CHERCHER)
        val pouf = d.observer(chercher)
        assertEquals(listOf(Son.MAGIE_POUF), pouf.sons())
        assertEquals(Ambiance.SUSPENSE, pouf.musique())
        assertTrue(Son.BUZZ_GROS in d.observer(chercher.copy(buzzEquipe = 1)).sons())
    }

    @Test
    fun `qui a disparu, une box qui se reconnecte en pleine recherche ne refait pas le pouf`() {
        val d = DirecteurSonore()
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 15, equipes = 2))
        val chercher = Instant(Ecran.QUESTION, partie = "ABCD", index = 16, equipes = 2, propositions = 1, jeuBuzz = true, disparu = DISPARU_CHERCHER)
        d.observer(chercher)
        assertFalse(Son.MAGIE_POUF in d.observer(chercher).sons())
    }

    @Test
    fun `chaque extrait du blind test integre existe dans les ressources de l'appli`() {
        assertEquals(12, BlindTestCatalogue.extraits.size)
        assertEquals(BlindTestCatalogue.extraits.size, BlindTestCatalogue.extraits.map { it.id }.toSet().size)
        val manquants = BlindTestCatalogue.extraits.filterNot { java.io.File("src/main/res/raw/lmp_bt_${it.id}.ogg").isFile }
        assertTrue("Extraits manquants : $manquants", manquants.isEmpty())
    }

    @Test
    fun `Game Show, sons du 23 octobre sans rien changer au Classique`() {
        // Bilan des scores : en Classique, exactement la musique de fête ; en Game Show, le riff d'Aerodynamic.
        Lit.entries.forEach { assertEquals(Ambiance.FETE.volume(it), Ambiance.BILAN.volume(it), 0f) }
        assertEquals(0.8f, Ambiance.BILAN.volume(Lit.BILAN, gs = true), 0f)
        assertEquals(0f, Ambiance.BILAN.volume(Lit.COMPLET, gs = true), 0f)
        // Super finale : en Classique, l'express un peu plus bas ; en Game Show, seulement la boucle « tout accélère ×3 »
        // (idée 3, cedric 31/10 : musique et nappe accélérées, pulsation grave), la même pour tous les multiplicateurs.
        assertEquals(0.6f, Ambiance.DECISIVE.volume(Lit.EXPRESS), 0f)
        assertEquals(0f, Ambiance.DECISIVE.volume(Lit.TENSION), 0f)
        assertEquals(0f, Ambiance.DECISIVE.volume(Lit.FINALE), 0f)
        Lit.entries.forEach { assertEquals(it.name, if (it == Lit.FINALE) 1f else 0f, Ambiance.DECISIVE.volume(it, gs = true), 0f) }
        // Cette boucle ne joue que là.
        Ambiance.entries.filter { it != Ambiance.DECISIVE }.forEach {
            assertEquals(it.name, 0f, it.volume(Lit.FINALE, gs = true), 0f)
            assertEquals(it.name, 0f, it.volume(Lit.FINALE), 0f)
        }
        assertEquals("gs_bed_finale", Lit.FINALE.fichierPour(true))
        assertNull(Lit.FINALE.fichierPour(false))
        // Les ambiances sans réglage propre sonnent pareil dans les deux designs.
        Lit.entries.forEach { assertEquals(Ambiance.FETE.volume(it), Ambiance.FETE.volume(it, gs = true), 0f) }
        // Les boucles propres au Game Show ne se chargent pas en Classique.
        assertNull(Lit.BILAN.fichierPour(false))
        assertEquals("gs_bed_tension", Lit.TENSION.fichierPour(true))
        assertEquals("lmp_bed_light", Lit.LEGER.fichierPour(true))
        // 8 équipes, 8 mots robot ; en Classique la 5e reprend la note de la 1re, comme avant.
        assertEquals(Son.EQUIPE_5, Son.equipe(4))
        assertEquals(Son.EQUIPE_1.fichier, Son.EQUIPE_5.fichier)
        assertEquals(Son.EQUIPE_1, Son.equipe(8))
        // Bilan des scores entre deux jeux.
        val d = DirecteurSonore()
        d.observer(q2)
        assertEquals(Ambiance.BILAN, d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 1)).musique())
    }

    @Test
    fun `Game Show, le podium sur Digital Love puis l'ecran de fin, sans rien changer au Classique`() {
        // Classique : la célébration habituelle, sans le podium.
        val classique = DirecteurSonore().apply { observer(q2) }.observer(Instant(Ecran.FIN, partie = "ABCD", index = 1))
        assertTrue(Son.FANFARE in classique.sons())
        assertFalse(Son.PODIUM in classique.sons())
        // Game Show : la chanson du podium seule ; à sa coupe, la boucle d'attente enchaîne (cedric, 29/10), sans fin.
        val d = DirecteurSonore()
        d.observer(q2.copy(gameShow = true))
        val fin = Instant(Ecran.FIN, partie = "ABCD", index = 1, gameShow = true)
        val o = d.observer(fin)
        assertEquals(listOf(Son.PODIUM), o.sons())
        assertTrue(Ordre.Enchainer(Son.PODIUM, Tempo.PODIUM_COUPE, Ambiance.PODIUM_ATTENTE) in o)
        assertTrue("plus de fin toute seule", o.none { it is Ordre.Musique && it.ambiance == Ambiance.AU_REVOIR })
        assertTrue(d.observer(fin).isEmpty())
        assertTrue(Tempo.PODIUM_REVELATION < Tempo.PODIUM_COUPE)
        // Une box qui revient sur le podium le rejoue, comme l'écran.
        assertEquals(listOf(Son.PODIUM), DirecteurSonore().observer(fin).sons())
        // Après une pause sur le podium : la boucle d'attente.
        d.observer(fin.copy(enPause = true))
        assertEquals(Ambiance.PODIUM_ATTENTE, d.observer(fin).musique())
        // « ▶ Lancer la fin » (sans la vidéo de l'outro) : le podium s'éteint en fondu, l'écran de fin et son groove.
        val lancee = d.observer(fin.copy(finLancee = true))
        assertTrue(Ordre.Couper in lancee)
        assertTrue(Ordre.Musique(Ambiance.SILENCE, fonduMs = Tempo.FONDU_LANCER_FIN) in lancee)
        assertEquals(Ambiance.AU_REVOIR, lancee.musique())
        assertTrue(lancee.sons().isEmpty())
        assertTrue("un second appui ne relance rien", d.observer(fin.copy(finLancee = true)).isEmpty())
        // Une box qui revient après le lancement : l'écran de fin et son groove, sans rejouer le podium.
        val retour = DirecteurSonore().observer(fin.copy(finLancee = true))
        assertTrue(retour.sons().isEmpty())
        assertEquals(Ambiance.AU_REVOIR, retour.musique())
        // La boucle de fin n'existe qu'en Game Show ; en Classique, cette ambiance est la musique de fête.
        assertEquals(0.75f, Ambiance.AU_REVOIR.volume(Lit.FIN, gs = true), 0f)
        assertEquals(0f, Ambiance.AU_REVOIR.volume(Lit.COMPLET, gs = true), 0f)
        assertEquals(Ambiance.FETE.volume(Lit.COMPLET), Ambiance.AU_REVOIR.volume(Lit.COMPLET), 0f)
        assertNull(Lit.FIN.fichierPour(false))
    }

    @Test
    fun `Game Show avec l'outro, le podium puis le silence jusqu'a la fin de la video`() {
        val d = DirecteurSonore()
        d.observer(q2.copy(gameShow = true, outro = true))
        val fin = Instant(Ecran.FIN, partie = "ABCD", index = 1, gameShow = true, outro = true)
        val o = d.observer(fin)
        // La chanson du podium, puis rien : le son de l'outro est dans la vidéo, l'écran lance le groove de fin après.
        assertEquals(listOf(Son.PODIUM), o.sons())
        assertTrue(o.none { it is Ordre.Musique && it.ambiance == Ambiance.AU_REVOIR })
        assertTrue(d.observer(fin).isEmpty())
        // Une box qui revient sur le podium le rejoue de la même façon.
        val retour = DirecteurSonore().observer(fin)
        assertEquals(listOf(Son.PODIUM), retour.sons())
        assertTrue(retour.none { it is Ordre.Musique && it.ambiance == Ambiance.AU_REVOIR })
        assertTrue(Ordre.Enchainer(Son.PODIUM, Tempo.PODIUM_COUPE, Ambiance.PODIUM_ATTENTE) in o)
        // « ▶ Lancer la fin » : le podium (ou sa boucle d'attente) s'éteint sous l'outro, qui a son propre son.
        val lancee = d.observer(fin.copy(finLancee = true))
        assertEquals(listOf(Ordre.Couper, Ordre.Musique(Ambiance.SILENCE, fonduMs = Tempo.FONDU_LANCER_FIN)), lancee)
        // Box qui revient pendant l'outro : rien ne rejoue le podium.
        assertEquals(listOf(Ordre.Couper, Ordre.Musique(Ambiance.SILENCE)), DirecteurSonore().observer(fin.copy(finLancee = true)))
    }

    @Test
    fun `fin du podium - la boucle d'attente suit pile la coupe de gs_podium et reboucle sans son intro`() {
        // Seule sa boucle, à plein volume (le niveau est réglé dans le fichier), et aucune autre ambiance ne la joue.
        assertEquals(1f, Ambiance.PODIUM_ATTENTE.volume(Lit.PODIUM_ATTENTE, gs = true), 0f)
        Lit.entries.filter { it != Lit.PODIUM_ATTENTE }.forEach { assertEquals("$it", 0f, Ambiance.PODIUM_ATTENTE.volume(it, gs = true), 0f) }
        Ambiance.entries.filter { it != Ambiance.PODIUM_ATTENTE }.forEach { assertEquals("$it", 0f, it.volume(Lit.PODIUM_ATTENTE, gs = true), 0f) }
        assertNull(Lit.PODIUM_ATTENTE.fichierPour(false))
        // Le fichier : 44,1 kHz stéréo 16 bits ; l'écho et la descente (11,54 s, un nombre rond d'images), puis
        // 8 mesures de Digital Love à son tempo d'origine (124,73 BPM), qui tournent sans fin.
        val wav = java.io.File("src/main/res/raw/gs_podium_attente.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(2, e.canaux)
        val reprise = Lit.PODIUM_ATTENTE.repriseMs * 44_100 / 1000
        assertEquals("reprise à l'image près", 0L, Lit.PODIUM_ATTENTE.repriseMs * 44_100 % 1000)
        assertEquals(8 * 4 * 0.481050, (e.images - reprise) / 44_100.0, 0.001)
        // Raccord de la boucle : la dernière image enchaîne sur celle de la reprise sans saut.
        fun image(i: Long) = java.nio.ByteBuffer.wrap(wav, (e.debutDonnees + i * 4).toInt(), 4).order(java.nio.ByteOrder.LITTLE_ENDIAN).let { it.short.toInt() to it.short.toInt() }
        val (g1, d1) = image(e.images - 1)
        val (g2, d2) = image(reprise)
        assertTrue("raccord $g1/$d1 → $g2/$d2", kotlin.math.abs(g1 - g2) < 600 && kotlin.math.abs(d1 - d2) < 600)
        // gs_podium s'arrête à la coupe (fin de la dernière page Ogg = nombre d'images décodées).
        val ogg = java.io.File("src/main/res/raw/gs_podium.ogg").readBytes()
        val derniere = (ogg.size - 4 downTo 0).first { ogg[it] == 'O'.code.toByte() && ogg[it + 1] == 'g'.code.toByte() && ogg[it + 2] == 'g'.code.toByte() && ogg[it + 3] == 'S'.code.toByte() }
        val images = java.nio.ByteBuffer.wrap(ogg, derniere + 6, 8).order(java.nio.ByteOrder.LITTLE_ENDIAN).long
        assertEquals(Tempo.PODIUM_COUPE.toDouble(), images * 1000.0 / 44_100, 2.0)
    }

    @Test
    fun `chaque son a un fichier distinct`() {
        assertEquals(Son.entries.size, Son.entries.map { it.fichier to it.gs }.toSet().size)
    }

    @Test
    fun `chaque son existe dans les ressources de l'appli`() {
        // Les tests JVM d'Android tournent depuis le dossier du module tv/.
        val manquants = (Son.entries.flatMap { listOfNotNull(it.fichier, it.gs) } + Lit.entries.flatMap { listOfNotNull(it.fichier, it.gs) })
            .filterNot { n -> listOf("ogg", "wav").any { java.io.File("src/main/res/raw/$n.$it").isFile } }
        assertTrue("Sons manquants : $manquants", manquants.isEmpty())
    }

    @Test
    fun `chaque son du Game Show remplace un son classique qui existe`() {
        val noms = (Son.entries.map { it.fichier } + Lit.entries.mapNotNull { it.fichier }).toSet()
        // Sons et boucles propres au Game Show, sans équivalent classique direct (équipes 5 à 8, bilan, tension).
        val propres = (Son.entries.mapNotNull { it.gs } + Lit.entries.mapNotNull { it.gs }).toSet()
        // Les sons seulement : les clips du robot (gs_robot_*.mp4) vivent aussi dans res/raw.
        val gs = java.io.File("src/main/res/raw").listFiles().orEmpty().filter { it.extension in setOf("ogg", "mp3", "wav") }
            .map { it.nameWithoutExtension }.filter { it.startsWith("gs_") }
        assertTrue("Aucun son du Game Show", gs.isNotEmpty())
        // gs_tension_2 … gs_tension_5 : autres versions d'un son long du Game Show, que Sons tire au hasard.
        val longs = Son.entries.filter { it.long }.map { it.fichier }.toSet()
        val variante = Regex("^(gs_.+)_[2-5]$")
        val orphelins = gs.filterNot { n ->
            n in noms || n.replaceFirst("gs_", "lmp_") in noms || n in propres ||
                variante.find(n)?.groupValues?.get(1)?.let { base -> base in gs && base.replaceFirst("gs_", "lmp_") in longs } == true
        }
        assertTrue("Sons du Game Show sans son classique : $orphelins", orphelins.isEmpty())
    }

    @Test
    fun `presentation d'un jeu en musique douce, le jingle de manche seulement quand Sarah le lance`() {
        val d = DirecteurSonore()
        d.observer(salon)
        val presentation = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 0, equipes = 2, premiere = true, epreuve = "quiz|")
        val o = d.observer(presentation)
        assertFalse(Son.MANCHE in o.sons())
        assertTrue(o.sons().none { it.name.startsWith("POP") })
        assertEquals(Ambiance.PRESENTATION, o.musique())
        // Elle peut durer : rien ne se rejoue tant que Sarah présente le jeu.
        assertTrue(d.observer(presentation).isEmpty())
        val lance = d.observer(q1.copy(epreuve = "quiz|"))
        assertTrue(Son.MANCHE in lance.sons())
        assertEquals(Ambiance.QUESTION, lance.musique())
        // Jeu suivant : rideau à la présentation, puis le jingle de manche au lancement, même loin dans la partie.
        val suivant = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 8, equipes = 2, epreuve = "zoom|")
        val rideau = d.observer(suivant)
        assertTrue(Son.TRANSITION in rideau.sons())
        assertEquals(Ambiance.PRESENTATION, rideau.musique())
        assertTrue(Son.MANCHE in d.observer(suivant.copy(ecran = Ecran.QUESTION)).sons())
    }

    @Test
    fun `duel des robots, Game Show - le debut de l'air western a la presentation puis sa boucle, silence au face-a-face`() {
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true))
        val presentation = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 4, epreuve = "duel|", gameShow = true, duel = true)
        val o = d.observer(presentation)
        assertEquals(listOf(Son.DUEL_INTRO), o.sons())
        // La boucle prend le relais pile à la fin du début, repartie de sa première mesure.
        val relais = o.filterIsInstance<Ordre.Musique>().last()
        assertEquals(Ambiance.DUEL_PRESENTATION, relais.ambiance)
        assertEquals(Tempo.DUEL_INTRO_BOUCLE, relais.dansMs)
        assertTrue(Ordre.Caler(Tempo.DUEL_INTRO_BOUCLE) in o)
        assertEquals(1f, Ambiance.DUEL_PRESENTATION.volume(Lit.DUEL, gs = true))
        assertTrue(d.observer(presentation).isEmpty())
        val pret = presentation.copy(ecran = Ecran.QUESTION, duelEtape = "ready")
        assertEquals(Ambiance.DUEL_ANNONCE, d.observer(pret).musique())
        // Le face-à-face : la boucle se tait net (avant, elle restait sous la musique du face-à-face).
        val face = d.observer(pret.copy(duelEtape = "standoff")).filterIsInstance<Ordre.Musique>().single()
        assertEquals(Ambiance.SILENCE, face.ambiance)
        assertEquals(Tempo.FONDU_RELAIS, face.fonduMs)
        assertEquals(Ambiance.DUEL_ENTRE, d.observer(pret.copy(duelEtape = "result")).musique())
        // Duel suivant : la boucle revient pour l'annonce ; rien ne se rejoue tant que l'étape ne change pas.
        assertEquals(Ambiance.DUEL_ANNONCE, d.observer(pret).musique())
        assertTrue(d.observer(pret).isEmpty())
    }

    @Test
    fun `simon de buzzy - silence pendant une suite pour entendre les notes, musique entre deux suites`() {
        val d = DirecteurSonore()
        d.observer(salon)
        val entre = Instant(Ecran.QUESTION, partie = "ABCD", index = 3, equipes = 4, epreuve = "simon|", simon = true)
        assertEquals(Ambiance.SIMON_ENTRE, d.observer(entre).musique())
        assertEquals(Ambiance.SIMON_SUITE, d.observer(entre.copy(simonSuite = true)).musique())
        assertEquals(Ambiance.SIMON_ENTRE, d.observer(entre).musique())
    }

    @Test
    fun `simon de buzzy - trois boucles de Prix choc en Game Show, la musique des questions ou le silence en Classique`() {
        val d = DirecteurSonore()
        d.observer(salon)
        val gs = Instant(Ecran.QUESTION, partie = "ABCD", index = 3, equipes = 4, epreuve = "simon|", simon = true, gameShow = true)
        assertEquals(Ambiance.SIMON_ENTRE, d.observer(gs).musique())
        assertEquals(Ambiance.SIMON_SUITE, d.observer(gs.copy(simonSuite = true)).musique())
        // Les chiffres débarquent pendant la suite suivante : la partie où tout joue.
        assertEquals(Ambiance.SIMON_ENTRE, d.observer(gs).musique())
        assertEquals(Ambiance.SIMON_FORT, d.observer(gs.copy(simonSuite = true, simonChiffres = true)).musique())
        assertEquals(Ambiance.SIMON_ENTRE, d.observer(gs).musique())
        // Chaque ambiance ne fait jouer que sa boucle ; aucune autre ambiance ne joue celles du Simon.
        val boucles = mapOf(Ambiance.SIMON_ENTRE to Lit.SIMON_DOUCE, Ambiance.SIMON_SUITE to Lit.SIMON_SUITE, Ambiance.SIMON_FORT to Lit.SIMON_FORT)
        for ((a, l) in boucles) {
            assertTrue("$a", a.volume(l, gs = true) in 0.3f..1f)
            Lit.entries.filter { it != l }.forEach { assertEquals("$a / $it", 0f, a.volume(it, gs = true), 0f) }
        }
        Ambiance.entries.filter { it !in boucles }.forEach { a -> boucles.values.forEach { assertEquals("$a", 0f, a.volume(it, gs = true), 0f) } }
        // Classique : la douce devient la musique des questions, les suites restent silencieuses (comme avant).
        assertEquals(Ambiance.QUESTION.volume(Lit.LEGER), Ambiance.SIMON_ENTRE.volume(Lit.LEGER), 0f)
        Lit.entries.forEach { assertEquals(0f, Ambiance.SIMON_SUITE.volume(it), 0f); assertEquals(0f, Ambiance.SIMON_FORT.volume(it), 0f) }
        // Les notes des boules passent nettement au-dessus de la musique (cedric, 28/10 au soir : « pas assez fort ») :
        // notes presque à fond, musique des suites baissée par rapport à avant (0,84 et 0,55).
        assertTrue(NotesSimon.VOLUME >= 0.9f && NotesSimon.VOLUME <= 1f)
        assertTrue(Ambiance.SIMON_SUITE.volume(Lit.SIMON_SUITE, gs = true) <= 0.6f)
        assertTrue(Ambiance.SIMON_FORT.volume(Lit.SIMON_FORT, gs = true) <= 0.45f)
        // Les fichiers : WAV 44,1 kHz stéréo, 8 ou 16 mesures à 127,87 BPM (à quelques échantillons près, raccord calé).
        for ((nom, mesures) in listOf("gs_simon_douce" to 8, "gs_simon_suite" to 16, "gs_simon_fort" to 16)) {
            assertEquals(nom, Lit.entries.single { it.fichierPour(true) == nom }.fichierPour(true))
            assertNull(Lit.entries.single { it.fichierPour(true) == nom }.fichierPour(false))
            val wav = java.io.File("src/main/res/raw/$nom.wav")
            assertEquals("$nom : 4 octets par image stéréo 16 bits", 0L, (wav.length() - 44) % 4)
            assertEquals(nom, mesures * 4 * 60 / 127.87, (wav.length() - 44) / (44_100.0 * 4), 0.01)
        }
        // Hors du Simon, rien ne change.
        assertEquals(Ambiance.QUESTION, DirecteurSonore().let { it.observer(salon); it.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = 4, equipes = 4)).musique() })
    }

    @Test
    fun `simon de buzzy - la presentation joue la douce en Game Show, la presentation habituelle en Classique`() {
        // Un quiz, puis le Simon : nouveau jeu, jingle du rideau puis la musique de présentation (sous la vidéo d'intro).
        val quiz = Instant(Ecran.QUESTION, partie = "ABCD", index = 2, equipes = 4, epreuve = "quiz|")
        val simon = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 4, epreuve = "simon|", simon = true)
        val gs = DirecteurSonore().let { it.observer(salon); it.observer(quiz.copy(gameShow = true)); it.observer(simon.copy(gameShow = true)) }
        assertTrue(Son.TRANSITION in gs.sons())
        assertTrue(Ordre.Musique(Ambiance.SIMON_PRESENTATION, Tempo.TRANSITION_MUSIQUE) in gs)
        val cl = DirecteurSonore().let { it.observer(salon); it.observer(quiz); it.observer(simon) }
        assertTrue(Ordre.Musique(Ambiance.PRESENTATION, Tempo.TRANSITION_MUSIQUE) in cl)
    }

    @Test
    fun `duel des robots, Classique - presentation habituelle, sans l'air western`() {
        val d = DirecteurSonore()
        d.observer(salon)
        val o = d.observer(Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 4, epreuve = "duel|", duel = true))
        assertFalse(Son.DUEL_INTRO in o.sons())
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET), Ambiance.DUEL_PRESENTATION.volume(Lit.COMPLET))
        assertEquals(0f, Ambiance.DUEL_PRESENTATION.volume(Lit.DUEL))
    }

    @Test
    fun `un son long du Game Show lit son propre fichier`() {
        assertEquals("gs_duel_face", Son.DUEL_FACE.fichierLong(gameShow = true))
        assertEquals("lmp_drumroll_2b", Son.DUEL_FACE.fichierLong(gameShow = false))
        assertEquals("lmp_generique", Son.GENERIQUE.fichierLong(gameShow = true))
        // Chaque son long propre au Game Show existe bien dans l'appli.
        Son.entries.filter { it.long }.map { it.fichierLong(true) }.filter { it.startsWith("gs_") }.forEach { n ->
            assertTrue("$n manquant", java.io.File("src/main/res/raw").listFiles().orEmpty().any { it.nameWithoutExtension == n })
        }
    }

    @Test
    fun `Game Show, au buzz le mot de l equipe part tout de suite comme sur la tablette, le Classique garde son petit temps`() {
        for (gs in listOf(true, false)) {
            for (blind in listOf(false, true)) {
                val d = DirecteurSonore()
                val q = Instant(Ecran.QUESTION, partie = "ABCD", index = 9, equipes = 3, propositions = 0, jeuBuzz = true,
                    flou = !blind, blind = blind, musical = blind, gameShow = gs)
                d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 8, equipes = 3, gameShow = gs))
                d.observer(q)
                val mot = d.observer(q.copy(buzzEquipe = 2)).filterIsInstance<Ordre.Jouer>().single { it.son == Son.EQUIPE_3 }
                assertEquals("Game Show $gs, blind $blind", if (gs) 0L else Tempo.FLOU_EQUIPE, mot.dansMs)
            }
        }
    }

    @Test
    fun `presentation d'un jeu - la boucle fete par defaut, une boucle a soi pour les jeux qui en ont une`() {
        val blind = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "blind|", gameShow = true, famille = "blind")
        // La boucle « fête » de Digital Love sous les intros, sauf le Duel, le Simon et le Blind test (cedric, 29/10).
        listOf("juste", "inconnu", "").forEach {
            assertEquals(it, Ambiance.PRESENTATION, ambiancePresentation(blind.copy(famille = it)))
        }
        assertEquals(Ambiance.DUEL_PRESENTATION, ambiancePresentation(blind.copy(famille = "duel", duel = true)))
        assertEquals(Ambiance.SIMON_PRESENTATION, ambiancePresentation(blind.copy(famille = "simon", simon = true)))
        // Blind test : sa boucle d'Alan Braxe, en Game Show seulement, au volume des autres intros.
        assertEquals(Ambiance.BT_PRESENTATION, ambiancePresentation(blind))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(blind.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.BT_PRESENTATION.volume(Lit.BT_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.BT_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.BT_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.BT_INTRO.fichierPour(false))
        // Une autre table : seul le jeu nommé change.
        val propres = mapOf("zoom" to Ambiance.BT_ATTENTE)
        assertEquals(Ambiance.BT_ATTENTE, ambiancePresentation(blind.copy(famille = "zoom"), propres))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(blind, propres))
        // Le directeur suit la table, à l'arrivée sur l'intro.
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.BT_PRESENTATION, d.observer(blind).musique())
        assertEquals(Ambiance.PRESENTATION, DirecteurSonore().also { it.observer(salon.copy(gameShow = true, equipes = 2)) }.observer(blind.copy(famille = "juste")).musique())
        // Le fichier : 4 mesures à 123,91 BPM, 44,1 kHz stéréo, données jusqu'au bout du fichier.
        val wav = java.io.File("src/main/res/raw/gs_bt_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(4 * 4 * 60 / 123.91, e.images / 44_100.0, 0.001)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation de Chante le mot - sa boucle de La Vie en rose, au volume des autres intros`() {
        val chante = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "chante|", gameShow = true, famille = "chante")
        assertEquals("chante", familleType(com.littlemissparty.quiz.engine.QuestionKind.CHANTE))
        assertEquals(Ambiance.CHANTE_PRESENTATION, ambiancePresentation(chante))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(chante.copy(gameShow = false)))
        assertEquals(Ambiance.BT_PRESENTATION, ambiancePresentation(chante.copy(famille = "blind")))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(chante.copy(famille = "juste")))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.CHANTE_PRESENTATION.volume(Lit.CHANTE_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.CHANTE_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.CHANTE_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.CHANTE_INTRO.fichierPour(false))
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.CHANTE_PRESENTATION, d.observer(chante).musique())
        // Le fichier : 11,90 s, 44,1 kHz, données jusqu'au bout du fichier (pas de bloc ajouté après).
        val wav = java.io.File("src/main/res/raw/gs_chante_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(11.903, e.images / 44_100.0, 0.001)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation du Zoom mystere et de l'Image floue - la meme boucle de La Panthere rose`() {
        val zoom = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "zoom|", gameShow = true, famille = "zoom")
        assertEquals("zoom", familleType(com.littlemissparty.quiz.engine.QuestionKind.ZOOM))
        assertEquals("flou", familleType(com.littlemissparty.quiz.engine.QuestionKind.FLOU))
        assertEquals(Ambiance.ZOOM_PRESENTATION, ambiancePresentation(zoom))
        assertEquals(Ambiance.ZOOM_PRESENTATION, ambiancePresentation(zoom.copy(famille = "flou")))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(zoom.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(zoom.copy(famille = "juste")))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.ZOOM_PRESENTATION.volume(Lit.ZOOM_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.ZOOM_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.ZOOM_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.ZOOM_INTRO.fichierPour(false))
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.ZOOM_PRESENTATION, d.observer(zoom).musique())
        // Le fichier : 16,67 s, 44,1 kHz, données jusqu'au bout du fichier (pas de bloc ajouté après).
        val wav = java.io.File("src/main/res/raw/gs_zoom_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(16.67, e.images / 44_100.0, 0.01)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation de Qui a disparu - Mission Impossible, son debut une fois puis la boucle`() {
        val disparu = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "disparu|", gameShow = true, famille = "disparu")
        assertEquals("disparu", familleType(com.littlemissparty.quiz.engine.QuestionKind.DISPARU))
        assertEquals(Ambiance.DISPARU_PRESENTATION, ambiancePresentation(disparu))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(disparu.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.DISPARU_PRESENTATION.volume(Lit.DISPARU_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.DISPARU_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.DISPARU_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.DISPARU_INTRO.fichierPour(false))
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.DISPARU_PRESENTATION, d.observer(disparu).musique())
        // Le fichier (sans le silence du début, cedric 30/10) : 728 837 images (boucle D, 30/10), la boucle repart à l'échantillon 145 547.
        val wav = java.io.File("src/main/res/raw/gs_disparu_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(728_837L, e.images.toLong())
        assertEquals(145_547L, repriseEnImages(Lit.DISPARU_INTRO.repriseMs, Lit.DISPARU_INTRO.repriseImage, 44_100))
        // La reprise en millisecondes (lecture de secours) reste à moins d'une milliseconde.
        assertEquals(145_547.0, Lit.DISPARU_INTRO.repriseMs * 44.1, 44.1)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation du Chrono de Buzzy - Hung Up, son debut une fois puis la boucle, et ses bruitages avec la video`() {
        val chrono = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "chrono|", gameShow = true, famille = "chrono")
        assertEquals("chrono", familleType(com.littlemissparty.quiz.engine.QuestionKind.CHRONO))
        assertEquals("chrono", nomIntroJeu("chrono"))
        assertEquals(1f, volumeIntroJeu("chrono"), 0f)
        assertEquals(Ambiance.CHRONO_PRESENTATION, ambiancePresentation(chrono))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(chrono.copy(gameShow = false)))
        // Le fichier est livré déjà à ×0,5 (comme les autres intros une fois leur ambiance appliquée) : joué tel quel.
        assertEquals(1f, Ambiance.CHRONO_PRESENTATION.volume(Lit.CHRONO_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.CHRONO_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.CHRONO_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.CHRONO_INTRO.fichierPour(false))
        assertTrue(Lit.CHRONO_INTRO.departFranc)
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.CHRONO_PRESENTATION, d.observer(chrono).musique())
        // 7,737 s de début puis 15,347 s de boucle : 1 018 004 images, la boucle repart à l'échantillon 341 202.
        val wav = java.io.File("src/main/res/raw/gs_chrono_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(1_018_004L, e.images.toLong())
        assertEquals(341_202L, repriseEnImages(Lit.CHRONO_INTRO.repriseMs, Lit.CHRONO_INTRO.repriseImage, 44_100))
        assertEquals(341_202.0, Lit.CHRONO_INTRO.repriseMs * 44.1, 44.1)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation des Coffres mysteres - Pirates des Caraibes`() {
        val coffres = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "coffres|", gameShow = true, famille = "bombe")
        assertEquals("bombe", familleType(com.littlemissparty.quiz.engine.QuestionKind.COFFRES))
        assertEquals(Ambiance.COFFRES_PRESENTATION, ambiancePresentation(coffres))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(coffres.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(coffres.copy(famille = "juste")))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.COFFRES_PRESENTATION.volume(Lit.COFFRES_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.COFFRES_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.COFFRES_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.COFFRES_INTRO.fichierPour(false))
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.COFFRES_PRESENTATION, d.observer(coffres).musique())
        val wav = java.io.File("src/main/res/raw/gs_coffres_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(13.62, e.images / 44_100.0, 0.01)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation du Quiz et du Quiz illustre - Questions pour un champion, les trompettes une fois puis la boucle`() {
        val quiz = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "quiz|Quiz", gameShow = true, famille = "quiz")
        assertEquals(Ambiance.QUIZ_PRESENTATION, ambiancePresentation(quiz))
        // Le Quiz illustré a sa propre boucle depuis le 30/10 (Des chiffres et des lettres).
        assertEquals(Ambiance.ILLUSTRE_PRESENTATION, ambiancePresentation(quiz.copy(famille = "illustre")))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(quiz.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(quiz.copy(famille = "juste")))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.QUIZ_PRESENTATION.volume(Lit.QUIZ_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.QUIZ_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.QUIZ_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.QUIZ_INTRO.fichierPour(false))
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.QUIZ_PRESENTATION, d.observer(quiz).musique())
        val wav = java.io.File("src/main/res/raw/gs_quiz_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(562_998L, e.images)
        assertEquals(95_256L, Lit.QUIZ_INTRO.repriseMs * 44_100 / 1000)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation de Qui suis-je - Soul Bossa Nova`() {
        val quiSuis = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "quisuis|", gameShow = true, famille = "quisuis")
        assertEquals("quisuis", familleType(com.littlemissparty.quiz.engine.QuestionKind.QUISUIS))
        assertEquals(Ambiance.QUISUIS_PRESENTATION, ambiancePresentation(quiSuis))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(quiSuis.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.QUISUIS_PRESENTATION.volume(Lit.QUISUIS_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.QUISUIS_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.QUISUIS_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.QUISUIS_INTRO.fichierPour(false))
        assertEquals(0L, Lit.QUISUIS_INTRO.repriseMs)
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.QUISUIS_PRESENTATION, d.observer(quiSuis).musique())
        val wav = java.io.File("src/main/res/raw/gs_quisuisje_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(827_536L, e.images)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation du Vrai ou Faux express - Video Killed the Radio Star, le Oh-a-oh une fois puis la boucle`() {
        val vf = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "express|", gameShow = true, famille = "express")
        assertEquals("express", familleType(com.littlemissparty.quiz.engine.QuestionKind.EXPRESS))
        assertEquals(Ambiance.VRAIFAUX_PRESENTATION, ambiancePresentation(vf))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(vf.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(vf.copy(famille = "juste")))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.VRAIFAUX_PRESENTATION.volume(Lit.VRAIFAUX_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.VRAIFAUX_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.VRAIFAUX_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.VRAIFAUX_INTRO.fichierPour(false))
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.VRAIFAUX_PRESENTATION, d.observer(vf).musique())
        val wav = java.io.File("src/main/res/raw/gs_vraifaux_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(468_342L, e.images)
        assertEquals(305_706L, repriseEnImages(Lit.VRAIFAUX_INTRO.repriseMs, Lit.VRAIFAUX_INTRO.repriseImage, 44_100))
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation des Mimes - Just Because of You, boucle entiere`() {
        val mimes = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "mimes|", gameShow = true, famille = "mimes")
        assertEquals("mimes", familleType(com.littlemissparty.quiz.engine.QuestionKind.MIME))
        assertEquals(Ambiance.MIMES_PRESENTATION, ambiancePresentation(mimes))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(mimes.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.MIMES_PRESENTATION.volume(Lit.MIMES_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.MIMES_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.MIMES_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.MIMES_INTRO.fichierPour(false))
        assertEquals(0L, Lit.MIMES_INTRO.repriseMs)
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.MIMES_PRESENTATION, d.observer(mimes).musique())
        val wav = java.io.File("src/main/res/raw/gs_mimes_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(367_927L, e.images)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation des Statues musicales - U Can't Touch This, boucle entiere`() {
        val statues = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "statues|", gameShow = true, famille = "statues")
        assertEquals(Ambiance.STATUES_PRESENTATION, ambiancePresentation(statues))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(statues.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.STATUES_PRESENTATION.volume(Lit.STATUES_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.STATUES_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.STATUES_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.STATUES_INTRO.fichierPour(false))
        assertEquals(0L, Lit.STATUES_INTRO.repriseMs)
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.STATUES_PRESENTATION, d.observer(statues).musique())
        val wav = java.io.File("src/main/res/raw/gs_statues_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(636_307L, e.images)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation du Gonfleur fou - Dont you know une fois, puis la boucle au raccord adouci`() {
        val gonfleur = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "gonfleur|", gameShow = true, famille = "gonfleur")
        assertEquals(Ambiance.GONFLEUR_PRESENTATION, ambiancePresentation(gonfleur))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(gonfleur.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.GONFLEUR_PRESENTATION.volume(Lit.GONFLEUR_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.GONFLEUR_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.GONFLEUR_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.GONFLEUR_INTRO.fichierPour(false))
        assertEquals(327_222L, repriseEnImages(Lit.GONFLEUR_INTRO.repriseMs, Lit.GONFLEUR_INTRO.repriseImage, 44_100))
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.GONFLEUR_PRESENTATION, d.observer(gonfleur).musique())
        val wav = java.io.File("src/main/res/raw/gs_gonfleur_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(654_444L, e.images)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `chaque musique d'intro part du tout debut de son fichier, jamais calee au milieu sur le tempo commun`() {
        // Une boucle de 16 s (± 250 ms) se cale sur le tempo commun des fonds ; les autres partent de leur début
        // (BouclePcm.ouvrir : periodeMs). Les musiques d'intro doivent toutes partir du début (cedric, 30/10).
        val intros = Lit.entries.filter { it.name.endsWith("_INTRO") }
        assertTrue(intros.size >= 14)
        intros.forEach { l ->
            val wav = java.io.File("src/main/res/raw/${l.gs}.wav").readBytes()
            val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
            assertTrue("${l.name} : ${e.dureeMs} ms", kotlin.math.abs(e.dureeMs - 16_000L) > 250)
            assertTrue("${l.name} : reprise après la fin", repriseEnImages(l.repriseMs, l.repriseImage, e.frequence) < e.images)
        }
    }

    @Test
    fun `presentation du Quiz illustre - Des chiffres et des lettres, boucle entiere, le Quiz garde Questions pour un champion`() {
        val illustre = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "illustre|", gameShow = true, famille = "illustre")
        assertEquals(Ambiance.ILLUSTRE_PRESENTATION, ambiancePresentation(illustre))
        assertEquals(Ambiance.QUIZ_PRESENTATION, ambiancePresentation(illustre.copy(famille = "quiz")))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(illustre.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.ILLUSTRE_PRESENTATION.volume(Lit.ILLUSTRE_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.ILLUSTRE_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.ILLUSTRE_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.ILLUSTRE_INTRO.fichierPour(false))
        assertEquals(0L, Lit.ILLUSTRE_INTRO.repriseMs)
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.ILLUSTRE_PRESENTATION, d.observer(illustre).musique())
        val wav = java.io.File("src/main/res/raw/gs_quizillustre_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(840_186L, e.images)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation du Quiz musical - Lady de Modjo, boucle entiere, depuis le debut`() {
        val musical = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "quiz|", gameShow = true, famille = "musical")
        assertEquals(Ambiance.MUSICAL_PRESENTATION, ambiancePresentation(musical))
        assertEquals(Ambiance.QUIZ_PRESENTATION, ambiancePresentation(musical.copy(famille = "quiz")))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(musical.copy(gameShow = false)))
        assertEquals("musical", familleType(null, musique = true))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.MUSICAL_PRESENTATION.volume(Lit.MUSICAL_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.MUSICAL_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.MUSICAL_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.MUSICAL_INTRO.fichierPour(false))
        assertEquals(0L, Lit.MUSICAL_INTRO.repriseMs)
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.MUSICAL_PRESENTATION, d.observer(musical).musique())
        val wav = java.io.File("src/main/res/raw/gs_quizmusical_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(671_940L, e.images)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `intro d'un jeu - sa musique part du debut de son fichier, sans fondu, en meme temps que la video qui l'attend`() {
        // cedric, 30/10 : « tout commencera précisément au début de la boucle », et le petit début joué une fois part avec la vidéo.
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        val lancee = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 0, equipes = 2, epreuve = "quiz|Quiz", gameShow = true, famille = "quiz")
        d.observer(lancee.copy(lancement = true))
        // Premier jeu, juste après la grande intro (pas de rideau) : la musique attend que la vidéo soit prête.
        assertEquals(
            listOf(Ordre.Couper, Ordre.Jouer(Son.WHOOSH), Ordre.Musique(Ambiance.SILENCE), Ordre.Caler(Tempo.INTRO_MUSIQUE), Ordre.Musique(Ambiance.QUIZ_PRESENTATION, Tempo.INTRO_MUSIQUE)),
            d.observer(lancee),
        )
        d.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = 0, equipes = 2, epreuve = "quiz|Quiz", gameShow = true, famille = "quiz"))
        // Jeu suivant : le jingle du rideau, puis la musique d'intro, repartie de sa première mesure.
        val vf = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 8, equipes = 2, epreuve = "express|", gameShow = true, famille = "express")
        assertEquals(
            listOf(Ordre.Couper, Ordre.Jouer(Son.TRANSITION), Ordre.Musique(Ambiance.SILENCE), Ordre.Caler(Tempo.TRANSITION_MUSIQUE), Ordre.Musique(Ambiance.VRAIFAUX_PRESENTATION, Tempo.TRANSITION_MUSIQUE)),
            d.observer(vf),
        )
        assertTrue(Tempo.INTRO_MUSIQUE >= DELAI_INTRO_JEU_MS + 500)
        // Le Pictionary (Take On Me) : même départ calé.
        d.observer(vf.copy(ecran = Ecran.QUESTION))
        val patate = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 12, equipes = 2, epreuve = "picto|", gameShow = true, famille = "pictionary")
        val o = d.observer(patate)
        assertTrue(Ordre.Caler(Tempo.TRANSITION_MUSIQUE) in o)
        assertEquals(Ordre.Musique(Ambiance.PICTO_PRESENTATION, Tempo.TRANSITION_MUSIQUE), o.last())
        // Sans intro vidéo (Juste Chiffre, famille inconnue), en Classique, au Duel et au Simon : comme avant, sans calage.
        listOf(
            patate.copy(index = 14, epreuve = "juste|", famille = "juste"),
            patate.copy(index = 16, epreuve = "inconnu|", famille = "inconnu"),
            patate.copy(index = 18, epreuve = "duel|", famille = "duel", duel = true),
        ).forEach { i ->
            // Après un autre jeu : c'est bien un nouveau jeu, avec son rideau.
            d.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = i.index - 1, equipes = 2, epreuve = "quiz|Q${i.index}", gameShow = true, famille = "quiz"))
            val arrivee = d.observer(i)
            assertTrue(i.famille, Son.TRANSITION in arrivee.sons() || i.duel)
            assertTrue(i.famille, arrivee.none { it is Ordre.Caler && it.dansMs == Tempo.TRANSITION_MUSIQUE })
        }
        // Le Simon (cedric, 30/10 : sa vidéo ne partait pas sur le début de sa boucle) : calé lui aussi.
        d.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = 21, equipes = 2, epreuve = "quiz|Q22", gameShow = true, famille = "quiz"))
        val simon = d.observer(patate.copy(index = 22, epreuve = "simon|", famille = "simon", simon = true))
        assertTrue(Ordre.Caler(Tempo.TRANSITION_MUSIQUE) in simon)
        assertEquals(Ordre.Musique(Ambiance.SIMON_PRESENTATION, Tempo.TRANSITION_MUSIQUE), simon.last())
        val classique = DirecteurSonore()
        classique.observer(salon.copy(equipes = 2))
        classique.observer(lancee.copy(gameShow = false, ecran = Ecran.QUESTION))
        assertTrue(classique.observer(vf.copy(gameShow = false)).none { it is Ordre.Caler })
    }

    @Test
    fun `intro d'un jeu - chaque musique de presentation fait attendre la video, chaque musique d'intro part sans fondu`() {
        PRESENTATIONS_PROPRES.values.forEach { assertTrue("$it", it.presentation) }
        assertTrue(Ambiance.PRESENTATION.presentation)
        assertTrue(Ambiance.SIMON_PRESENTATION.presentation)
        listOf(Ambiance.DUEL_PRESENTATION, Ambiance.SIMON_ENTRE, Ambiance.QUESTION, Ambiance.SALON, Ambiance.SILENCE).forEach { assertFalse("$it", it.presentation) }
        // Toutes les boucles des présentations propres partent franc ; la « fête » (partout ailleurs aussi) garde son fondu.
        PRESENTATIONS_PROPRES.values.forEach { a -> Lit.entries.filter { a.volume(it, gs = true) > 0f }.forEach { assertTrue("$a $it", it.departFranc) } }
        assertFalse(Lit.COMPLET.departFranc)
        assertFalse(Lit.BT_ATTENTE.departFranc)
        // Toutes les familles qui ont une musique propre ont une intro vidéo (sinon personne ne l'attendrait).
        PRESENTATIONS_PROPRES.keys.forEach { assertNotNull(it, nomIntroJeu(it)) }
    }

    @Test
    fun `intro d'un jeu - l'attente de la video jusqu'au depart de sa musique`() {
        // Musique prévue dans 1,7 s, entendue 80 ms après son départ : la vidéo attend 1,78 s.
        assertEquals(1_780, attenteIntro(a = 10_000L, maintenant = 8_300L, latence = 80L))
        // Latence pas encore mesurée : on ne compte qu'à partir du départ.
        assertEquals(1_700, attenteIntro(a = 10_000L, maintenant = 8_300L, latence = -1L))
        // Musique déjà partie (vidéo lente, ou relancée) : elle démarre tout de suite.
        assertEquals(0, attenteIntro(a = 10_000L, maintenant = 12_000L, latence = 80L))
        // Aucune musique prévue (coupée) : aucune attente.
        assertEquals(0, attenteIntro(a = 0L, maintenant = 12_000L, latence = 80L))
        // Jamais plus de 3 s, même avec une horloge folle.
        assertEquals(ATTENTE_INTRO_MAX_MS.toInt(), attenteIntro(a = 100_000L, maintenant = 1_000L, latence = 80L))
        // Latence aberrante plafonnée.
        assertEquals(1_700 + BouclePcm.LATENCE_MAX_MS.toInt(), attenteIntro(a = 10_000L, maintenant = 8_300L, latence = 99_999L))
    }

    @Test
    fun `presentation de Ca va exploser - James Bond, boucle entiere, depuis le debut`() {
        val patate = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "patate|", gameShow = true, famille = "patate")
        assertEquals(Ambiance.PATATE_PRESENTATION, ambiancePresentation(patate))
        assertEquals("patate", familleType(com.littlemissparty.quiz.engine.QuestionKind.PATATE))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(patate.copy(gameShow = false)))
        assertEquals(Ambiance.PICTO_PRESENTATION, ambiancePresentation(patate.copy(famille = "pictionary")))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.PATATE_PRESENTATION.volume(Lit.PATATE_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.PATATE_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.PATATE_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.PATATE_INTRO.fichierPour(false))
        assertEquals(0L, Lit.PATATE_INTRO.repriseMs)
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.PATATE_PRESENTATION, d.observer(patate).musique())
        val wav = java.io.File("src/main/res/raw/gs_explose_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(649_968L, e.images)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation du Pictionary - Take On Me, boucle entiere, depuis le debut`() {
        val picto = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 2, epreuve = "picto|", gameShow = true, famille = "pictionary")
        assertEquals(Ambiance.PICTO_PRESENTATION, ambiancePresentation(picto))
        assertEquals("picto", nomIntroJeu("pictionary"))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(picto.copy(gameShow = false)))
        assertEquals(Ambiance.PRESENTATION, ambiancePresentation(picto.copy(famille = "juste")))
        assertEquals(Ambiance.PRESENTATION.volume(Lit.COMPLET, gs = true), Ambiance.PICTO_PRESENTATION.volume(Lit.PICTO_INTRO, gs = true), 0f)
        Lit.entries.filter { it != Lit.PICTO_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.PICTO_PRESENTATION.volume(it, gs = true), 0f) }
        assertNull(Lit.PICTO_INTRO.fichierPour(false))
        assertEquals(0L, Lit.PICTO_INTRO.repriseMs)
        assertTrue(Lit.PICTO_INTRO.departFranc)
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true, equipes = 2))
        assertEquals(Ambiance.PICTO_PRESENTATION, d.observer(picto).musique())
        val wav = java.io.File("src/main/res/raw/gs_picto_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(250_929L, e.images)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `presentation du Simon - la douce partie sur son temps fort, seulement sous l'intro, au meme volume`() {
        val simon = Instant(Ecran.PRESENTATION, partie = "ABCD", index = 3, equipes = 4, epreuve = "simon|", simon = true, gameShow = true, famille = "simon")
        assertEquals(Ambiance.SIMON_PRESENTATION, ambiancePresentation(simon))
        assertEquals(Ambiance.SIMON_PRESENTATION.volume(Lit.SIMON_INTRO, gs = true), Ambiance.SIMON_ENTRE.volume(Lit.SIMON_DOUCE, gs = true), 0f)
        Lit.entries.filter { it != Lit.SIMON_INTRO }.forEach { assertEquals("$it", 0f, Ambiance.SIMON_PRESENTATION.volume(it, gs = true), 0f) }
        assertTrue(Lit.SIMON_INTRO.departFranc)
        assertNull(Lit.SIMON_INTRO.fichierPour(false))
        assertEquals(0L, Lit.SIMON_INTRO.repriseMs)
        // Le jeu lui-même garde la douce d'avant entre deux suites.
        val d = DirecteurSonore()
        d.observer(salon.copy(gameShow = true))
        assertEquals(Ambiance.SIMON_PRESENTATION, d.observer(simon).musique())
        assertEquals(Ambiance.SIMON_ENTRE, d.observer(simon.copy(ecran = Ecran.QUESTION)).musique())
        val wav = java.io.File("src/main/res/raw/gs_simon_intro.wav").readBytes()
        val e = lireEnteteWav(wav.copyOf(512), wav.size.toLong())!!
        assertEquals(44_100, e.frequence)
        assertEquals(662_146L, e.images)
        assertEquals(wav.size.toLong(), e.debutDonnees + e.octetsDonnees)
    }

    @Test
    fun `reprise d'une boucle - a l'echantillon pres quand elle est donnee, sinon en millisecondes`() {
        assertEquals(305_706L, repriseEnImages(6_932L, 305_706L, 44_100))
        assertEquals(95_256L, repriseEnImages(2_160L, 0L, 44_100))
        assertEquals(0L, repriseEnImages(0L, 0L, 44_100))
        Lit.entries.filter { it.repriseImage > 0 }.forEach { assertEquals("$it", it.repriseImage.toDouble(), it.repriseMs * 44.1, 44.1) }
    }

    @Test
    fun `jeux au buzzer, la nappe de suspense tourne en boucle tant que l'equipe a la parole, meme apres une pause`() {
        // Test du 31/10 au soir : la nappe (12 s) ne jouait qu'une fois, puis silence jusqu'au ✓ ou ✗ de Sarah.
        for (jeu in listOf("disparu", "flou", "quisuis")) {
            val d = DirecteurSonore()
            val base = Instant(Ecran.QUESTION, partie = "ABCD", index = 9, equipes = 3, propositions = 0, jeuBuzz = true, gameShow = true,
                flou = jeu == "flou", quiSuis = jeu == "quisuis", disparu = if (jeu == "disparu") DISPARU_CHERCHER else 0)
            d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 8, equipes = 3, gameShow = true))
            d.observer(base)
            val buzz = d.observer(base.copy(buzzEquipe = 1))
            // Le buzz et le mot de l'équipe d'abord, puis la nappe (une boucle, plus un son joué une fois) qui part net.
            assertTrue(jeu, Son.BUZZ_GROS in buzz.sons())
            assertEquals(jeu, Ordre.Musique(Ambiance.PAROLE, Tempo.FLOU_SUSPENSE, 0), buzz.filterIsInstance<Ordre.Musique>().last())
            // Pause pendant la réponse, puis reprise : la nappe revient (jamais le silence).
            d.observer(base.copy(buzzEquipe = 1, enPause = true))
            assertEquals(jeu, Ambiance.PAROLE, d.observer(base.copy(buzzEquipe = 1, repriseDansMs = 3_000)).musique())
            // Raté : la nappe s'arrête, la musique du jeu revient.
            val rate = d.observer(base.copy(ratees = 1))
            assertTrue(jeu, rate.filterIsInstance<Ordre.Musique>().none { it.ambiance == Ambiance.PAROLE })
        }
        // La nappe ne joue que dans son ambiance, dans les deux designs.
        Lit.entries.forEach { l ->
            assertEquals("$l", if (l == Lit.PAROLE) 1f else 0f, Ambiance.PAROLE.volume(l, gs = true), 0f)
            assertEquals("$l", if (l == Lit.PAROLE) 1f else 0f, Ambiance.PAROLE.volume(l, gs = false), 0f)
        }
        assertEquals(0f, Ambiance.SUSPENSE.volume(Lit.PAROLE, gs = true), 0f)
    }

    @Test
    fun `nappe de suspense, la boucle repart sans saut ni a-coup de volume`() {
        // Les tests JVM d'Android tournent depuis le dossier du module tv/.
        val octets = java.io.File("src/main/res/raw/gs_suspense_parole.wav").readBytes()
        val e = lireEnteteWav(octets.copyOf(512), octets.size.toLong())!!
        assertEquals(44_100, e.frequence)
        // Sa propre longueur (20 s), loin des 16 s du tempo commun : elle part toujours de son début, à chaque buzz.
        assertTrue("durée ${e.dureeMs}", kotlin.math.abs(e.dureeMs - 16_000) > 1_000)
        val pcm = java.nio.ByteBuffer.wrap(octets, e.debutDonnees.toInt(), e.octetsDonnees.toInt()).order(java.nio.ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val n = pcm.remaining() / 2
        fun g(i: Int) = (pcm.get(2 * i) + pcm.get(2 * i + 1)) / 2.0
        val reprise = (PAROLE_REPRISE_MS * 44_100 / 1000).toInt()
        assertTrue(reprise in 1 until n)
        // Raccord : la dernière image enchaîne sur l'image de reprise comme deux images voisines du fichier.
        val saut = kotlin.math.abs(g(n - 1) - g(reprise))
        val pasMax = (reprise until n - 1).maxOf { kotlin.math.abs(g(it + 1) - g(it)) }
        assertTrue("saut au raccord $saut (pas max $pasMax)", saut <= pasMax)
        // Même niveau au début et à la fin de la partie qui tourne (à 1 dB près) : pas d'à-coup à chaque tour.
        fun rms(a: Int, b: Int) = kotlin.math.sqrt((a until b).sumOf { g(it) * g(it) } / (b - a))
        val seconde = 44_100
        val db = 20 * kotlin.math.log10(rms(n - seconde, n) / rms(reprise, reprise + seconde))
        assertTrue("écart $db dB", kotlin.math.abs(db) < 1.0)
    }
}
