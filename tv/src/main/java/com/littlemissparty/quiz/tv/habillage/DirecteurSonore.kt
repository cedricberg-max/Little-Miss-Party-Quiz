package com.littlemissparty.quiz.tv.habillage

/**
 * Chef d'orchestre de l'habillage sonore : regarde l'écran affiché et décide quels sons jouer, et quand.
 * Kotlin pur, sans Android : il se teste sur la JVM et ne touche jamais à la partie elle-même.
 *
 * On lui montre un [Instant] à chaque changement d'écran. Il le compare au précédent et rend des [Ordre]
 * que le moteur ([Sons]) exécute. Un même instant montré deux fois ne rejoue rien ; une box qui se
 * reconnecte en pleine partie reprend la musique de l'écran, sans relancer le générique.
 */
class DirecteurSonore {

    private var avant: Instant? = null
    /** Écran au moment où la pause a commencé, pour savoir à la reprise s'il a changé entre-temps. */
    private var avantPause: Instant? = null
    /** Parties dont le générique a déjà été joué (une seule fois par partie, même après une reconnexion). */
    private val generiques = mutableSetOf<String>()

    fun observer(maintenant: Instant): List<Ordre> {
        val p = avant
        avant = maintenant
        if (p == null) return premiereFois(maintenant)
        if (maintenant.ecran == Ecran.HORS_PARTIE) {
            return if (p.ecran == Ecran.HORS_PARTIE) emptyList() else listOf(Ordre.Couper, Ordre.Musique(Ambiance.SILENCE))
        }
        if (p.ecran == Ecran.HORS_PARTIE) return premiereFois(maintenant)

        // Pause : on coupe tout ce qui était prévu, une musique douce accompagne l'intermède.
        if (!p.enPause && maintenant.enPause) {
            avantPause = p
            return listOf(Ordre.Couper, Ordre.Musique(Ambiance.INTERMEDE))
        }
        if (maintenant.enPause) return emptyList()
        if (p.enPause) {
            val ecranAvant = avantPause ?: p
            avantPause = null
            return reprise(ecranAvant, maintenant)
        }

        if (changeDEcran(p, maintenant)) return entree(p, maintenant)
        return memeEcran(p, maintenant)
    }

    private fun changeDEcran(a: Instant, b: Instant) = a.ecran != b.ecran || a.index != b.index || a.partie != b.partie

    /** Box qui démarre ou se reconnecte : seulement le générique d'une partie pas encore commencée, sinon la musique. */
    private fun premiereFois(i: Instant): List<Ordre> {
        if (i.ecran == Ecran.HORS_PARTIE) return listOf(Ordre.Musique(Ambiance.SILENCE))
        if (i.enPause) return listOf(Ordre.Musique(Ambiance.INTERMEDE))
        if (i.ecran == Ecran.SALON && i.index < 0 && generiques.add(i.partie)) return generique()
        return listOf(Ordre.Musique(ambiance(i.ecran)))
    }

    private fun generique() = listOf(
        Ordre.Couper,
        Ordre.Musique(Ambiance.SILENCE),
        Ordre.Jouer(Son.GENERIQUE),
        Ordre.Musique(Ambiance.SALON, Tempo.GENERIQUE_FIN),
    )

    /** Décompte 3, 2, 1 de la reprise, puis la musique (ou l'entrée de l'écran s'il a changé pendant la pause). */
    private fun reprise(ecranAvant: Instant, i: Instant): List<Ordre> {
        val dans = i.repriseDansMs.coerceAtLeast(0)
        val n = ((dans + 999) / 1000).toInt().coerceAtMost(5)
        val ordres = mutableListOf<Ordre>()
        for (k in 0 until n) ordres += Ordre.Jouer(Son.pop(k), (dans - (n - k) * 1000L).coerceAtLeast(0))
        ordres += Ordre.Jouer(Son.WHOOSH, dans)
        ordres += if (changeDEcran(ecranAvant, i)) {
            entree(ecranAvant, i).filter { it != Ordre.Couper }.map { it.decale(dans) }
        } else {
            listOf(Ordre.Musique(ambiance(i.ecran), dans))
        }
        return ordres
    }

