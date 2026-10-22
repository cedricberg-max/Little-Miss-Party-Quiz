package com.littlemissparty.quiz.engine

import com.littlemissparty.quiz.engine.CacheMedias.BUDGET_MUSIQUES_OCTETS
import com.littlemissparty.quiz.engine.CacheMedias.OUBLI_MS
import com.littlemissparty.quiz.engine.CacheMedias.PHOTOS_MAX
import com.littlemissparty.quiz.engine.CacheMedias.RECENT_MS
import com.littlemissparty.quiz.engine.CacheMedias.RESERVE_LIBRE_OCTETS
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Ménage du cache des médias de la box : limites, réserve de place libre, oubli, protections, ordre. */
class CacheMediasTest {

    private val maintenant = 1_800_000_000_000L
    private val jour = 24L * 60 * 60 * 1000
    private val mo = 1024L * 1024

    /** Beaucoup de place libre : seules les limites jouent. */
    private val large = 4L * 1024 * mo

    /** Chanson (extrait + refrain ≈ 1 Mo) utilisée il y a [jours] jours. */
    private fun chanson(nom: String, jours: Long, taille: Long = mo) = FichierMedia("$nom.mp3", taille, maintenant - jours * jour)
    private fun photo(nom: String, jours: Long) = FichierMedia(nom, 50 * 1024L, maintenant - jours * jour)

    private fun menage(
        musiques: List<FichierMedia> = emptyList(),
        photos: List<FichierMedia> = emptyList(),
        proteges: Set<String> = emptySet(),
        libre: Long = large,
    ) = CacheMedias.menage(musiques, photos, proteges, libre, maintenant)

    /** [n] chansons de 1 Mo utilisées il y a 3 jours, une minute d'écart entre chacune : la n° 0 est la plus ancienne. */
    private fun bibliotheque(n: Int) = (0 until n).map { FichierMedia("c$it.mp3", mo, maintenant - 3 * jour - (n - it) * 60_000L) }

    @Test
    fun `dossiers vides ou box neuve, rien à faire`() {
        assertTrue(menage().vide)
        assertTrue(menage(libre = 0).vide, "même sans place libre, il n'y a rien à effacer")
    }

    @Test
    fun `sous les limites, avec de la place libre, rien n'est effacé`() {
        val r = menage(bibliotheque(250), (0 until 100).map { photo("p$it", 10L + it) })
        assertTrue(r.vide)
    }

    @Test
    fun `musiques au-delà du budget, les moins récemment utilisées partent, juste ce qu'il faut`() {
        val chansons = bibliotheque(310)
        val r = menage(chansons.shuffled(kotlin.random.Random(7)))
        // 310 Mo pour 300 Mo de budget : les 10 plus anciennes, dans l'ordre.
        assertEquals((0 until 10).map { "c$it.mp3" }, r.musiques)
        assertTrue(r.photos.isEmpty())
    }

    @Test
    fun `pile au budget, rien ne part`() {
        val n = (BUDGET_MUSIQUES_OCTETS / mo).toInt()
        assertTrue(menage(bibliotheque(n)).vide)
        assertEquals(listOf("c0.mp3"), menage(bibliotheque(n + 1)).musiques)
    }

    @Test
    fun `les médias de la partie ouverte ne partent jamais, même au-delà du budget`() {
        val chansons = bibliotheque(320)
        // Les 20 plus anciennes sont dans le programme de la fête : on efface les suivantes à la place.
        val programme = (0 until 20).map { "c$it.mp3" }.toSet()
        val r = menage(chansons, proteges = programme)
        assertEquals((20 until 40).map { "c$it.mp3" }, r.musiques)
        // Tout est protégé : on reste au-dessus du budget plutôt que de toucher à la fête.
        assertTrue(menage(chansons, proteges = chansons.map { it.nom }.toSet()).vide)
    }

    @Test
    fun `un média utilisé depuis moins de 48 h ne part jamais`() {
        // 400 chansons toutes utilisées hier et aujourd'hui : 100 Mo au-dessus du budget, rien ne part.
        val recentes = (0 until 400).map { FichierMedia("r$it.mp3", mo, maintenant - RECENT_MS + 60_000 + it) }
        assertTrue(menage(recentes, libre = 0).vide)
        // Pile 48 h : elle n'est plus protégée.
        val limite = FichierMedia("limite.mp3", mo, maintenant - RECENT_MS)
        assertEquals(listOf("limite.mp3"), menage(recentes + limite).musiques)
    }

    @Test
    fun `heure de la box changée, un fichier daté du futur est gardé`() {
        val futur = FichierMedia("futur.mp3", mo, maintenant + 365 * jour)
        assertTrue(menage(listOf(futur), libre = 0).vide)
    }

