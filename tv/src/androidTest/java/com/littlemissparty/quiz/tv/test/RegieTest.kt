package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.engine.POTATO_BOMBS
import com.littlemissparty.quiz.engine.POTATO_POINTS
import com.littlemissparty.quiz.engine.PUMP_TARGET
import com.littlemissparty.quiz.engine.Scoring
import com.littlemissparty.quiz.tv.habillage.Look
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Une vraie petite image (PNG d'un pixel), comme celles que l'admin prépare. */
private const val PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

/** La régie sur le téléphone de l'animatrice : connexion par mot de passe commun et pilotage de la TV. */
@RunWith(AndroidJUnit4::class)
class RegieTest : TestTv() {

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @Test
    fun connexionParMotDePassePuisPartiePiloteeDuTelephone() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue("Le bon mot de passe doit relier la régie", regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        ecran.voit("Régie reliée")
        assertTrue("La régie lit le conducteur (bonnes réponses)", regie.lireConducteur(code))
        ecran.capture("regie-reliee")

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Quiz · question 1 / ")
        val q = attendreQuestion(licornes, code, 0)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Voir les scores")
        val avant = points(licornes, code, licornes.uid)
        assertTrue(avant >= Scoring.BASE)

        // Correction de score depuis la régie : la TV l'annonce en grand, avec le montant exact, puis
        // l'animation s'efface d'elle-même (2 s : on la guette dès l'envoi).
        val bonus = regie.envoyer(code, "adjust", extra = mapOf("team" to licornes.uid, "delta" to 50))!!
        ecran.apercoit("+50 POINTS")
        ecran.apercoit("BONUS !", 1_000)
        assertEquals("applied", regie.verdict(code, bonus))
        attendreQue("correction publiée") { points(licornes, code, licornes.uid).takeIf { it == avant + 50 } }
        ecran.neVoitPas("BONUS !", 6_000)
        ecran.capture("apres-correction")
        // Malus : montant exact aussi, et le jeu continue dessous.
        val malus = regie.envoyer(code, "adjust", extra = mapOf("team" to licornes.uid, "delta" to -30))!!
        ecran.apercoit("−30 POINTS")
        ecran.apercoit("MALUS !", 1_000)
        assertEquals("applied", regie.verdict(code, malus))
        ecran.neVoitPas("MALUS !", 6_000)
        ecran.voit("Voir les scores")
        attendreQue("malus publié") { points(licornes, code, licornes.uid).takeIf { it == avant + 20 } }
        // Une validation = une seule animation : rien ne revient ensuite.
        Thread.sleep(3_000)
        assertFalse("Aucune animation rejouée", ecran.affiche("BONUS !") || ecran.affiche("MALUS !"))
    }

    /**
     * Entrée des équipes (cedric, 24/10) : tant que la régie n'est pas reliée, la box dit aux tablettes d'attendre ;
     * ensuite la tablette demande sans nom ni couleur, et l'équipe naît avec le nom et la couleur que l'animatrice a
     * choisis sur son téléphone (une couleur déjà prise est remplacée par une libre).
     */
    @Test
    fun entreeDesEquipesParLaRegie() {
        val code = lancerBoite()
        attendreQue("régie fermée publiée par la box") { Boite.controle.lire("games/$code/regieActive").takeIf { it == false } }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        attendreQue("régie ouverte publiée par la box") { Boite.controle.lire("games/$code/regieActive").takeIf { it == true } }
        val licornes = pupitre("licornes").also { it.demanderAEntrer(code) }
        assertEquals("applied", regie.commande(code, "admit", mapOf("device" to licornes.uid, "name" to "Les Licornes", "color" to VERT)))
        attendreQue("équipe inscrite") { Boite.controle.lire("games/$code/teams/${licornes.uid}/name").takeIf { it == "Les Licornes" } }
        assertEquals(VERT, Boite.controle.lire("games/$code/teams/${licornes.uid}/color"))
        // Demande lisible seulement par sa tablette : lue avec l'accès « owner » de l'émulateur.
        assertEquals("la demande est effacée", "null", Proprietaire.lire("games/$code/joinRequests/${licornes.uid}").trim())
        ecran.voit("1 équipe(s) dans la partie")
        // Même couleur demandée pour une deuxième équipe : la box en donne une autre, jamais deux équipes pareilles.
        val dragons = pupitre("dragons").also { it.demanderAEntrer(code) }
        assertEquals("applied", regie.commande(code, "admit", mapOf("device" to dragons.uid, "name" to "Les Dragons", "color" to VERT)))
        val couleur = attendreQue("deuxième équipe") { Boite.controle.lire("games/$code/teams/${dragons.uid}/color") as? String }
        assertTrue("couleur différente : $couleur", !couleur.equals(VERT, ignoreCase = true))
        ecran.voit("2 équipe(s) dans la partie")
        // Sans nom : refusée, la tablette attend toujours.
        val chats = pupitre("chats").also { it.demanderAEntrer(code) }
        val sansNom = regie.envoyer(code, "admit", extra = mapOf("device" to chats.uid))!!
        assertEquals("refused", regie.verdict(code, sansNom))
        assertEquals("no_name", regie.raison(code, sansNom))
        assertNull(Boite.controle.lire("games/$code/teams/${chats.uid}"))
    }

    @Test
    fun mauvaisMotDePasseRefuse() {
        val code = lancerBoite()
        pupitre("licornes").rejoindre(code, "Licornes", VERT)
        val regie = regie()
        assertFalse("Un mauvais mot de passe ne doit pas relier la régie", regie.connecter(code, "pas-le-bon-mot"))
        assertNull("Une régie non reliée ne peut pas envoyer de commande", regie.envoyer(code, "next"))
        assertFalse("Une régie non reliée ne lit pas les bonnes réponses", regie.lireConducteur(code))
        assertFalse(ecran.affiche("Régie reliée"))
        // La TV n'a pas bougé : toujours au salon.
        ecran.voit("1 équipe(s) dans la partie")
    }

    @Test
    fun doubleCommandeNAvanceQuUneSeuleFois() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))

        // Double appui sur « Suivant » : deux commandes avec la même étape affichée.
        val etape = regie.etape(code)
        val premiere = regie.envoyer(code, "next", etape)!!
        val seconde = regie.envoyer(code, "next", etape)!!
        assertEquals("applied", regie.verdict(code, premiere))
        assertEquals("stale", regie.verdict(code, seconde))

        attendreQuestion(licornes, code, 0)
        Thread.sleep(1_000)
        assertEquals("La question doit rester ouverte", "question", licornes.etat(code).child("phase").value)
        ecran.voit("Arrêter le chrono")
    }

    @Test
    fun jeuAjouteEnPleineQuestionSansToucherALaPartie() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        assertEquals("applied", regie.commande(code, "next"))
        val q = attendreQuestion(licornes, code, 0)

        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val version = regie.programme(code)["rev"] as String
        val ajout = mapOf(
            "id" to "a1q1", "text" to "Question ajoutée pendant la partie ?", "choices" to listOf("Oui", "Non"),
            "correct" to 0, "duration" to 20, "kind" to "classic", "double" to false, "round" to "Bonus",
        )
        // La question en cours ne peut pas disparaître du programme.
        assertEquals("current_round", regie.modifierProgramme(code, version, avant.drop(1)))
        assertEquals("applied", regie.modifierProgramme(code, version, avant + ajout))
        ecran.voit("Quiz · question 1 / ${avant.size}")
        // Préparé sur l'ancienne version (deuxième téléphone en retard) : refusé, rien ne bouge.
        assertEquals("stale", regie.modifierProgramme(code, version, avant))

        assertEquals("question", licornes.etat(code).child("phase").value)
        assertEquals(q.id, licornes.etat(code).child("qid").value)
        assertEquals((avant.size + 1).toLong(), licornes.etat(code).child("total").value)
        assertTrue("La partie continue normalement", licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.capture("jeu-ajoute")
    }

    @Test
    fun mimesPilotesDepuisLaRegie() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))

        // Manche de mimes placée en tête du programme depuis le salon d'attente.
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val mimes = mapOf(
            "id" to "a1m", "text" to "Animaux", "kind" to "mime", "duration" to 60, "round" to "Animaux",
            "cards" to listOf(mapOf("word" to "Chat", "image" to "🐱"), mapOf("word" to "Lion", "image" to "🦁")),
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(mimes) + avant))

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Les Mimes !")
        assertEquals("applied", regie.commande(code, "mime_start", mapOf("team" to licornes.uid)))
        ecran.voit("Au tour de Licornes")
        ecran.voit("Chat")
        ecran.capture("mimes-tour")

        assertEquals("applied", regie.commande(code, "mime_found"))
        // Roulement (cedric, 24/10) : changement de joueur, l'image suivante attend « Image suivante » de la régie.
        ecran.voit("Dos à l'écran !")
        ecran.neVoitPas("Lion")
        ecran.capture("mimes-changement-de-joueur")
        assertEquals("Pas d'image : un double appui ne compte pas", "refused", regie.commande(code, "mime_found"))
        assertEquals("applied", regie.commande(code, "mime_pass"))
        ecran.voit("Lion")
        assertEquals("applied", regie.commande(code, "mime_stop"))
        ecran.voit("Bravo Licornes")

        // Entre deux tours, « Suivant » termine la manche : le mime trouvé compte au classement.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Après les mimes")
        assertEquals(Scoring.MIME.toLong(), points(licornes, code, licornes.uid))
        ecran.capture("mimes-classement")
    }

    /**
     * Mimes à 6 équipes, mot sur deux lignes (cedric, 24/10 : « Image suivante » rogné en bas à droite) : la carte
     * rapetisse s'il le faut, les boutons de l'animatrice et le mot restent entiers.
     */
    @Test
    fun mimesBoutonsEntiersAvecBeaucoupDEquipes() {
        val code = lancerBoite()
        val couleurs = listOf(VERT, ROSE, "#FF6B1A", "#FFE600", "#2D7BFF", "#A64DFF")
        val equipes = listOf("Licornes", "Dragons", "Pirates", "Fusées", "Tigres", "Étoiles").mapIndexed { i, nom ->
            pupitre("equipe$i").also { it.rejoindre(code, nom, couleurs[i]) }
        }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val mot = "Un hippopotame qui fait du ski"
        val mimes = mapOf(
            "id" to "a1m", "text" to "Animaux", "kind" to "mime", "duration" to 60, "round" to "Animaux",
            "cards" to listOf(mapOf("word" to mot, "image" to "🦛"), mapOf("word" to "Lion", "image" to "🦁")),
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(mimes) + avant))
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Les Mimes !")
        assertEquals("applied", regie.commande(code, "mime_start", mapOf("team" to equipes[0].uid)))
        ecran.voit("Au tour de Licornes")
        ecran.entierementVisible("Image suivante")
        ecran.entierementVisible("Trouvé !")
        ecran.entierementVisible("Arrêter le tour")
        ecran.capture("mimes-6-equipes-tour")
        assertEquals("applied", regie.commande(code, "mime_found"))
        ecran.voit("Dos à l'écran !")
        ecran.entierementVisible("Image suivante")
        ecran.capture("mimes-6-equipes-changement")
    }

    /** Le scénario du premier vrai test de cedric : un quiz, puis les mimes, puis le classement et le jeu suivant. */
    @Test
    fun quizPuisMimesPuisJeuSuivantPuisRejouer() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val mimes = mapOf(
            "id" to "a1m", "text" to "Animaux", "kind" to "mime", "duration" to 60, "round" to "Animaux",
            "cards" to listOf(mapOf("word" to "Chat", "image" to "🐱")),
        )
        val programme = listOf(demo[0] + ("round" to "Quiz"), mimes, demo[1] + ("round" to "Finale"))
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, programme))

        // Quiz : une question jouée jusqu'au classement.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Quiz · question 1 / 1")
        attendreQue("question 1 ouverte") { licornes.etat(code).takeIf { it.child("qid").value == demo[0]["id"] } }
        assertTrue(licornes.repondre(code, demo[0]["id"] as String, (demo[0]["correct"] as Number).toInt()))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit(titreClassement())
        // Fin du quiz : la TV annonce le jeu suivant au lieu de « Question suivante » (bug n° 8).
        ecran.voit("Jeu suivant : Mimes")
        val apresQuiz = points(licornes, code, licornes.uid)
        assertTrue("La bonne réponse rapporte des points", apresQuiz >= Scoring.BASE)

        // Fin du quiz : « suivant » enchaîne sur les mimes, sans rien bloquer.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Les Mimes !")
        assertEquals("applied", regie.commande(code, "mime_start", mapOf("team" to licornes.uid)))
        ecran.voit("Chat")
        assertEquals("applied", regie.commande(code, "mime_found"))
        ecran.voit("Bravo Licornes")
        // Toutes les équipes sont passées : la TV propose le classement.
        ecran.voit("Voir le classement")
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Après les mimes")
        ecran.voit("Jeu suivant : Finale")
        assertEquals(apresQuiz + Scoring.MIME, points(licornes, code, licornes.uid))

        // Jeu suivant : la finale s'ouvre avec les mêmes équipes et les mêmes scores.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Finale · question 1 / 1")
        assertEquals(apresQuiz + Scoring.MIME, points(licornes, code, licornes.uid))
        ecran.capture("quiz-mimes-finale")

        // Secours depuis la finale en cours : bilan des scores d'abord (cedric, 24/10), points intacts ; puis « Jeu
        // suivant » rejoue le quiz, ses points retirés (pas de double compte), les mimes restent.
        assertEquals("applied", regie.commande(code, "goto", mapOf("index" to 0, "qid" to demo[0]["id"] as String)))
        ecran.voit("Jeu suivant : Quiz")
        ecran.capture("bilan-jeu-quitte")
        assertEquals(apresQuiz + Scoring.MIME, points(licornes, code, licornes.uid))
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Quiz · question 1 / 1")
        attendreQue("points du quiz retirés") { points(licornes, code, licornes.uid).takeIf { it == Scoring.MIME.toLong() } }
        assertTrue("La tablette peut répondre de nouveau", licornes.repondre(code, demo[0]["id"] as String, (demo[0]["correct"] as Number).toInt()))
        ecran.voit("Toutes les équipes ont répondu")
    }

    /**
     * Pictionary en premier jeu, puis les mimes, puis le quiz : un autre ordre que le test précédent, et deux jeux à
     * tour de rôle d'affilée (ils partagent la même mécanique : rien ne doit déborder de l'un sur l'autre).
     */
    @Test
    fun pictionaryPuisMimesPuisQuizSansRienBloquer() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val picto = mapOf(
            "id" to "a1p", "text" to "Pictionary", "kind" to "pictionary", "duration" to 60, "round" to "Pictionary",
            "points" to Scoring.PICTO,
            "cards" to listOf(
                mapOf("word" to "Soleil", "image" to "☀️"), mapOf("word" to "Maison", "image" to "🏠"),
                mapOf("word" to "Bateau", "image" to "⛵"), mapOf("word" to "Pomme", "image" to "🍎"),
            ),
        )
        val mimes = mapOf(
            "id" to "a2m", "text" to "Animaux", "kind" to "mime", "duration" to 60, "round" to "Animaux",
            "cards" to listOf(mapOf("word" to "Chat", "image" to "🐱")),
        )
        val programme = listOf(picto, mimes, demo[0] + ("round" to "Quiz"))
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, programme))

        // Pictionary : l'intro, puis Sarah montre 3 mots au dessinateur des Licornes.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("PICTIONARY")
        ecran.voit("Pictionary !")
        assertEquals("applied", regie.commande(code, "picto_show", mapOf("team" to licornes.uid)))
        ecran.voit("Au tour de")
        ecran.voit("Toute l'équipe se retourne")
        attendreQue("3 mots proposés") { licornes.etat(code).child("mime/offer").childrenCount.takeIf { it == 3L } }
        // Tant que le mot n'est pas choisi, « on dessine » est refusé ; seule la tablette du dessinateur choisit.
        assertEquals("refused", regie.commande(code, "picto_draw"))
        assertFalse("Une autre équipe ne choisit pas le mot", dragons.choisirMot(code, 0))
        assertTrue(licornes.choisirMot(code, 1))
        attendreQue("choix reçu par la box") { licornes.etat(code).child("mime/chosen").value?.takeIf { (it as Number).toInt() == 1 } }
        ecran.voit("découvre son mot secret")
        ecran.neVoitPas("MAISON")
        ecran.capture("pictionary-choix")

        // Le dessin part de la tablette et s'affiche en direct sur la TV ; les autres tablettes ne dessinent pas.
        assertEquals("applied", regie.commande(code, "picto_draw"))
        ecran.voit("dessine !")
        ecran.voit("Dessin en direct · 0 traits")
        assertTrue(licornes.dessiner(code, "100,100 200,200 300,250"))
        assertTrue(licornes.dessiner(code, "300,250 420,310", couleur = "#2B86C5", epaisseur = 2))
        assertFalse("Une autre équipe ne dessine pas", dragons.dessiner(code, "500,500 600,600"))
        ecran.voit("Dessin en direct · 2 traits")
        ecran.capture("pictionary-dessin")
        assertEquals("applied", regie.commande(code, "mime_found"))
        ecran.voit("TROUVÉ !")
        ecran.voit("Bravo Licornes !")
        ecran.voit("+${Scoring.PICTO} points")
        ecran.voit("MAISON")
        ecran.voit("Dessin en direct · 2 traits")
        attendreQue("points du dessin") { points(licornes, code, licornes.uid).takeIf { it == Scoring.PICTO.toLong() } }
        // Le double appui sur « Trouvé ! » ne compte pas deux fois.
        assertEquals("refused", regie.commande(code, "mime_found"))

        // Les Dragons : le temps est arrêté sans mot trouvé, zéro point, et l'ancien dessin ne revient pas.
        assertEquals("applied", regie.commande(code, "picto_show", mapOf("team" to dragons.uid)))
        ecran.voit("Toute l'équipe se retourne")
        assertTrue(dragons.choisirMot(code, 0))
        attendreQue("choix des Dragons") { dragons.etat(code).child("mime/chosen").value }
        assertEquals("applied", regie.commande(code, "picto_draw"))
        ecran.voit("dessine !")
        ecran.voit("Dessin en direct · 0 traits")
        assertEquals("applied", regie.commande(code, "mime_stop"))
        ecran.voit("Temps écoulé !")
        assertEquals(0L, points(dragons, code, dragons.uid))
        ecran.voit("Voir le classement")
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Après le Pictionary")
        ecran.voit("Jeu suivant : Mimes")

        // Mimes juste après : leurs propres points, et rien du Pictionary ne déborde.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Les Mimes !")
        ecran.neVoitPas("PICTIONARY")
        assertEquals("applied", regie.commande(code, "mime_start", mapOf("team" to dragons.uid)))
        ecran.voit("Chat")
        assertEquals("applied", regie.commande(code, "mime_found"))
        ecran.voit("Bravo Dragons")
        attendreQue("points du mime") { points(dragons, code, dragons.uid).takeIf { it == Scoring.MIME.toLong() } }
        // Sarah passe au classement sans faire jouer les Licornes : rien ne bloque.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Après les mimes")
        ecran.voit("Jeu suivant : Quiz")

        // Le quiz s'ouvre avec les mêmes équipes et les mêmes scores.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Quiz · question 1 / 1")
        assertEquals(Scoring.PICTO.toLong(), points(licornes, code, licornes.uid))
        assertEquals(Scoring.MIME.toLong(), points(dragons, code, dragons.uid))
        assertTrue(licornes.repondre(code, demo[0]["id"] as String, (demo[0]["correct"] as Number).toInt()))
        ecran.capture("pictionary-mimes-quiz")
    }

    @Test
    fun justeChiffreLEquipeLaPlusProcheGagne() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val nombre = mapOf(
            "id" to "a1n", "text" to "Combien d'os dans le corps humain ?", "kind" to "number", "correct" to 206,
            "duration" to 30, "double" to false, "round" to "Le Juste Chiffre",
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(nombre) + avant))

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("LE JUSTE CHIFFRE")
        attendreQue("question en nombre ouverte") {
            licornes.etat(code).takeIf { it.child("phase").value == "question" && it.child("qid").value == "a1n" }
        }
        ecran.capture("juste-chiffre-question", attente = Ecran.APRES_RIDEAU)
        assertTrue(licornes.repondre(code, "a1n", 200))
        assertTrue(dragons.repondre(code, "a1n", 250))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("écart 6")
        ecran.capture("juste-chiffre-revelation", attente = Ecran.APRES_REVELATION)
        attendreQue("points de la plus proche") { points(licornes, code, licornes.uid).takeIf { it == Scoring.NUMBER_CLOSEST.toLong() } }
        assertEquals(0L, points(dragons, code, dragons.uid))
    }

    @Test
    fun vraiOuFauxExpressSEnchaineToutSeul() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        fun affirmation(id: String, text: String, correct: Int) = mapOf(
            "id" to id, "text" to text, "choices" to listOf("Vrai", "Faux"), "correct" to correct,
            "duration" to 8, "kind" to "express", "double" to false, "round" to "Vrai ou Faux express",
        )
        val serie = listOf(affirmation("e1", "Le Soleil est une étoile.", 0), affirmation("e2", "Les poissons volent.", 1))
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, serie + avant))

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("VRAI OU FAUX EXPRESS")
        attendreQue("première affirmation ouverte") { licornes.etat(code).takeIf { it.child("qid").value == "e1" && it.child("phase").value == "question" } }
        ecran.capture("express-affirmation")
        assertTrue(licornes.repondre(code, "e1", 0))
        // Personne ne touche à rien : fermeture, révélation, puis affirmation suivante, toutes seules.
        attendreQue("affirmation suivante ouverte toute seule") {
            licornes.etat(code).takeIf { it.child("qid").value == "e2" && it.child("phase").value == "question" }
        }
        ecran.voit("Les poissons volent.")
        assertEquals(Scoring.EXPRESS.toLong(), points(licornes, code, licornes.uid))
        // Sans réponse, le chrono s'écoule ; dernière affirmation de la manche : les scores, sans double compte.
        attendreQue("scores à la fin de la série", 30_000) { licornes.etat(code).takeIf { it.child("phase").value == "scores" } }
        assertEquals(Scoring.EXPRESS.toLong(), points(licornes, code, licornes.uid))
        ecran.capture("express-scores")
    }

    @Test
    fun zoomMystereLaPhotoSeDevoilePuisPointsDuQuiz() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val photo = "0123456789abcdef"
        regie.copierPhoto(code, photo, PIXEL)
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val zoom = mapOf(
            "id" to "z1", "text" to "Quel animal se cache sur la photo ?", "choices" to listOf("Chat", "Lion"), "correct" to 1,
            "duration" to 20, "kind" to "zoom", "double" to false, "round" to "Zoom mystère", "imageId" to photo,
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(zoom) + avant))
        // Fête sans Internet : la photo du programme est gardée sur la box dès son chargement.
        attendreQue("photo gardée sur la box") { java.io.File(Boite.contexte.filesDir, "photos/$photo").takeIf { it.isFile && it.length() > 0 } }

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("ZOOM MYSTÈRE")
        attendreQue("photo mystère ouverte") { licornes.etat(code).takeIf { it.child("qid").value == "z1" && it.child("phase").value == "question" } }
        ecran.capture("zoom-mystere-question")
        assertTrue(licornes.repondre(code, "z1", 1))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("points du quiz pour la bonne réponse") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } }
        ecran.capture("zoom-mystere-revelation", attente = Ecran.APRES_REVELATION)
    }

    @Test
    fun reponsesEnImagesPuisQuestionEnTexteSansRienBloquer() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val lion = "0123456789abcdef"
        val chat = "fedcba9876543210"
        regie.copierPhotoReponse(code, lion, PIXEL)
        regie.copierPhotoReponse(code, chat, PIXEL)
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val images = mapOf(
            "id" to "i1", "text" to "Quel animal fait « miaou » ?", "choices" to listOf("Lion", "Chat", "Vache"), "correct" to 1,
            "duration" to 20, "kind" to "classic", "double" to false, "round" to "Quiz des petits", "choiceImages" to listOf(lion, chat, ""),
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(images, demo[0] + ("round" to "Quiz des petits"))))

        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("question en images ouverte") { licornes.etat(code).takeIf { it.child("qid").value == "i1" && it.child("phase").value == "question" } }
        // Les deux photos s'affichent en grand ; la réponse sans photo reste en texte.
        ecran.voit("Réponse A en image : Lion")
        ecran.voit("Réponse B en image : Chat")
        ecran.voit("Vache")
        assertEquals(lion, licornes.etat(code).child("choiceImages/0").value)
        ecran.capture("reponses-en-images")
        assertTrue(licornes.repondre(code, "i1", 1))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("points du QCM pour la bonne image") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } }
        ecran.capture("reponses-en-images-revelation", attente = Ecran.APRES_REVELATION)
        // Question suivante en texte : rien ne bloque, le score est gardé.
        val gagne = points(licornes, code, licornes.uid)
        attendreQue("question en texte ouverte", 30_000) {
            val e = licornes.etat(code)
            if (e.child("qid").value == demo[0]["id"] && e.child("phase").value == "question") true
            else { regie.commande(code, "next"); null }
        }
        ecran.voit(demo[0]["text"] as String)
        assertEquals(gagne, points(licornes, code, licornes.uid))
    }

    @Test
    fun imageFloueLePremierBuzzRepondPuisLeRebondGagne() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val photo = "0123456789abcdef"
        regie.copierPhoto(code, photo, PIXEL)
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val flou = mapOf(
            "id" to "f1", "text" to "Qu'est-ce qui se cache sous le flou ?", "choices" to listOf("Un lion", "Un chat"), "correct" to 0,
            "duration" to 40, "kind" to "flou", "double" to false, "round" to "Image floue", "imageId" to photo,
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(flou) + avant))

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("IMAGE FLOUE")
        ecran.voit("Buzzez dès que vous reconnaissez l'image !")
        attendreQue("buzzer ouvert") { licornes.etat(code).takeIf { it.child("qid").value == "f1" && it.child("buzzOpen").value == true } }
        assertTrue(licornes.buzzer(code))
        ecran.voit("Licornes a buzzé !")
        attendreQue("image figée pour les Licornes") { licornes.etat(code).takeIf { it.child("buzz/team").value == licornes.uid && it.child("buzzOpen").value == false } }
        assertFalse("pendant la réponse orale, personne d'autre ne buzze", dragons.buzzer(code))
        ecran.capture("image-floue-buzz")
        assertEquals("applied", regie.commande(code, "buzz_ko"))
        ecran.voit("Déjà essayé : Licornes")
        attendreQue("buzzer rouvert aux autres") { dragons.etat(code).takeIf { it.child("buzzOpen").value == true } }
        assertFalse("l'équipe qui s'est trompée ne rebuzze pas", licornes.buzzer(code))
        assertTrue(dragons.buzzer(code))
        ecran.voit("Dragons a buzzé !")
        assertEquals("applied", regie.commande(code, "buzz_ok"))
        ecran.voit("C'était :")
        attendreQue("points du rebond") { points(dragons, code, dragons.uid).takeIf { it == Scoring.BUZZ_REBOUND.toLong() } }
        assertEquals(0L, points(licornes, code, licornes.uid))
        ecran.capture("image-floue-revelation", attente = Ecran.APRES_REVELATION)
    }

    @Test
    fun chanteLeMotPuisQuiSuisJeLesIndicesArriventUnAUn() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val chante = mapOf(
            "id" to "c1", "text" to "soleil", "choices" to listOf("soleil"), "correct" to 0,
            "duration" to 30, "kind" to "chante", "double" to false, "round" to "Chante le mot !",
        )
        val quiSuis = mapOf(
            "id" to "p1", "text" to "Qui suis-je ?", "choices" to listOf("Le lion"), "correct" to 0, "image" to "🦁",
            "duration" to 20, "kind" to "quisuis", "double" to false, "round" to "Qui suis-je ?",
            "cards" to listOf(mapOf("word" to "J'ai une crinière"), mapOf("word" to "Je rugis très fort")),
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(chante, quiSuis) + avant))

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit(if (Look.gs) "UNE CHANSON AVEC LE MOT" else "CHANTE LE MOT !")
        ecran.voit("SOLEIL")
        attendreQue("buzzer ouvert") { licornes.etat(code).takeIf { it.child("qid").value == "c1" && it.child("buzzOpen").value == true } }
        assertTrue(licornes.buzzer(code))
        ecran.voit("À vous de chanter !")
        // Capturé une fois l'alerte posée (STOP ! et le nom), pas pendant le flash du claquement.
        ecran.capture("chante-le-mot-buzz", attente = 700)
        assertEquals("applied", regie.commande(code, "buzz_ok"))
        ecran.voit("Bravo Licornes, quelle voix !")
        assertEquals("applied", regie.commande(code, "next"))
        assertEquals("applied", regie.commande(code, "next"))

        ecran.voit("QUI SUIS-JE ?")
        ecran.voit("J'ai une crinière")
        assertFalse("le deuxième indice attend son tour", ecran.affiche("Je rugis très fort"))
        ecran.voit("Je rugis très fort", 20_000)
        attendreQue("buzzer ouvert") { licornes.etat(code).takeIf { it.child("qid").value == "p1" && it.child("buzzOpen").value == true } }
        assertTrue(licornes.buzzer(code))
        ecran.voit("Licornes a buzzé !")
        assertEquals("applied", regie.commande(code, "buzz_ok"))
        ecran.voit("Le lion")
        attendreQue("points des deux jeux") { points(licornes, code, licornes.uid).takeIf { it == 2L * Scoring.BUZZ } }
        ecran.capture("qui-suis-je-revelation")
    }

    @Test
    fun blindTestLancerBuzzRateRelancerBonneReponsePuisRevelerSansPointsEtBilan() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val id = java.security.MessageDigest.getInstance("SHA-256").digest(EXTRAIT_MP3.toByteArray()).take(8).joinToString("") { "%02x".format(it) }
        regie.copierExtrait(code, id, EXTRAIT_MP3)
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        fun morceau(qid: String, titre: String, points: Int, refrain: String? = null, paroles: String? = null) = mapOf(
            "id" to qid, "text" to "Quel est ce titre ?", "choices" to listOf(titre), "correct" to 0, "artist" to "Comptine",
            "duration" to 20, "kind" to "blind", "double" to false, "round" to "Blind test · Comptines", "audioId" to id, "points" to points,
        ) + (refrain?.let { mapOf("refrainId" to it) } ?: emptyMap()) + (paroles?.let { mapOf("lyrics" to it) } ?: emptyMap())
        // Le dernier morceau a son refrain (ici le même extrait) et ses paroles : à la révélation, toute la salle chante.
        val playlist = listOf(
            morceau("b1", "Frère Jacques", 100),
            morceau("b2", "Au clair de la lune", 200, refrain = id, paroles = "0|Mon ami Pierrot\n1500|Prête-moi ta plume"),
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, playlist + avant))
        val cache = java.io.File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "extraits/$id.mp3")
        attendreQue("extrait copié dans le cache de la box") { cache.takeIf { it.isFile && it.length() > 0 } }
        attendreQue("la régie voit l'extrait prêt") { regie.extraitPret(code, id)?.takeIf { it == "ok" } }

        // Le morceau s'annonce : la musique attend « Lancer le morceau », personne ne peut buzzer.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("BLIND TEST")
        ecran.voit("Morceau 1 / 2")
        ecran.voit("Prêts ? Écoutez bien…")
        // La présentation tient au-dessus des équipes et des boutons.
        ecran.entierementVisible("Prêts ? Écoutez bien…")
        ecran.entierementVisible("Lancer le morceau")
        ecran.capture("blind-test-presentation")
        assertFalse("pas de buzz avant la musique", licornes.buzzer(code))
        assertFalse("le titre reste caché sur les pupitres", licornes.etat(code).hasChild("choices"))
        assertEquals("applied", regie.commande(code, "blind_play"))
        attendreQue("buzzer ouvert") { licornes.etat(code).takeIf { it.child("buzzOpen").value == true } }
        assertTrue(licornes.buzzer(code))
        ecran.voit("Licornes a buzzé !")
        ecran.voit("On attend sa réponse…")
        ecran.entierementVisible("Licornes a buzzé !")
        // Régie reliée : c'est elle qui juge, la TV ne montre pas les boutons de secours.
        ecran.neVoitPas("Mauvaise réponse", 2_000)
        assertFalse("une seule équipe à la fois", dragons.buzzer(code))
        ecran.capture("blind-test-buzz")

        // Mauvaise réponse : la musique reste arrêtée jusqu'à la relance, les Licornes ne rebuzzent pas.
        assertEquals("applied", regie.commande(code, "buzz_ko"))
        ecran.voit("Pas tout à fait ! La musique va repartir…")
        assertFalse(dragons.buzzer(code))
        assertEquals("applied", regie.commande(code, "blind_play"))
        attendreQue("buzzer rouvert aux autres") { dragons.etat(code).takeIf { it.child("buzzOpen").value == true } }
        assertFalse("l'équipe qui s'est trompée attend", licornes.buzzer(code))
        assertTrue(dragons.buzzer(code))
        ecran.voit("Dragons a buzzé !")
        assertEquals("applied", regie.commande(code, "buzz_ok"))
        ecran.voit("Frère Jacques")
        ecran.voit("Comptine")
        ecran.voit("Bonne réponse ! Bravo Dragons")
        ecran.entierementVisible("Bonne réponse ! Bravo Dragons")
        ecran.entierementVisible("+100")
        attendreQue("la valeur du morceau, une fois") { points(dragons, code, dragons.uid).takeIf { it == 100L } }
        assertEquals(0L, points(licornes, code, licornes.uid))
        ecran.neVoitPas(if (Look.gs) "TOUT LE MONDE CHANTE" else "Tous ensemble, on chante", 3_000)
        ecran.capture("blind-test-revelation")
        assertEquals("applied", regie.commande(code, "blind_cut"))

        // « Titre suivant » : le dernier morceau, à double valeur, attend à son tour d'être lancé.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Morceau 2 / 2")
        ecran.voit("POINTS DOUBLÉS · 200 points")
        assertEquals("applied", regie.commande(code, "blind_reveal"))
        ecran.voit("Au clair de la lune")
        ecran.voit("Personne n'a trouvé, ce n'est pas grave !")
        ecran.entierementVisible("Personne n'a trouvé, ce n'est pas grave !")
        // Même sans gagnant, le refrain repart en boucle : « on chante tous ensemble » jusqu'au titre suivant, avec
        // les paroles du refrain au rythme de la musique (cedric, 21/10).
        ecran.voit(chantonsTous())
        ecran.entierementVisible(chantonsTous())
        ecran.voit("Pierrot")
        ecran.entierementVisible("Pierrot")
        ecran.capture("blind-test-refrain")
        assertEquals("applied", regie.commande(code, "next"))
        // Game Show : les tubes de verre du tableau des scores, remplis des points du blind test (cedric, 24/10).
        ecran.voit(if (Look.gs) "BILAN DU BLIND TEST" else "Bilan du blind test")
        ecran.voit(if (Look.gs) "Points gagnés pendant le blind test" else "100 pts")
        // Le jeu suivant (le quiz de démonstration, sans titre de manche) est annoncé.
        ecran.entierementVisible("Jeu suivant : Quiz")
        assertEquals(100L, points(dragons, code, dragons.uid))
        ecran.capture("blind-test-bilan")
    }

    @Test
    fun quizMusicalLaBonneReponsePuisLaRevelationDuBlindTestEnPlusCourt() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val id = java.security.MessageDigest.getInstance("SHA-256").digest(EXTRAIT_MP3.toByteArray()).take(8).joinToString("") { "%02x".format(it) }
        regie.copierExtrait(code, id, EXTRAIT_MP3)
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        // Quiz musical (cedric, 24/10) : l'extrait pendant la question, le refrain et ses paroles à la révélation.
        fun titre(qid: String, bon: Int, refrain: Boolean) = mapOf(
            "id" to qid, "text" to "Quel est ce titre ?", "choices" to listOf("Frère Jacques", "Au clair de la lune", "Une souris verte", "Il pleut bergère"),
            "correct" to bon, "artist" to "Comptine", "duration" to 20, "kind" to "classic", "double" to false, "round" to "Quiz musical · Comptines", "audioId" to id,
        ) + (if (refrain) mapOf("refrainId" to id, "lyrics" to "0|Mon ami Pierrot\n1500|Prête-moi ta plume") else emptyMap())
        val programme = listOf(titre("m1", 1, refrain = true), titre("m2", 0, refrain = false))
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, programme + avant))
        attendreQue("la régie voit l'extrait prêt") { regie.extraitPret(code, id)?.takeIf { it == "ok" } }

        fun ouverte(qid: String) {
            val etat = attendreQue("$qid ouverte sur le serveur") { licornes.etat(code).takeIf { it.child("phase").value == "question" && it.child("qid").value == qid } }
            (etat.child("resumeAt").value as? Number)?.toLong()?.let { depart -> (depart + 600 - System.currentTimeMillis()).takeIf { it > 0 }?.let(Thread::sleep) }
        }
        // Les deux équipes trouvent : la bonne réponse s'allume sur les cartes, puis la pochette, le titre et l'artiste,
        // les deux équipes félicitées, et le refrain avec ses paroles.
        assertEquals("applied", regie.commande(code, "next"))
        ouverte("m1")
        assertTrue(licornes.repondre(code, "m1", 1))
        assertTrue(dragons.repondre(code, "m1", 1))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Bravo Licornes et Dragons !")
        ecran.entierementVisible("Bravo Licornes et Dragons !")
        ecran.voit("Au clair de la lune")
        ecran.voit("Comptine")
        ecran.voit(chantonsTous())
        ecran.entierementVisible(chantonsTous())
        ecran.voit("Pierrot")
        ecran.entierementVisible("Pierrot")
        attendreQue("les points du quiz") { points(dragons, code, dragons.uid).takeIf { it >= Scoring.BASE } }
        ecran.capture("quiz-musical-revelation", attente = Ecran.APRES_REVELATION)

        // Personne ne trouve, et pas de refrain préparé : la scène sans paroles, l'extrait repart quelques secondes.
        assertEquals("applied", regie.commande(code, "next"))
        assertEquals("applied", regie.commande(code, "next"))
        ouverte("m2")
        assertTrue(licornes.repondre(code, "m2", 2))
        assertTrue(dragons.repondre(code, "m2", 3))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Personne n'a trouvé, ce n'est pas grave !")
        ecran.entierementVisible("Personne n'a trouvé, ce n'est pas grave !")
        ecran.voit("Frère Jacques")
        ecran.neVoitPas(if (Look.gs) "TOUT LE MONDE CHANTE" else "TOUS ENSEMBLE", 2_000)
        ecran.capture("quiz-musical-personne")
    }

    @Test
    fun statuesMusicalesLaMusiqueSArretePuisLaRegieDesigneLaGagnante() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val statues = mapOf("id" to "s1", "text" to "Statues musicales", "duration" to 60, "kind" to "statues", "double" to false, "round" to "Statues musicales")
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(statues) + avant))

        assertEquals("applied", regie.commande(code, "next"))
        // Game Show : le nom du jeu est dans le bandeau du haut de l'écran.
        ecran.voit(if (Look.gs) "Statues musicales" else "STATUES MUSICALES")
        ecran.voit("DANSEZ !")
        // Premier arrêt de la musique entre 6 et 10 s.
        ecran.voit("STATUE !", 20_000)
        // « STATUE ! » claque en 0,2 s puis se fend et givre : capturé une fois posé.
        ecran.capture("statues-musicales-statue", attente = 900)
        ecran.voit("DANSEZ !", 15_000)
        assertEquals("applied", regie.commande(code, "statues_win", mapOf("team" to dragons.uid)))
        ecran.voit("Bravo Dragons !")
        attendreQue("300 pour la gagnante") { points(dragons, code, dragons.uid).takeIf { it == Scoring.MINI_WIN.toLong() } }
        assertEquals(Scoring.MINI_PLAYED.toLong(), points(licornes, code, licornes.uid))
        ecran.capture("statues-musicales-gagnante")
    }

    @Test
    fun quiADisparuOnMemoriseSansBuzzerPuisUnObjetManque() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val objets = listOf("Pomme" to "🍎", "Banane" to "🍌", "Fraise" to "🍓", "Cerises" to "🍒").map { (w, e) -> mapOf("word" to w, "image" to e) }
        val disparu = mapOf(
            "id" to "d1", "text" to "Qui a disparu ?", "choices" to listOf("Fraise"), "correct" to 0, "image" to "🍓",
            "duration" to 30, "kind" to "disparu", "double" to false, "round" to "Qui a disparu ?", "cards" to objets,
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(disparu) + avant))

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("MÉMORISEZ !")
        ecran.voit("Mémorisez bien tous les objets !")
        ecran.voit("Fraise")
        attendreQue("question ouverte") { licornes.etat(code).takeIf { it.child("qid").value == "d1" } }
        assertEquals(false, licornes.etat(code).child("buzzOpen").value)
        assertFalse("pas de buzz pendant la mémorisation", licornes.buzzer(code))
        ecran.capture("qui-a-disparu-memoriser")
        // 4 objets : 10 s pour mémoriser, 3 s de tour de magie, puis le buzzer s'ouvre.
        ecran.voit("Buzzez dès que vous savez quel objet a disparu !", 20_000)
        assertFalse("l'objet disparu n'est plus affiché", ecran.affiche("Fraise"))
        attendreQue("buzzer ouvert") { licornes.etat(code).takeIf { it.child("buzzOpen").value == true } }
        ecran.capture("qui-a-disparu-chercher")
        assertTrue(licornes.buzzer(code))
        ecran.voit("Licornes a buzzé !")
        assertEquals("applied", regie.commande(code, "buzz_ok"))
        ecran.voit("Fraise")
        attendreQue("150 points") { points(licornes, code, licornes.uid).takeIf { it == Scoring.BUZZ.toLong() } }
        ecran.capture("qui-a-disparu-revelation")
    }

    @Test
    fun chaqueJeuSOuvreSurSaPresentationEtAttendQueLAnimatriceLeLance() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val questions = listOf(
            mapOf(
                "id" to "p1", "text" to "Quel animal miaule ?", "choices" to listOf("Le chat", "Le chien"), "correct" to 0,
                "duration" to 20, "kind" to "classic", "double" to false, "round" to "Quiz des animaux",
            ),
            mapOf(
                "id" to "p2", "text" to "Le ciel est vert", "choices" to listOf("Vrai", "Faux"), "correct" to 1,
                "duration" to 20, "kind" to "true_false", "double" to false, "round" to "Vrai ou Faux",
            ),
        )
        assertEquals("applied", regie.chargerPrestation(code, "Anniversaire de Léa", questions))
        assertEquals("applied", regie.commande(code, "next"))

        // Présentation du premier jeu : son nom, rien d'autre ; rien ne part tant que l'animatrice ne lance pas.
        ecran.voit("Quiz des animaux")
        ecran.voit("Lancer l'épreuve")
        assertEquals("intro", licornes.etat(code).child("phase").value)
        assertFalse("pas de réponse pendant la présentation", licornes.repondre(code, "p1", 0))
        ecran.capture("presentation-jeu")
        ecran.neVoitPas("Quel animal miaule ?", 3_000)
        assertEquals("intro", licornes.etat(code).child("phase").value)

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Quel animal miaule ?")
        attendreQue("première question ouverte") { licornes.etat(code).takeIf { it.child("phase").value == "question" } }
        assertTrue(licornes.repondre(code, "p1", 0))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Jeu suivant : Vrai ou Faux")

        // Jeu suivant : sa présentation, lancée cette fois à la télécommande.
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Lancer l'épreuve")
        ecran.voit("Vrai ou Faux")
        ecran.ok("Lancer l'épreuve")
        ecran.voit("Le ciel est vert")
        attendreQue("question du Vrai ou Faux ouverte") { licornes.etat(code).takeIf { it.child("phase").value == "question" && it.child("qid").value == "p2" } }
    }

    private val regies = mutableListOf<RegieSimulee>()

    private fun regie() = RegieSimulee().also { regies += it }

    @org.junit.After
    fun rangerRegies() = regies.forEach { it.close() }

    @Test
    fun portesMysteresApresUnQuizOuvertesUneAUneJusquAuClassementFinalPuisLaFin() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val portes = mapOf(
            "id" to "pm", "text" to "Portes mystères", "choices" to listOf("Porte 1", "Porte 2", "Porte 3"), "correct" to -1,
            "duration" to 30, "kind" to "portes", "double" to false, "round" to "Portes mystères", "doors" to listOf(150, -150, 300),
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(demo[0] + ("round" to "Quiz"), portes)))

        // Un jeu avant les portes : les Licornes marquent.
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("question du quiz ouverte") { licornes.etat(code).takeIf { it.child("qid").value == demo[0]["id"] && it.child("phase").value == "question" } }
        assertTrue(licornes.repondre(code, demo[0]["id"] as String, (demo[0]["correct"] as Number).toInt()))
        attendreQue("points du quiz") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } ?: run { regie.commande(code, "next"); null } }
        val avant = points(licornes, code, licornes.uid)

        // Jeu suivant : les portes, sans rien bloquer.
        attendreQue("choix des portes ouvert", 30_000) {
            val e = licornes.etat(code)
            if (e.child("qid").value == "pm" && e.child("phase").value == "question") true
            else { regie.commande(code, "next"); null }
        }
        ecran.voit("Fermer les choix")
        assertEquals(3L, (licornes.etat(code).child("portes/count").value as Number).toLong())
        assertNull("aucune valeur avant l'ouverture", licornes.etat(code).child("portes/values").value)
        ecran.capture("portes-choix")
        assertTrue(licornes.repondre(code, "pm", 1))
        assertTrue(dragons.repondre(code, "pm", 2))
        ecran.voit("Les jeux sont faits")

        // L'animatrice ferme les choix puis ouvre les portes une à une, de gauche à droite.
        attendreQue("portes prêtes à s'ouvrir") {
            licornes.etat(code).takeIf { it.child("phase").value == "reveal" } ?: run { regie.commande(code, "next"); null }
        }
        ecran.voit("Ouvrir la porte suivante")
        for (k in 0 until 3) {
            assertEquals("applied", regie.commande(code, "next"))
            attendreQue("porte ${k + 1} ouverte") { licornes.etat(code).takeIf { (it.child("portes/opened").value as? Number)?.toInt() == k + 1 } }
        }
        ecran.voit("Classement final")
        ecran.capture("portes-ouvertes")
        assertEquals(maxOf(0L, avant - 150), points(licornes, code, licornes.uid))
        assertEquals(300L, points(dragons, code, dragons.uid))

        // Classement final des portes, puis la grande finale : scores gardés, rien ne bloque.
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("classement des portes") { licornes.etat(code).takeIf { it.child("phase").value == "scores" } }
        ecran.voit("Résultats finaux")
        ecran.capture("portes-classement")
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("fin de partie") { licornes.etat(code).takeIf { it.child("phase").value == "ended" } }
        assertEquals(300L, points(dragons, code, dragons.uid))
    }

    @Test
    fun bombeCacheeApresUnQuizChacunSonTourJusquALaBombePuisLaFin() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        // Exactement ce qu'envoie la régie pour une manche « Les Coffres mystères » (web/public/show.js).
        val bombe = mapOf(
            "id" to "bc", "text" to "Les Coffres mystères", "choices" to emptyList<String>(), "correct" to -1,
            "duration" to 20, "kind" to "coffres", "double" to false, "round" to "Les Coffres mystères",
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(demo[0] + ("round" to "Quiz"), bombe)))

        // Un jeu avant : les Licornes marquent, les Dragons non.
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("question du quiz ouverte") { licornes.etat(code).takeIf { it.child("qid").value == demo[0]["id"] && it.child("phase").value == "question" } }
        assertTrue(licornes.repondre(code, demo[0]["id"] as String, (demo[0]["correct"] as Number).toInt()))
        attendreQue("points du quiz") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } ?: run { regie.commande(code, "next"); null } }

        // Jeu suivant : les coffres mystères. Les coffres sont installés dès le lancement, les Dragons (derniers) commencent.
        attendreQue("coffres installés", 30_000) {
            val e = licornes.etat(code)
            if (e.child("qid").value == "bc" && e.child("phase").value == "question" && e.child("chests/ready").value == true) true
            else { if (e.child("qid").value != "bc" || e.child("phase").value != "question") regie.commande(code, "next"); null }
        }
        ecran.voit("choisissez un coffre !")
        ecran.voit("Encore 6 coffres sans danger")
        ecran.capture("bombe-coffres")
        assertEquals(dragons.uid, licornes.etat(code).child("chests/team").value)
        assertEquals("pas le tour des Licornes", false, licornes.ouvrirCoffre(code, 0))
        assertEquals("le bouton principal n'ouvre jamais de coffre", "refused", regie.commande(code, "next"))

        // Chacun son tour, le premier coffre fermé, jusqu'à la bombe ; une fois avec le secours de la régie. Chaque coffre :
        // l'ouverture puis le classement (7,5 s), jusqu'à 14 coffres à 2 équipes.
        var ouvertures = 0
        attendreQue("bombe trouvée", 240_000) {
            val e = licornes.etat(code)
            val c = e.child("chests")
            if (c.child("exploded").value == true) return@attendreQue true
            val equipe = c.child("team").value as? String ?: return@attendreQue null
            val pret = (c.child("readyAt").value as Number).toLong()
            if (System.currentTimeMillis() < pret + 500) return@attendreQue null
            val ouverts = c.child("opened").children.map { (it.child("chest").value as Number).toInt() }.toSet()
            val libre = (0 until (c.child("count").value as Number).toInt()).first { it !in ouverts }
            val tour = (c.child("turn").value as Number).toInt()
            // Refusé (horloges un peu décalées, animation pas tout à fait finie) : on réessaie au tour de boucle suivant.
            val ok = if (tour == 2) regie.commande(code, "chest_random") == "applied"
            else (if (equipe == licornes.uid) licornes else dragons).ouvrirCoffre(code, libre)
            if (!ok) return@attendreQue null
            attendreQue("coffre ouvert") { licornes.etat(code).takeIf { (it.child("chests/turn").value as Number).toInt() > tour } }
            ouvertures++
            if (tour == 0) {
                ecran.capture("bombe-ouverture")
                // Après l'ouverture, le classement de toutes les équipes.
                ecran.voit("Le classement", 12_000)
                ecran.capture("coffres-classement")
            }
            null
        }
        assertTrue("au moins les 6 coffres sans danger avant la bombe", ouvertures >= 6)
        val e = licornes.etat(code)
        assertEquals("reveal", e.child("phase").value)
        ecran.voit("Le bilan des Coffres mystères", 15_000)
        ecran.capture("bombe-bilan")
        assertTrue("jamais sous 0", points(licornes, code, licornes.uid) >= 0 && points(dragons, code, dragons.uid) >= 0)

        // Classement, puis la fin : scores gardés, rien ne bloque.
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("classement") { licornes.etat(code).takeIf { it.child("phase").value == "scores" } }
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("fin de partie") { licornes.etat(code).takeIf { it.child("phase").value == "ended" } }
    }

    @Test
    fun gonfleurFouApresUnQuizLePremierBallonEclateGagnePuisLaFin() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        // Exactement ce qu'envoie la régie pour une manche « Le Gonfleur fou » (web/public/show.js).
        val ballon = mapOf(
            "id" to "gf", "text" to "Le Gonfleur fou", "choices" to emptyList<String>(), "correct" to -1,
            "duration" to 45, "kind" to "gonfleur", "double" to false, "round" to "Le Gonfleur fou",
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(demo[0] + ("round" to "Quiz"), ballon)))

        // Un jeu avant : les Licornes marquent.
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("question du quiz ouverte") { licornes.etat(code).takeIf { it.child("qid").value == demo[0]["id"] && it.child("phase").value == "question" } }
        assertTrue(licornes.repondre(code, demo[0]["id"] as String, (demo[0]["correct"] as Number).toInt()))
        attendreQue("points du quiz") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } ?: run { regie.commande(code, "next"); null } }
        val avant = points(licornes, code, licornes.uid)

        // Jeu suivant : le Gonfleur fou, lancé par l'animatrice, avec son départ 3, 2, 1.
        attendreQue("course lancée", 30_000) {
            val e = licornes.etat(code)
            if (e.child("qid").value == "gf" && e.child("pump/key").value != null) true
            else { if (e.child("qid").value != "gf" || e.child("phase").value != "question" || e.child("pump/key").value == null) regie.commande(code, "next"); null }
        }
        val goAt = (licornes.etat(code).child("pump/goAt").value as Number).toLong()
        attendreQue("départ") { (System.currentTimeMillis() > goAt + 6_000).takeIf { it } }
        ecran.voit("Tapez sur vos tablettes")
        // Les Licornes tapent, les Dragons font éclater leur ballon : la box termine la course.
        assertTrue(licornes.gonfler(code, 60))
        assertTrue(dragons.gonfler(code, 80))
        ecran.capture("gonfleur-course")
        assertEquals("phase", "question", licornes.etat(code).child("phase").value)
        assertTrue(dragons.gonfler(code, PUMP_TARGET))
        attendreQue("ballon éclaté") { licornes.etat(code).takeIf { it.child("phase").value == "reveal" } }
        ecran.voit("Dragons gagnent !", 15_000)
        ecran.capture("gonfleur-gagnant")
        assertEquals(Scoring.MINI_WIN.toLong(), points(licornes, code, dragons.uid))
        assertEquals(avant + Scoring.MINI_PLAYED, points(licornes, code, licornes.uid))
        assertEquals("plus de tapes après la course", false, licornes.gonfler(code, 90))

        // Classement, puis la fin : scores gardés, rien ne bloque.
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("classement") { licornes.etat(code).takeIf { it.child("phase").value == "scores" } }
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("fin de partie") { licornes.etat(code).takeIf { it.child("phase").value == "ended" } }
    }

    @Test
    fun patateChaudeApresUnQuizLaBombePasseLaMecheColleEtElleExplose() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        // Exactement ce qu'envoie la régie pour une manche « Ça va exploser ! » (web/public/show.js).
        val bombe = mapOf(
            "id" to "pt", "text" to "Ça va exploser !", "choices" to emptyList<String>(), "correct" to -1,
            "duration" to 40, "kind" to "patate", "double" to false, "round" to "Ça va exploser !",
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(demo[0] + ("round" to "Quiz"), bombe)))

        // Un jeu avant : les Licornes marquent.
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("question du quiz ouverte") { licornes.etat(code).takeIf { it.child("qid").value == demo[0]["id"] && it.child("phase").value == "question" } }
        assertTrue(licornes.repondre(code, demo[0]["id"] as String, (demo[0]["correct"] as Number).toInt()))
        attendreQue("points du quiz") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } ?: run { regie.commande(code, "next"); null } }

        // Jeu suivant : « Ça va exploser ! », lancé par l'animatrice ; la box allume la mèche toute seule.
        attendreQue("mèche allumée", 30_000) {
            val e = licornes.etat(code)
            if (e.child("qid").value == "pt" && e.child("potato/lit").value == true) true
            else { if (e.child("qid").value != "pt" || e.child("phase").value != "question") regie.commande(code, "next"); null }
        }
        val e = licornes.etat(code)
        assertEquals("la mèche reste secrète", null, e.child("deadline").value)
        val porteur = if (e.child("potato/holder").value == licornes.uid) licornes else dragons
        val autre = if (porteur === licornes) dragons else licornes
        val pret = (e.child("potato/readyAt").value as Number).toLong()
        // Points avant toute explosion : le bilan de fin compte toutes les bombes.
        val avant = mapOf(licornes.uid to points(licornes, code, licornes.uid), dragons.uid to points(licornes, code, dragons.uid))
        ecran.voit("La bombe est chez")
        // L'équipe qui la tient l'envoie : seule sa tablette le peut (vérifié avant, pour ne pas manger les 3 secondes).
        assertEquals("pas l'autre équipe", false, autre.envoyerPatate(code, porteur.uid))
        // Ni avant la fin de la mèche qui colle, ni après les 3 secondes qui suivent (sinon elle explose chez le porteur) :
        // envoyée aussitôt la marge passée.
        attendreQue("départ") { (System.currentTimeMillis() > pret + 1_200).takeIf { it } }
        assertTrue(porteur.envoyerPatate(code, autre.uid))
        attendreQue("bombe passée") {
            licornes.etat(code).takeIf { it.child("potato/holder").value == autre.uid && it.child("potato/booms").childrenCount == 0L }
        }
        ecran.capture("patate-passe")
        // Mèche qui colle : pas de renvoi immédiat (vérifié seulement si l'émulateur est assez rapide pour tomber dedans).
        // Large marge : l'horloge de l'émulateur et celle du serveur diffèrent, et l'envoi met parfois plus d'une seconde
        // à arriver (le 20/10, un renvoi parti 500 ms avant la fin est arrivé 110 ms après et a été accepté, à raison).
        val colle = (licornes.etat(code).child("potato/readyAt").value as Number).toLong()
        if (System.currentTimeMillis() + 1_500 < colle) assertEquals("mèche qui colle", false, autre.envoyerPatate(code, porteur.uid))

        // Trois bombes : chacune explose chez l'équipe qui la tient (ici, gardée plus de 3 secondes : elle perd des points,
        // l'autre en gagne) ; entre deux, la box allume toute seule la suivante, annoncée « Bombe 2 sur 3 ».
        attendreQue("première explosion", 70_000) { licornes.etat(code).takeIf { it.child("potato/booms").childrenCount >= 1 } }
        ecran.capture("patate-boum")
        attendreQue("bombe 2 allumée", 20_000) { licornes.etat(code).takeIf { (it.child("potato/bomb").value as? Number)?.toInt() == 2 } }
        ecran.voit("Bombe 2 sur 3", 15_000)
        ecran.capture("patate-bombe-2")
        attendreQue("explosion de la dernière bombe", 170_000) { licornes.etat(code).takeIf { it.child("phase").value == "reveal" } }
        ecran.voit("BOUM !", 15_000)
        ecran.capture("patate-bilan")
        val booms = licornes.etat(code).child("potato/booms").children.map { it.child("holder").value as String to (it.child("lost").value as Number).toLong() }
        assertEquals("trois bombes", POTATO_BOMBS, booms.size)
        assertTrue("personne ne l'a renvoyée : gardée trop longtemps", licornes.etat(code).child("potato/booms").children.all { it.child("held").value == true })
        avant.forEach { (uid, pts) ->
            val attendu = pts + booms.sumOf { (holder, perdu) -> if (holder == uid) -perdu else POTATO_POINTS.toLong() }
            assertEquals("points de $uid", attendu, points(licornes, code, uid))
        }
        assertTrue("jamais plus de $POTATO_POINTS perdus par bombe", booms.all { it.second in 0..POTATO_POINTS.toLong() })
        assertEquals("plus d'envoi après l'explosion", false, licornes.envoyerPatate(code, dragons.uid))

        // Classement, puis la fin : scores gardés, rien ne bloque.
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("classement") { licornes.etat(code).takeIf { it.child("phase").value == "scores" } }
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("fin de partie") { licornes.etat(code).takeIf { it.child("phase").value == "ended" } }
    }
}

/** Le refrain que toute la salle chante, à la révélation du blind test : en néon en Game Show (proposition A, 24/10). */
private fun chantonsTous() = if (Look.gs) "TOUT LE MONDE CHANTE !" else "TOUS ENSEMBLE, ON CHANTE !"