    private fun entree(p: Instant, i: Instant): List<Ordre> {
        val o = mutableListOf<Ordre>(Ordre.Couper)
        when (i.ecran) {
            Ecran.HORS_PARTIE -> o += Ordre.Musique(Ambiance.SILENCE)
            Ecran.SALON -> if (i.index < 0 && generiques.add(i.partie)) return generique() else {
                o += Ordre.Jouer(Son.WHOOSH)
                o += Ordre.Musique(Ambiance.SALON)
            }
            Ecran.QUESTION -> {
                if (i.premiere || i.superFinale) {
                    o += Ordre.Jouer(Son.MANCHE)
                    o += Ordre.Jouer(Son.IMPACT)
                    o += Ordre.Musique(Ambiance.SILENCE)
                    o += Ordre.Musique(Ambiance.QUESTION, Tempo.QUESTION_MUSIQUE_APRES_MANCHE)
                } else {
                    o += Ordre.Jouer(Son.WHOOSH)
                    o += Ordre.Musique(Ambiance.QUESTION)
                }
                for (k in 0 until i.propositions.coerceIn(0, 8)) {
                    o += Ordre.Jouer(Son.pop(k), Tempo.propositionApparait(k))
                }
            }
            Ecran.MIMES -> if (p.ecran == Ecran.MIMES_TOUR) {
                // Fin d'un tour : coup de sifflet et « ta-daa », applaudissements si l'équipe a trouvé.
                o += Ordre.Jouer(Son.MIME_FIN)
                o += Ordre.Musique(Ambiance.SILENCE)
                if (p.trouves > 0) o += Ordre.Jouer(Son.APPLAUDISSEMENTS, Tempo.MIME_BILAN)
                o += Ordre.Musique(Ambiance.SALON, Tempo.MIME_BILAN_MUSIQUE)
            } else {
                // Ouverture de la manche.
                o += Ordre.Jouer(Son.MANCHE)
                o += Ordre.Jouer(Son.IMPACT)
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Musique(Ambiance.SALON, Tempo.QUESTION_MUSIQUE_APRES_MANCHE)
            }
            Ecran.MIMES_TOUR -> {
                o += Ordre.Jouer(Son.MIME_TOP)
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Musique(Ambiance.MIMES, Tempo.MIME_TOP_IMPACT)
            }
            Ecran.VERROUILLEE -> {
                o += Ordre.Jouer(Son.VERROU)
                o += Ordre.Musique(Ambiance.SUSPENSE)
            }
            Ecran.REVELATION -> {
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Jouer(Son.ROULEMENT_COURT)
                for (k in 0 until (i.propositions - 1).coerceIn(0, 3)) {
                    o += Ordre.Jouer(Son.ETEINT, Tempo.mauvaiseSEteint(k))
                }
                o += Ordre.Jouer(Son.BONNE_REPONSE, Tempo.REVELATION_OR)
                o += Ordre.Jouer(Son.IMPACT, Tempo.REVELATION_OR)
                o += Ordre.Musique(Ambiance.FETE, Tempo.REVELATION_OR)
                for (k in 0 until i.gagnants.coerceIn(0, 8)) {
                    o += Ordre.Jouer(Son.TAMPON, Tempo.tampon(k))
                }
                if (i.gagnants > 0) o += Ordre.Jouer(Son.POINTS, Tempo.REVELATION_POINTS)
            }
            Ecran.CLASSEMENT -> {
                o += Ordre.Jouer(Son.WHOOSH)
                o += Ordre.Jouer(Son.COMPTEUR, Tempo.CLASSEMENT_COMPTEUR)
                if (i.meneurAPoints) o += Ordre.Jouer(Son.COURONNE, Tempo.CLASSEMENT_COURONNE)
                o += Ordre.Musique(Ambiance.FETE)
            }
            Ecran.FIN -> {
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Jouer(Son.ROULEMENT_LONG)
                o += Ordre.Jouer(Son.MONTEE)
                o += Ordre.Jouer(Son.IMPACT, Tempo.FIN_VAINQUEUR)
                o += Ordre.Jouer(Son.FANFARE, Tempo.FIN_VAINQUEUR)
                o += Ordre.Jouer(Son.APPLAUDISSEMENTS, Tempo.FIN_VAINQUEUR)
                o += Ordre.Jouer(Son.CLOCHES, Tempo.FIN_VAINQUEUR + 1_500)
                o += Ordre.Jouer(Son.FIN, Tempo.FIN_JINGLE)
                o += Ordre.Musique(Ambiance.FETE, Tempo.FIN_MUSIQUE)
            }
        }
        return o
    }