    @Test
    fun `inutilisé depuis 180 jours, effacé même sous le budget`() {
        val vieux = chanson("vieux", 180)
        val presque = chanson("presque", 179)
        val photoOubliee = photo("p-vieille", 200)
        val r = menage(listOf(presque, vieux, chanson("c", 5)), listOf(photo("p", 3), photoOubliee))
        assertEquals(listOf("vieux.mp3"), r.musiques)
        assertEquals(listOf("p-vieille"), r.photos)
        // Sauf s'il sert à la fête en cours.
        assertTrue(menage(listOf(vieux), listOf(photoOubliee), proteges = setOf("vieux.mp3", "p-vieille")).vide)
    }

    @Test
    fun `copie interrompue, effacée une fois vieille, gardée pendant le téléchargement`() {
        val abandon = FichierMedia("abc.part", 300_000, maintenant - 3 * jour)
        val enCours = FichierMedia("def.part", 300_000, maintenant - 1_000)
        val r = menage(listOf(abandon, enCours), listOf(FichierMedia("ph.part", 1_000, maintenant - 5 * jour)))
        assertEquals(listOf("abc.part"), r.musiques)
        assertEquals(listOf("ph.part"), r.photos)
        // Téléchargement en cours signalé par la box : jamais effacé.
        assertTrue(menage(listOf(abandon), proteges = setOf("abc.part")).vide)
    }

    @Test
    fun `photos au-delà de 600, les plus anciennes partent, celles du programme restent`() {
        val n = PHOTOS_MAX + 5
        val photos = (0 until n).map { FichierMedia("p$it", 50 * 1024L, maintenant - 3 * jour - (n - it) * 60_000L) }
        assertEquals((0 until 5).map { "p$it" }, menage(photos = photos.reversed()).photos)
        // Les 5 plus anciennes sont au programme : les 5 suivantes partent à leur place.
        val programme = (0 until 5).map { "p$it" }.toSet()
        assertEquals((5 until 10).map { "p$it" }, menage(photos = photos, proteges = programme).photos)
    }

    @Test
    fun `photos, plafond en nombre, les protégées comptent mais restent`() {
        val programme = (0 until PHOTOS_MAX).map { photo("prog$it", 20) }
        val autres = (0 until 10).map { photo("autre$it", 10L + it) }
        val r = menage(photos = programme + autres, proteges = programme.map { it.nom }.toSet())
        // 610 photos, 600 protégées : les 10 autres partent, les plus anciennes d'abord.
        assertEquals((9 downTo 0).map { "autre$it" }, r.photos)
    }

    @Test
    fun `place libre sous la réserve, musiques d'abord, puis photos, jusqu'à la retrouver`() {
        val chansons = bibliotheque(100)
        val photos = (0 until 50).map { photo("p$it", 100L - it) }
        // Il manque 20 Mo pour atteindre 1 Go libre : les 20 plus anciennes chansons, aucune photo.
        val r = menage(chansons, photos, libre = RESERVE_LIBRE_OCTETS - 20 * mo)
        assertEquals((0 until 20).map { "c$it.mp3" }, r.musiques)
        assertTrue(r.photos.isEmpty())
        // Pile à la réserve : rien.
        assertTrue(menage(chansons, photos, libre = RESERVE_LIBRE_OCTETS).vide)
    }

    @Test
    fun `réserve hors d'atteinte, tout ce qui n'est pas protégé part, musiques puis photos, jamais la fête`() {
        val chansons = bibliotheque(10)
        val photos = (0 until 4).map { photo("p$it", 30L - it) }
        val programme = setOf("c9.mp3", "p3")
        val r = menage(chansons, photos, proteges = programme, libre = 100 * mo)
        assertEquals((0 until 9).map { "c$it.mp3" }, r.musiques)
        assertEquals(listOf("p0", "p1", "p2"), r.photos)
    }

    @Test
    fun `la réserve compte ce que les limites ont déjà libéré`() {
        // 302 Mo de musiques : le budget fait partir 2 chansons (2 Mo), il manquait 1 Mo : rien de plus.
        val r = menage(bibliotheque(302), libre = RESERVE_LIBRE_OCTETS - mo)
        assertEquals(listOf("c0.mp3", "c1.mp3"), r.musiques)
    }

    @Test
    fun `place libre inconnue ou énorme, pas de débordement de calcul`() {
        assertTrue(menage(bibliotheque(10), libre = Long.MAX_VALUE).vide)
        assertEquals(10, menage(bibliotheque(10), libre = -1).musiques.size, "place libre illisible lue comme nulle")
    }

    @Test
    fun `ordre de la plus ancienne utilisation, à égalité par nom`() {
        val a = FichierMedia("b.mp3", mo, maintenant - 10 * jour)
        val b = FichierMedia("a.mp3", mo, maintenant - 10 * jour)
        val c = FichierMedia("c.mp3", mo, maintenant - 20 * jour)
        assertEquals(listOf("c.mp3", "a.mp3", "b.mp3"), menage(listOf(a, b, c), libre = 0).musiques)
    }
}
