package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Préchargement des prestations du jour depuis l'accueil (cedric, 30/10) : quelles prestations, quels éléments de la
 * bibliothèque, quels médias et dans quel ordre. Les données ont la forme que Firebase rend (Map, List, String, Long).
 */
class PrechargementTest {

    private val son1 = "aaaaaaaaaaaaaaa1"
    private val son2 = "aaaaaaaaaaaaaaa2"
    private val photo1 = "bbbbbbbbbbbbbbb1"
    private val photo2 = "bbbbbbbbbbbbbbb2"

    @Test
    fun `les prestations du jour, toutes, sauf les archivées et celles d'un autre jour`() {
        val shows = mapOf(
            "b-lea" to mapOf("date" to "2026-12-02", "status" to "publiee"),
            "a-tom" to mapOf("date" to "2026-12-02", "status" to "brouillon"),
            "c-vieille" to mapOf("date" to "2026-12-02", "status" to "archivee"),
            "d-demain" to mapOf("date" to "2026-12-03", "status" to "publiee"),
            "e-sans-date" to mapOf("status" to "publiee"),
            "f-abimee" to "texte",
        )
        assertEquals(listOf("a-tom", "b-lea"), Prechargement.prestationsDuJour(shows, "2026-12-02"))
        assertEquals(emptyList(), Prechargement.prestationsDuJour(shows, "2026-12-04"), "aucune ce jour-là : rien à charger")
        assertEquals(emptyList(), Prechargement.prestationsDuJour(null, "2026-12-02"), "bibliothèque vide ou illisible")
    }

    @Test
    fun `les références d'une prestation suivent l'ordre du conducteur`() {
        val show = mapOf(
            "date" to "2026-12-02",
            "rounds" to listOf(
                mapOf("type" to "statues", "chansons" to listOf("chanson-statues")),
                mapOf("type" to "quiz", "quizIds" to listOf("quiz-b", "quiz-a")),
                mapOf("type" to "blind", "seriesBlind" to listOf(mapOf("id" to "s1", "origine" to "choix", "chansons" to listOf("chanson-1", "", "chanson-2")))),
                mapOf("type" to "mimes", "deckId" to "paquet-1"),
                mapOf("type" to "quiz", "seriesQuiz" to listOf(mapOf("origine" to "quiz", "quizId" to "quiz-c"))),
                mapOf("type" to "musical", "playlistId" to "playlist-1"),
                mapOf("type" to "duel", "joueurs" to 4L),
            ),
        )
        val r = Prechargement.references(show)
        assertEquals(listOf("quiz-b", "quiz-a", "quiz-c"), r.quiz)
        assertEquals(listOf("paquet-1"), r.paquetsMimes)
        assertEquals(listOf("playlist-1"), r.playlists)
        assertEquals(listOf("chanson-statues", "chanson-1", "chanson-2"), r.chansons, "les cases vides attendent leur 🎲 : rien à lire")
        assertEquals(listOf("chanson-statues"), r.chansonsEntieres, "seules les statues jouent des chansons entières")
    }

    @Test
    fun `une liste rangée par Firebase comme un objet à clés numériques garde son ordre`() {
        val show = mapOf("rounds" to mapOf("10" to mapOf("quizId" to "dixieme"), "2" to mapOf("quizId" to "deuxieme"), "0" to mapOf("quizId" to "premier")))
        assertEquals(listOf("premier", "deuxieme", "dixieme"), Prechargement.references(show).quiz)
    }

    @Test
    fun `les médias sont typés par leur clé, sans doublon, dans l'ordre`() {
        val quiz = mapOf(
            "title" to "Animaux",
            "questions" to listOf(
                mapOf("text" to "Q1", "imageId" to photo1, "choiceImages" to listOf(photo2, "", photo1)),
                mapOf("text" to "Q2", "audioId" to son1, "refrainId" to son2),
                mapOf("text" to "Q3", "audioIds" to listOf(son2, son1)),
                mapOf("text" to "pas une empreinte", "imageId" to "court", "audioId" to "AAAAAAAAAAAAAAA1"),
            ),
        )
        assertEquals(
            listOf(MediaAPrecharger(photo1, false), MediaAPrecharger(photo2, false), MediaAPrecharger(son1, true), MediaAPrecharger(son2, true)),
            Prechargement.medias(quiz),
        )
    }

    @Test
    fun `une empreinte sous une clé inconnue est à essayer dans les sons puis les photos`() {
        val medias = Prechargement.medias(mapOf("x" to photo1, "cards" to listOf(mapOf("word" to "chat", "imageId" to photo2))))
        assertEquals(listOf(MediaAPrecharger(photo1, null), MediaAPrecharger(photo2, false)), medias)
    }

    @Test
    fun `médias écrits dans la prestation elle-même (cartes de mimes, extraits choisis)`() {
        val show = mapOf(
            "rounds" to listOf(
                mapOf("type" to "mimes", "cards" to listOf(mapOf("word" to "chat", "imageId" to photo1))),
                mapOf("type" to "blind", "tracks" to listOf(son1)),
            ),
        )
        assertEquals(listOf(MediaAPrecharger(photo1, false), MediaAPrecharger(son1, true)), Prechargement.references(show).medias)
    }

    @Test
    fun `images choisies d'un jeu intégré, seulement celles des éléments choisis`() {
        val show = mapOf("rounds" to listOf(mapOf("type" to "quisuis", "picks" to listOf("Mario", "pikachu", "Mario"))))
        val contenus = Prechargement.references(show).contenus
        assertEquals(listOf("quisuis" to listOf("mario", "pikachu")), contenus)
        val images = mapOf("mario" to photo1, "luigi" to photo2, "pikachu" to "pas une empreinte")
        assertEquals(listOf(MediaAPrecharger(photo1, false)), Prechargement.imagesChoisies(images, contenus.single().second))
        assertEquals("m_me", Prechargement.emplacement("m.me"))
    }

    @Test
    fun `fusionner garde le premier ordre et le type connu`() {
        val a = listOf(MediaAPrecharger(son1, null), MediaAPrecharger(photo1, false))
        val b = listOf(MediaAPrecharger(son1, true), MediaAPrecharger(son2, true), MediaAPrecharger(photo1, false))
        assertEquals(
            listOf(MediaAPrecharger(son1, true), MediaAPrecharger(photo1, false), MediaAPrecharger(son2, true)),
            Prechargement.fusionner(listOf(a, b)),
        )
    }

    @Test
    fun `prestation vide, abîmée ou sans jeux, rien à lire et jamais d erreur`() {
        for (show in listOf(null, emptyMap<String, Any?>(), mapOf("rounds" to "abîmé"), mapOf("rounds" to listOf(null, 3L, "x")))) {
            val r = Prechargement.references(show)
            assertTrue(r.quiz.isEmpty() && r.medias.isEmpty() && r.chansons.isEmpty() && r.contenus.isEmpty(), "$show")
        }
    }
}