    private fun memeEcran(p: Instant, i: Instant): List<Ordre> {
        val o = mutableListOf<Ordre>()
        if (i.equipes > p.equipes) o += Ordre.Jouer(Son.equipe(i.equipes - 1))
        if (i.buzzeur >= 0 && p.buzzeur < 0) {
            o += Ordre.Jouer(Son.equipe(i.buzzeur))
            o += Ordre.Jouer(Son.VERROU)
        }
        if (i.ecran == Ecran.QUESTION) {
            if (i.reponses > p.reponses) o += Ordre.Jouer(Son.REPONSE)
            // La tension des 5 dernières secondes s'arrête quand le temps repart ou que tout le monde a répondu.
            val enTension = p.urgent && !tousOntRepondu(p)
            val tension = i.urgent && !tousOntRepondu(i)
            if (tension && !enTension && !p.urgent) o += Ordre.Jouer(Son.TENSION)
            if (enTension && !tension) o += Ordre.Arreter(Son.TENSION)
        }
        if (i.ecran == Ecran.MIMES_TOUR) {
            if (i.trouves > p.trouves) o += Ordre.Jouer(Son.MIME_TROUVE)
            if (i.passes > p.passes) o += Ordre.Jouer(Son.MIME_PASSE)
            // Dix dernières secondes du tour : la musique s'efface sous la tension.
            if (i.urgent && !p.urgent) {
                o += Ordre.Jouer(Son.MIME_TENSION)
                o += Ordre.Musique(Ambiance.SUSPENSE)
            }
            if (p.urgent && !i.urgent) {
                o += Ordre.Arreter(Son.MIME_TENSION)
                o += Ordre.Musique(Ambiance.MIMES)
            }
        }
        return o
    }

    private fun tousOntRepondu(i: Instant) = i.equipes > 0 && i.reponses >= i.equipes

    private fun ambiance(e: Ecran) = when (e) {
        Ecran.HORS_PARTIE -> Ambiance.SILENCE
        Ecran.SALON -> Ambiance.SALON
        Ecran.QUESTION -> Ambiance.QUESTION
        Ecran.MIMES -> Ambiance.SALON
        Ecran.MIMES_TOUR -> Ambiance.MIMES
        Ecran.VERROUILLEE -> Ambiance.SUSPENSE
        Ecran.REVELATION, Ecran.CLASSEMENT, Ecran.FIN -> Ambiance.FETE
    }
}

/** Ce que montre la TV, réduit à ce qui compte pour le son. */
data class Instant(
    val ecran: Ecran,
    /** Code de la partie : le générique n'est joué qu'une fois par partie. */
    val partie: String = "",
    val index: Int = -1,
    val equipes: Int = 0,
    val reponses: Int = 0,
    val propositions: Int = 4,
    val enPause: Boolean = false,
    /** Temps restant du décompte 3, 2, 1 de la dernière reprise. */
    val repriseDansMs: Long = 0,
    /** Fin du chrono : cinq dernières secondes d'une question, dix d'un tour de mimes. */
    val urgent: Boolean = false,
    /** Place (0, 1, 2…) de l'équipe qui a buzzé, -1 si personne. */
    val buzzeur: Int = -1,
    val premiere: Boolean = false,
    val superFinale: Boolean = false,
    /** Équipes qui marquent des points à cette révélation. */
    val gagnants: Int = 0,
    val meneurAPoints: Boolean = false,
    /** Mimes trouvés et passés pendant le tour en cours. */
    val trouves: Int = 0,
    val passes: Int = 0,
)

/** [MIMES] : manche de mimes entre deux tours ; [MIMES_TOUR] : une équipe mime. */
enum class Ecran { HORS_PARTIE, SALON, QUESTION, MIMES, MIMES_TOUR, VERROUILLEE, REVELATION, CLASSEMENT, FIN }

/** Fond musical : deux boucles jouées ensemble (complète et légère), dosées selon l'ambiance. */
enum class Ambiance(val complete: Float, val legere: Float) {
    SILENCE(0f, 0f),
    SALON(0.55f, 0f),
    QUESTION(0f, 0.6f),
    SUSPENSE(0f, 0.25f),
    FETE(0.8f, 0f),
    /** Tour de mimes : la rythmique entraîne sans couvrir les cris de ceux qui devinent. */
    MIMES(0.45f, 0f),
    INTERMEDE(0f, 0.35f);

    companion object {
        /** Les deux boucles de 16 s (8 mesures), à lancer ensemble pour qu'elles restent calées. */
        const val LIT_COMPLET = "lmp_bed_full"
        const val LIT_LEGER = "lmp_bed_light"
    }
}

