package com.littlemissparty.quiz.tv.test.tour

import android.util.Log
import com.google.firebase.database.DataSnapshot
import com.littlemissparty.quiz.tv.Pilotage
import com.littlemissparty.quiz.tv.TEAM_COLORS
import com.littlemissparty.quiz.tv.habillage.RobotEcran
import com.littlemissparty.quiz.tv.test.EXTRAIT_MP3
import com.littlemissparty.quiz.tv.test.PupitreSimule
import com.littlemissparty.quiz.tv.test.RegieSimulee
import com.littlemissparty.quiz.tv.test.TAG
import com.littlemissparty.quiz.tv.test.TestTv
import com.littlemissparty.quiz.tv.test.attendreQue
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Le tour de tous les écrans, de 1 à 8 équipes (cedric, 30/10 au soir : « revois chaque affichage… chaque élément…
 * que quel que soit le nombre d'équipes, rien ne sera coupé »). Une partie passe par chaque jeu, saute de l'un à
 * l'autre comme la régie (« Aller à »), et à chaque moment clé : une capture, les textes coupés, les textes dont les
 * cadres se chevauchent et le plus petit texte de l'écran, une ligne « TOUR| » par moment dans le journal.
 *
 * Long (une dizaine de minutes par nombre d'équipes) : hors du passage complet, lancé par ses classes, deux nombres
 * d'équipes chacune, en parallèle (« tour.TourDesEcrans12Test », …). Un jeu qui bloque est noté et le tour continue ;
 * le test échoue à la fin s'il y a un texte coupé ou un jeu bloqué.
 */
abstract class TourDesEcrans(private val nombre: Int) : TestTv() {
    private val regies = mutableListOf<RegieSimulee>()
    private val coupes = mutableListOf<String>()
    private val chevauchements = mutableListOf<String>()
    private val robot = mutableListOf<String>()
    private val bloques = mutableListOf<String>()
    private lateinit var code: String
    private lateinit var regie: RegieSimulee
    private lateinit var equipes: List<PupitreSimule>
    private lateinit var ids: List<String>

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @After
    fun ranger() = regies.forEach { runCatching { it.close() } }

    @Test
    fun tour() {
        code = lancerBoite()
        // Noms longs, comme de vrais enfants : le pire cas pour les pastilles et les cartes.
        equipes = (0 until nombre).map { i -> pupitre("equipe$i").also { it.rejoindre(code, NOMS[i], TEAM_COLORS[i]) } }
        regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val photo = "0fedcba987654321"
        regie.copierPhoto(code, photo, PIXEL_ROUGE)
        val lion = "0123456789abcdef"
        regie.copierPhotoReponse(code, lion, PIXEL_ROUGE)
        val extrait = java.security.MessageDigest.getInstance("SHA-256").digest(EXTRAIT_MP3.toByteArray()).take(8).joinToString("") { "%02x".format(it) }
        regie.copierExtrait(code, extrait, EXTRAIT_MP3)
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val programme = programme(demo[0], photo, lion, extrait)
        ids = programme.map { it["id"] as String }
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, programme))
        runCatching { attendreQue("extrait prêt", 30_000) { regie.extraitPret(code, extrait)?.takeIf { it == "ok" } } }
        verifier("salon")

        jeu("quiz") {
            val q = demo[0]
            aller("t-quiz")
            verifier("quiz-question", 1_500)
            equipes.forEachIndexed { i, e -> e.repondre(code, "t-quiz", if (i % 2 == 0) (q["correct"] as Number).toInt() else 0) }
            reveler("t-quiz")
            verifier("quiz-revelation", ATTENTE_REVELATION)
        }
        // Le bilan des scores en quittant le quiz (points différents d'une équipe à l'autre).
        jeu("scores") {
            regie.commande(code, "goto", mapOf("index" to ids.indexOf("t-juste"), "qid" to "t-juste"))
            attendreQue("bilan des scores", 20_000) { etat().takeIf { it.child("phase").value != "reveal" } }
            verifier("scores", 3_000)
        }
        jeu("juste-chiffre") {
            aller("t-juste")
            verifier("juste-chiffre-question", 1_500)
            equipes.forEachIndexed { i, e -> e.repondre(code, "t-juste", 150 + 20 * i) }
            reveler("t-juste")
            // Pendant la machine à sous (cedric, 1/11 au soir : une phrase coupée juste sous les chiffres qui tournent).
            verifier("juste-chiffre-roulette", 900)
            verifier("juste-chiffre-revelation", ATTENTE_REVELATION)
        }
        jeu("vrai-faux") {
            aller("t-vf")
            verifier("vrai-faux-question", 1_200)
            equipes.forEachIndexed { i, e -> e.repondre(code, "t-vf", i % 2) }
            reveler("t-vf")
            verifier("vrai-faux-revelation", ATTENTE_REVELATION)
        }
        jeu("zoom") {
            aller("t-zoom")
            verifier("zoom-question", 1_500)
            // Une tablette qui perd le Wi-Fi (cedric, 1/11 au soir : « Fantôme 7 » plus petit, puis coupé « Fantô / me 7 ») :
            // le nom garde sa taille, « hors ligne » est à part. La tablette revient avant de répondre.
            // Une seule équipe : personne d'autre pour lire sa présence, l'étape « hors ligne » se voit de 2 à 8 équipes.
            val lecteur = equipes.firstOrNull { it !== equipes.last() }
            if (lecteur != null) {
                val absente = equipes.last()
                val coupeA = System.currentTimeMillis()
                absente.couperReseau()
                attendreQue("équipe hors ligne", 30_000) { lecteur.lire("games/$code/presence/${absente.uid}/online").takeIf { it == false } }
                // Comme en vrai : la coupure d'un pupitre en pleine question met la partie en pause automatique (4 s de grâce
                // côté TV) ; Sarah reprend, la tablette toujours absente. On capture après : sans le voile de la pause posé
                // par-dessus la question (il comptait comme un chevauchement avec les textes du dessous).
                attendreQue("partie reprise", 30_000) {
                    when {
                        etat().child("paused").value == true -> { regie.commande(code, "resume"); Thread.sleep(500); null }
                        System.currentTimeMillis() - coupeA < 6_000 -> { Thread.sleep(300); null }
                        else -> true
                    }
                }
                verifier("zoom-hors-ligne", 1_200)
                absente.retablirReseau(code)
            }
            equipes.forEachIndexed { i, e -> e.repondre(code, "t-zoom", i % 2) }
            reveler("t-zoom")
            verifier("zoom-revelation", ATTENTE_REVELATION)
        }
        jeu("quiz-illustre") {
            aller("t-illustre")
            verifier("quiz-illustre-question", 1_500)
            equipes.forEachIndexed { i, e -> e.repondre(code, "t-illustre", i % 3) }
            reveler("t-illustre")
            verifier("quiz-illustre-revelation", ATTENTE_REVELATION)
        }
        jeu("image-floue") { auBuzzer("t-flou", "image-floue") }
        jeu("chante") { auBuzzer("t-chante", "chante-le-mot") }
        jeu("qui-suis-je") { auBuzzer("t-quisuis", "qui-suis-je") }
        jeu("qui-a-disparu") {
            aller("t-disparu")
            verifier("qui-a-disparu-memoriser", 1_500)
            attendreQue("buzzer ouvert", 40_000) { etat().takeIf { it.child("buzzOpen").value == true } }
            verifier("qui-a-disparu-chercher", 800)
            assertTrue(equipes.last().buzzer(code))
            verifier("qui-a-disparu-buzz", 1_200)
            assertEquals("applied", regie.commande(code, "buzz_ok"))
            verifier("qui-a-disparu-revelation", ATTENTE_REVELATION)
        }
        jeu("quiz-musical") {
            aller("t-musical")
            verifier("quiz-musical-question", 1_500)
            equipes.forEachIndexed { i, e -> e.repondre(code, "t-musical", i % 4) }
            reveler("t-musical")
            verifier("quiz-musical-revelation", 1_500)
            // La scène des paroles (cedric, 30/10 : « tout le monde chante » écrit tout petit à 8 équipes).
            verifier("quiz-musical-paroles", 3_000)
        }
        jeu("blind-test") {
            aller("t-blind")
            verifier("blind-test-presentation", 1_500)
            assertEquals("applied", regie.commande(code, "blind_play"))
            attendreQue("buzzer ouvert", 20_000) { etat().takeIf { it.child("buzzOpen").value == true } }
            verifier("blind-test-ecoute", 1_200)
            assertTrue(equipes.last().buzzer(code))
            verifier("blind-test-buzz", 1_200)
            assertEquals("applied", regie.commande(code, "buzz_ok"))
            verifier("blind-test-revelation", 3_500)
        }
        jeu("mimes") {
            aller("t-mime")
            verifier("mimes-presentation", 1_500)
            assertEquals("applied", regie.commande(code, "mime_start", mapOf("team" to equipes.last().uid)))
            verifier("mimes-tour", 1_500)
            assertEquals("applied", regie.commande(code, "mime_found"))
            verifier("mimes-changement", 1_200)
            assertEquals("applied", regie.commande(code, "mime_stop"))
            verifier("mimes-bravo", 1_500)
        }
        jeu("pictionary") {
            aller("t-picto")
            verifier("pictionary-presentation", 1_500)
            val dessinateur = equipes.last()
            assertEquals("applied", regie.commande(code, "picto_show", mapOf("team" to dessinateur.uid)))
            verifier("pictionary-au-tour-de", 1_500)
            attendreQue("3 mots proposés") { etat().child("mime/offer").childrenCount.takeIf { it == 3L } }
            assertTrue(dessinateur.choisirMot(code, 1))
            attendreQue("mot choisi") { etat().child("mime/chosen").value }
            verifier("pictionary-choix", 1_200)
            assertEquals("applied", regie.commande(code, "picto_draw"))
            attendreQue("dessin ouvert") { etat().child("mime/drawKey").value }
            dessinateur.dessiner(code, "100,100 300,250 500,200 700,400")
            verifier("pictionary-dessin", 1_500)
            assertEquals("applied", regie.commande(code, "mime_found"))
            verifier("pictionary-trouve", 2_000)
        }
        jeu("statues") {
            aller("t-statues")
            verifier("statues-danse", 1_500)
            assertEquals("applied", regie.commande(code, "statues_stop"))
            verifier("statues-statue", 1_200)
            assertEquals("applied", regie.commande(code, "statues_win", mapOf("teams" to listOf(equipes.last().uid))))
            verifier("statues-gagnante", 6_000)
        }
        jeu("coffres") {
            aller("t-coffres") { it.child("chests/ready").value == true }
            verifier("coffres-choix", 1_500)
            val c = etat().child("chests")
            val tour = (c.child("turn").value as Number).toInt()
            attendreQue("coffre jouable") { (System.currentTimeMillis() > (c.child("readyAt").value as Number).toLong() + 500).takeIf { it } }
            val joueuse = equipes.firstOrNull { it.uid == c.child("team").value } ?: equipes.last()
            attendreQue("coffre ouvert", 20_000) {
                if ((etat().child("chests/turn").value as Number).toInt() > tour) true
                else { joueuse.ouvrirCoffre(code, 0); Thread.sleep(800); null }
            }
            // 600 ms seulement : l'analyse de la capture prend jusqu'à 5 s, et le classement qui suit ne reste que 4 s
            // (de 4,5 à 8,5 s après l'ouverture) ; à 1,2 s, le tour à 7 équipes l'a manqué (1/11, chest -50).
            verifier("coffres-ouverture", 600)
            // Le classement entre deux coffres (cedric, 30/10 : les ronds des rangs serrés dans leur carte).
            // Game Show : « LE CLASSEMENT » en capitales ; il ne reste que quelques secondes, capturé dès qu'il paraît.
            attendreQue("classement des coffres", 15_000) { (ecran.affiche("LE CLASSEMENT") || ecran.affiche("Le classement")).takeIf { it } }
            verifier("coffres-classement", 600)
        }
        jeu("gonfleur") {
            aller("t-gonfleur") { it.child("pump/key").value != null }
            verifier("gonfleur-depart", 1_000)
            val goAt = (etat().child("pump/goAt").value as Number).toLong()
            attendreQue("départ", 20_000) { (System.currentTimeMillis() > goAt + 6_000).takeIf { it } }
            equipes.forEachIndexed { i, e -> e.gonfler(code, 8 + 7 * i) }
            verifier("gonfleur-course", 1_200)
        }
        // La bombe et le duel se jouent à deux équipes au moins : rien à voir avec une seule.
        if (nombre >= 2) jeu("ca-va-exploser") {
            aller("t-patate") { it.child("potato/lit").value == true }
            verifier("ca-va-exploser-bombe", 1_200)
        }
        if (nombre >= 2) jeu("duel") {
            aller("t-duel") { it.child("duel/step").value == "ready" }
            verifier("duel-pret", 1_500)
            assertEquals("applied", regie.commande(code, "duel_start"))
            attendreQue("face-à-face") { etat().takeIf { it.child("duel/step").value == "standoff" } }
            verifier("duel-face-a-face", 1_200)
        }
        jeu("simon") {
            aller("t-simon") { it.child("simon/step").value == "ready" }
            verifier("simon-pret", 1_500)
            assertEquals("applied", regie.commande(code, "simon_go"))
            verifier("simon-regardez", 2_300)
            ecran.voit("À VOUS DE JOUER !", 15_000)
            verifier("simon-a-vous", 600)
        }
        jeu("podium") {
            // Le Simon écrit encore son état quand « Terminer » part : la régie répond « stale », elle renvoie alors
            // (tour des écrans à 3 et 6 équipes, 1/11).
            val reponse = (1..5).asSequence().map { regie.commande(code, "end").also { r -> if (r == "stale") Thread.sleep(800) } }
                .firstOrNull { it != "stale" }
            assertEquals("applied", reponse)
            ecran.voit("Bravo à toutes les équipes", 60_000)
            verifier("podium", 1_500)
        }

        Log.i(TAG, "TOUR|$nombre|BILAN|coupés=${coupes.size}|chevauchements=${chevauchements.size}|robot=${robot.size}|bloqués=${bloques.size}")
        // Rouge dès qu'un texte est coupé ou que deux textes se chevauchent, dans l'une ou l'autre version (cedric, 1/11
        // au soir). Buzzy sur un texte est listé dans le message, à trancher sur la planche.
        assertTrue(
            "$nombre équipes :\n" + (
                coupes.map { "Texte coupé — $it" } + chevauchements.map { "Chevauchement — $it" } + robot.map { "Buzzy — $it" } +
                    bloques.map { "Bloqué — $it" }
                ).joinToString("\n"),
            coupes.isEmpty() && chevauchements.isEmpty() && bloques.isEmpty(),
        )
    }

    /** Un jeu du tour : s'il bloque, c'est noté (avec une capture) et le tour passe au jeu suivant. */
    private fun jeu(nom: String, bloc: () -> Unit) {
        runCatching(bloc).onFailure { e ->
            bloques += "$nom : ${e.message}"
            Log.e(TAG, "TOUR|$nombre|$nom|BLOQUÉ|${e.message}")
            runCatching { ecran.capture("tour-$nom-bloque-${nombre}eq") }
        }
    }

    /**
     * La régie saute au jeu [qid] (bilan des scores puis présentation, comme « Aller à ») et passe la présentation,
     * jusqu'à ce que le jeu soit [pret] (par défaut : la question ouverte).
     */
    private fun aller(qid: String, pret: (DataSnapshot) -> Boolean = { it.child("phase").value == "question" }) {
        regie.commande(code, "goto", mapOf("index" to ids.indexOf(qid), "qid" to qid))
        attendreQue("$qid ouvert", 60_000) {
            val e = etat()
            when {
                e.child("qid").value == qid && pret(e) -> true
                // Le jeu s'installe (coffres, bombe, duel…) : on attend, un « suivant » le quitterait.
                e.child("qid").value == qid && e.child("phase").value == "question" -> null
                else -> { regie.commande(code, "next"); Thread.sleep(500); null }
            }
        }
    }

    /** Ferme la question et passe à sa révélation (sans aller plus loin). */
    private fun reveler(qid: String) {
        attendreQue("révélation de $qid", 30_000) {
            val e = etat()
            if (e.child("qid").value == qid && e.child("phase").value == "reveal") true
            else { regie.commande(code, "next"); Thread.sleep(500); null }
        }
    }

    /** Un jeu au buzzer : la question, le buzz de la dernière équipe, la bonne réponse. */
    private fun auBuzzer(qid: String, nom: String) {
        aller(qid)
        verifier("$nom-question", 1_500)
        attendreQue("buzzer ouvert", 40_000) { etat().takeIf { it.child("qid").value == qid && it.child("buzzOpen").value == true } }
        assertTrue(equipes.last().buzzer(code))
        verifier("$nom-buzz", 1_200)
        assertEquals("applied", regie.commande(code, "buzz_ok"))
        verifier("$nom-revelation", ATTENTE_REVELATION)
    }

    private fun etat() = equipes.first().etat(code)

    /**
     * Chaque moment dans ses deux mises en page (cedric, 1/11 au soir) : sans les boutons de télécommande (le réglage
     * par défaut de la box), puis avec (« Piloter avec la télécommande »). Pour chacune : capture, textes coupés,
     * chevauchements et plus petit texte, une ligne « TOUR| » dans le journal.
     */
    private fun verifier(moment: String, attente: Long = 900) {
        RobotEcran.oublier()
        mode(false)
        verifierMode(moment, "sans", attente)
        mode(true)
        // Le bouton sélectionné grossit en 160 ms : la capture attend qu'il soit posé.
        verifierMode(moment, "avec", 400)
        mode(false)
    }

    private fun mode(boutons: Boolean) =
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().runOnMainSync { Pilotage.telecommande = boutons }

    private fun verifierMode(moment: String, mode: String, attente: Long) {
        ecran.capture("tour-$moment-${nombre}eq-$mode", attente)
        val coupe = ecran.defautsTextes()
        val chevauche = ecran.recouvrements()
        val petit = ecran.plusPetitTexte()
        val taille = petit?.let { "%.0f px « %s »".format(it.first, it.second.replace('\n', ' ').take(40)) } ?: "-"
        val details = (coupe + chevauche).joinToString(" ; ").replace('\n', ' ').take(2_500)
        Log.i(TAG, "TOUR|$nombre|$moment|$mode|coupés=${coupe.size}|chevauchements=${chevauche.size}|plus petit=$taille|$details")
        if (coupe.isNotEmpty()) coupes += "$moment ($mode boutons) : ${coupe.joinToString(" ; ")}"
        if (chevauche.isNotEmpty()) chevauchements += "$moment ($mode boutons) : ${chevauche.joinToString(" ; ")}"
        // Buzzy, s'il est passé pendant ce moment : relevé pour la planche (« derrière le texte » ou « coin fixe réservé »,
        // au choix de cedric écran par écran), sans faire échouer le tour.
        val sous = RobotEcran.cadre?.let { ecran.sousLeRobot(it) }.orEmpty()
        if (sous.isNotEmpty()) {
            Log.i(TAG, "TOUR|$nombre|$moment|$mode|robot|${RobotEcran.cle}|${sous.joinToString(" ; ")}")
            robot += "$moment ($mode boutons, ${RobotEcran.cle}) : ${sous.joinToString(" ; ")}"
        }
    }

    private fun programme(quiz: Map<String, Any?>, photo: String, lion: String, extrait: String): List<Map<String, Any?>> {
        fun cartes(vararg mots: Pair<String, String>) = mots.map { (w, e) -> mapOf("word" to w, "image" to e) }
        val vide = mapOf("choices" to emptyList<String>(), "correct" to -1, "double" to false)
        return listOf(
            quiz + mapOf("id" to "t-quiz", "round" to "Quiz"),
            mapOf("id" to "t-juste", "text" to "Combien d'os dans le corps humain ?", "kind" to "number", "correct" to 206, "duration" to 30, "double" to false, "round" to "Le Juste Chiffre"),
            mapOf("id" to "t-vf", "text" to "Le Soleil est une étoile.", "choices" to listOf("Vrai", "Faux"), "correct" to 0, "duration" to 8, "kind" to "express", "double" to false, "round" to "Vrai ou Faux express"),
            mapOf("id" to "t-zoom", "text" to "Quel animal se cache sur la photo ?", "choices" to listOf("Chat", "Lion"), "correct" to 1, "duration" to 20, "kind" to "zoom", "double" to false, "round" to "Zoom mystère", "imageId" to photo),
            mapOf("id" to "t-illustre", "text" to "Quel animal est le roi de la savane ?", "choices" to listOf("Lion", "Chat", "Vache"), "correct" to 0, "duration" to 20, "kind" to "classic", "double" to false, "round" to "Quiz illustré", "choiceImages" to listOf(lion, "", "")),
            mapOf("id" to "t-flou", "text" to "Qu'est-ce qui se cache sous le flou ?", "choices" to listOf("Un téléphérique", "Un bateau"), "correct" to 0, "duration" to 40, "kind" to "flou", "double" to false, "round" to "Image floue", "imageId" to photo),
            mapOf("id" to "t-chante", "text" to "soleil", "choices" to listOf("soleil"), "correct" to 0, "duration" to 30, "kind" to "chante", "double" to false, "round" to "Chante le mot !"),
            mapOf(
                "id" to "t-quisuis", "text" to "Qui suis-je ?", "choices" to listOf("Mickey"), "correct" to 0, "image" to "🐭", "duration" to 60, "kind" to "quisuis", "double" to false, "round" to "Qui suis-je ?",
                "cards" to listOf(mapOf("word" to "J'ai de grandes oreilles rondes"), mapOf("word" to "Je porte une culotte rouge")),
            ),
            mapOf(
                "id" to "t-disparu", "text" to "Qui a disparu ?", "choices" to listOf("Téléphérique"), "correct" to 0, "image" to "🚡", "duration" to 30, "kind" to "disparu", "double" to false, "round" to "Qui a disparu ?",
                "cards" to cartes("Petit avion" to "✈️", "Bateau à voile" to "⛵", "Téléphérique" to "🚡", "Montgolfière" to "🎈"),
            ),
            mapOf(
                "id" to "t-musical", "text" to "Quel est ce titre ?", "choices" to listOf("Frère Jacques", "Au clair de la lune", "Une souris verte", "Il pleut bergère"), "correct" to 1,
                "artist" to "Comptine", "duration" to 20, "kind" to "classic", "double" to false, "round" to "Quiz musical", "audioId" to extrait,
                "refrainId" to extrait, "lyrics" to "0|Au clair de la lune\n1500|Mon ami Pierrot\n3000|Prête-moi ta plume\n4500|Pour écrire un mot",
            ),
            mapOf(
                "id" to "t-blind", "text" to "Quel est ce titre ?", "choices" to listOf("Au clair de la lune"), "correct" to 0, "artist" to "Comptine", "duration" to 20, "kind" to "blind", "double" to false,
                "round" to "Blind test", "audioId" to extrait, "points" to 100, "refrainId" to extrait, "lyrics" to "0|Au clair de la lune\n1500|Mon ami Pierrot",
            ),
            mapOf("id" to "t-mime", "text" to "Animaux", "kind" to "mime", "duration" to 60, "round" to "Les Mimes", "cards" to cartes("Hippopotame" to "🦛", "Lion" to "🦁")),
            mapOf("id" to "t-picto", "text" to "Pictionary", "kind" to "pictionary", "duration" to 90, "round" to "Pictionary", "points" to 100, "cards" to cartes("Soleil" to "☀️", "Maison" to "🏠", "Bateau" to "⛵", "Pomme" to "🍎")),
            mapOf("id" to "t-statues", "text" to "Statues musicales", "duration" to 60, "kind" to "statues", "double" to false, "round" to "Statues musicales", "songs" to listOf(mapOf("songId" to "chanson-1", "title" to "Get Lucky"))),
            mapOf("id" to "t-coffres", "text" to "Les Coffres mystères", "duration" to 20, "kind" to "coffres", "round" to "Les Coffres mystères") + vide,
            mapOf("id" to "t-gonfleur", "text" to "Le Gonfleur fou", "duration" to 45, "kind" to "gonfleur", "round" to "Le Gonfleur fou") + vide,
            mapOf("id" to "t-patate", "text" to "Ça va exploser !", "duration" to 40, "kind" to "patate", "round" to "Ça va exploser !") + vide,
            mapOf("id" to "t-duel", "text" to "Le Duel des robots", "duration" to 10, "kind" to "duel", "round" to "Le Duel des robots", "joueurs" to 1, "faceMin" to 10, "faceMax" to 10, "longs" to false) + vide,
            mapOf("id" to "t-simon", "text" to "Le Simon de Buzzy", "kind" to "simon", "round" to "Le Simon de Buzzy", "tours" to 1, "reponse" to 5, "joueurs" to 1) + vide,
        )
    }

    companion object {
        private val NOMS = listOf(
            "Les Licornes Roses", "Les Dragons Dorés", "Les Comètes Filantes", "Les Pirates du Lac",
            "Les Panthères Noires", "Les Fusées Rouges", "Les Sirènes Bleues", "Les Ninjas Masqués",
        )

        /** Une révélation entière : tampons et points compris. */
        private const val ATTENTE_REVELATION = 3_500L

        /** Une petite image (PNG d'un pixel rouge), comme celles que l'admin prépare. */
        private const val PIXEL_ROUGE =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    }
}

@RunWith(Parameterized::class)
class TourDesEcrans12Test(nombre: Int) : TourDesEcrans(nombre) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0} équipes")
        fun nombres() = listOf(1, 2)
    }
}

@RunWith(Parameterized::class)
class TourDesEcrans34Test(nombre: Int) : TourDesEcrans(nombre) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0} équipes")
        fun nombres() = listOf(3, 4)
    }
}

@RunWith(Parameterized::class)
class TourDesEcrans56Test(nombre: Int) : TourDesEcrans(nombre) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0} équipes")
        fun nombres() = listOf(5, 6)
    }
}

@RunWith(Parameterized::class)
class TourDesEcrans78Test(nombre: Int) : TourDesEcrans(nombre) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0} équipes")
        fun nombres() = listOf(7, 8)
    }
}
