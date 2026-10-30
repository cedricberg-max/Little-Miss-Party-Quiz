package com.littlemissparty.quiz.tv.test

import com.littlemissparty.quiz.tv.TEAM_COLORS
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Règle 10, de 1 à 8 équipes (cedric, 30/10, Qui suis-je à 8 équipes : « Votre réponse, à voix… » rogné sous les
 * équipes, « PERSONNE N'A TROUVÉ, CE N'EST » coupé, médaillon du personnage minuscule) : à chaque moment des jeux au
 * buzzer, aucun texte de l'écran n'est rogné, caché par un autre cadre, coupé au milieu d'un mot ni fini en « … ».
 * Une capture par moment et par nombre d'équipes, pour comparer d'un coup d'œil.
 */
@RunWith(Parameterized::class)
class TextesEntiersTest(private val nombre: Int) : TestTv() {
    private val regies = mutableListOf<RegieSimulee>()

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @After
    fun ranger() = regies.forEach { runCatching { it.close() } }

    private fun regie() = RegieSimulee().also { regies += it }

    @Test
    fun jeuxAuBuzzerAucunTexteCoupe() {
        val code = lancerBoite()
        // Noms longs, comme de vrais enfants : le pire cas pour les pastilles et pour « … a buzzé ! ».
        val equipes = (0 until nombre).map { i -> pupitre("equipe$i").also { it.rejoindre(code, NOMS[i], TEAM_COLORS[i]) } }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val photo = "0fedcba987654321"
        regie.copierPhoto(code, photo, PIXEL_ROUGE)
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        fun quiSuis(id: String) = mapOf(
            "id" to id, "text" to "Qui suis-je ?", "choices" to listOf("Mickey"), "correct" to 0, "image" to "🐭",
            "duration" to 60, "kind" to "quisuis", "double" to false, "round" to "Qui suis-je ?",
            "cards" to listOf(mapOf("word" to "J'ai de grandes oreilles rondes"), mapOf("word" to "Je porte une culotte rouge")),
        )
        val flou = mapOf(
            "id" to "f1", "text" to "Qu'est-ce que c'est ?", "choices" to listOf("Un téléphérique"), "correct" to 0,
            "duration" to 60, "kind" to "flou", "double" to false, "round" to "Image floue", "imageId" to photo,
        )
        val picto = mapOf(
            "id" to "d1", "text" to "Pictionary", "kind" to "pictionary", "duration" to 90, "round" to "Pictionary",
            "points" to 100, "cards" to listOf(mapOf("word" to "Soleil", "image" to "☀️"), mapOf("word" to "Maison", "image" to "🏠")),
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(quiSuis("p1"), quiSuis("p2"), flou, picto) + avant))
        val n = "$nombre-equipes"

        // Qui suis-je ? : un buzz, la bonne réponse, la révélation.
        ouvrir(regie, equipes[0], code, "p1")
        ecran.voit("J'ai de grandes oreilles rondes")
        controler("qui-suis-je-question-$n")
        val dernier = equipes.last()
        val nomDernier = NOMS[nombre - 1]
        attendreQue("buzzer ouvert") { dernier.etat(code).takeIf { it.child("qid").value == "p1" && it.child("buzzOpen").value == true } }
        assertTrue(dernier.buzzer(code))
        ecran.voit("$nomDernier a buzzé !")
        ecran.voit("On écoute sa réponse…")
        controler("qui-suis-je-buzz-$n", attente = 900)
        assertEquals("applied", regie.commande(code, "buzz_ok"))
        ecran.voit("C'était :")
        controler("qui-suis-je-bravo-$n", attente = Ecran.APRES_REVELATION)

        // Qui suis-je ? : personne ne trouve, « Personne n'a trouvé, ce n'est pas grave ! » en entier.
        ouvrir(regie, equipes[0], code, "p2")
        attendreQue("buzzer ouvert") { dernier.etat(code).takeIf { it.child("qid").value == "p2" && it.child("buzzOpen").value == true } }
        assertTrue(dernier.buzzer(code))
        ecran.voit("$nomDernier a buzzé !")
        assertEquals("applied", regie.commande(code, "buzz_ko"))
        ecran.voit("Déjà essayé")
        controler("qui-suis-je-deja-essaye-$n")
        attendreQue("révélation sans gagnant", 20_000) {
            val e = dernier.etat(code)
            if (e.child("qid").value == "p2" && e.child("phase").value == "reveal") true else { regie.commande(code, "next"); null }
        }
        ecran.voit("Personne n'a trouvé, ce n'est pas grave !")
        controler("qui-suis-je-personne-$n", attente = Ecran.APRES_REVELATION)

        // Image floue : la question, un buzz, la révélation.
        ouvrir(regie, equipes[0], code, "f1")
        ecran.voit("Qu'est-ce que c'est ?")
        controler("image-floue-question-$n")
        attendreQue("buzzer ouvert") { dernier.etat(code).takeIf { it.child("qid").value == "f1" && it.child("buzzOpen").value == true } }
        assertTrue(dernier.buzzer(code))
        ecran.voit("$nomDernier a buzzé !")
        controler("image-floue-buzz-$n", attente = 900)
        assertEquals("applied", regie.commande(code, "buzz_ok"))
        ecran.voit("C'était :")
        controler("image-floue-revelation-$n", attente = Ecran.APRES_REVELATION)

        // Pictionary : la règle en entier, au-dessus des cartes des équipes (cedric, 30/10, 8 équipes).
        attendreQue("Pictionary ouvert", 40_000) {
            if (equipes[0].etat(code).child("qid").value == "d1") true else { regie.commande(code, "next"); null }
        }
        ecran.voit("secondes pour trouver le mot")
        controler("pictionary-regle-$n", attente = 1_500)
        ecran.auDessusDe("secondes pour trouver le mot", NOMS.take(nombre))
    }

    /** La régie passe à la question [qid] (présentation du jeu comprise) et attend qu'elle soit ouverte. */
    private fun ouvrir(regie: RegieSimulee, lecteur: PupitreSimule, code: String, qid: String) {
        attendreQue("question $qid ouverte", 40_000) {
            val e = lecteur.etat(code)
            if (e.child("qid").value == qid && e.child("phase").value == "question") true
            else { regie.commande(code, "next"); null }
        }
    }

    /** Capture puis vérifie que tous les textes de l'écran sont entiers (la capture reste même si c'est raté). */
    private fun controler(nom: String, attente: Long = 600) {
        ecran.capture(nom, attente)
        ecran.aucunTexteCoupe()
    }

    companion object {
        private val NOMS = listOf(
            "Les Licornes Roses", "Les Dragons Dorés", "Les Comètes Filantes", "Les Pirates du Lac",
            "Les Panthères Noires", "Les Fusées Rouges", "Les Sirènes Bleues", "Les Ninjas Masqués",
        )

        /** Une petite image (PNG d'un pixel rouge), comme celles que l'admin prépare. */
        private const val PIXEL_ROUGE =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

        @JvmStatic
        @Parameterized.Parameters(name = "{0} équipes")
        fun nombres() = (1..8).toList()
    }
}