/** Les sons de l'habillage ; [fichier] est le nom dans res/raw. Les longs passent par un lecteur dédié. */
enum class Son(val fichier: String, val long: Boolean = false) {
    GENERIQUE("lmp_generique", true),
    TENSION("lmp_tension", true),
    MONTEE("lmp_riser_4b"),
    IMPACT("lmp_impact", true),
    MANCHE("lmp_round_sting"),
    WHOOSH("lmp_whoosh"),
    REPONSE("lmp_tick_answer"),
    VERROU("lmp_lock_clac"),
    ROULEMENT_COURT("lmp_drumroll_2b"),
    ROULEMENT_LONG("lmp_drumroll_4b"),
    ETEINT("lmp_wrong_off"),
    BONNE_REPONSE("lmp_reveal_chime", true),
    TAMPON("lmp_stamp"),
    POINTS("lmp_points_bling"),
    COMPTEUR("lmp_points_count", true),
    COURONNE("lmp_crown_hit", true),
    FANFARE("lmp_victory_fanfare", true),
    APPLAUDISSEMENTS("lmp_applause", true),
    CLOCHES("lmp_prize_bells"),
    FIN("lmp_end_jingle", true),
    POP_1("lmp_pop_1"), POP_2("lmp_pop_2"), POP_3("lmp_pop_3"), POP_4("lmp_pop_4"),
    MIME_TOP("lmp_mime_go", true),
    MIME_TROUVE("lmp_mime_found"),
    MIME_PASSE("lmp_mime_pass"),
    MIME_TENSION("lmp_mime_tension", true),
    MIME_FIN("lmp_mime_time_up", true),
    EQUIPE_1("lmp_team_sting_1"), EQUIPE_2("lmp_team_sting_2"), EQUIPE_3("lmp_team_sting_3"), EQUIPE_4("lmp_team_sting_4");

    companion object {
        private val pops = listOf(POP_1, POP_2, POP_3, POP_4)
        private val equipes = listOf(EQUIPE_1, EQUIPE_2, EQUIPE_3, EQUIPE_4)
        fun pop(k: Int) = pops[Math.floorMod(k, pops.size)]
        fun equipe(place: Int) = equipes[Math.floorMod(place, equipes.size)]
    }
}

sealed interface Ordre {
    data class Jouer(val son: Son, val dansMs: Long = 0) : Ordre
    data class Musique(val ambiance: Ambiance, val dansMs: Long = 0) : Ordre
    data class Arreter(val son: Son) : Ordre
    /** Annule les sons prévus et fait taire les sons longs en cours (changement d'écran, pause). */
    data object Couper : Ordre

    fun decale(ms: Long): Ordre = when (this) {
        is Jouer -> copy(dansMs = dansMs + ms)
        is Musique -> copy(dansMs = dansMs + ms)
        else -> this
    }
}

/** Minutage partagé par les sons et les animations, pour qu'image et son tombent ensemble (120 BPM, un temps = 500 ms). */
object Tempo {
    const val TEMPS = 500L
    const val GENERIQUE_FIN = 9_400L
    /** Durée de l'animation du générique sur le salon. */
    const val GENERIQUE_ANIMATION = 9_000L
    const val QUESTION_MUSIQUE_APRES_MANCHE = 1_500L
    const val PROPOSITIONS_DEBUT = 350L
    const val PROPOSITIONS_PAS = 150L
    const val REVELATION_ETEINT = 1_000L
    const val REVELATION_ETEINT_PAS = 250L
    const val REVELATION_OR = 2_000L
    const val REVELATION_TAMPON = 2_500L
    const val REVELATION_TAMPON_PAS = 200L
    const val REVELATION_POINTS = 3_000L
    const val CLASSEMENT_COMPTEUR = 300L
    const val CLASSEMENT_COURONNE = 1_800L
    const val FIN_VAINQUEUR = 2_000L
    const val FIN_JINGLE = 9_500L
    const val FIN_MUSIQUE = 12_000L
    /** Coup de cuivres du « Top départ » des mimes, après les deux coups de sifflet. */
    const val MIME_TOP_IMPACT = 500L
    const val MIME_BILAN = 1_000L
    const val MIME_BILAN_MUSIQUE = 2_500L

    fun propositionApparait(k: Int) = PROPOSITIONS_DEBUT + k * PROPOSITIONS_PAS
    fun mauvaiseSEteint(k: Int) = REVELATION_ETEINT + k * REVELATION_ETEINT_PAS
    fun tampon(k: Int) = REVELATION_TAMPON + k * REVELATION_TAMPON_PAS
}
