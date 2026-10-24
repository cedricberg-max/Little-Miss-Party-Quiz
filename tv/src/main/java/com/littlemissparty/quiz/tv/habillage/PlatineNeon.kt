package com.littlemissparty.quiz.tv.habillage

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Platine néon du Blind test (The Game Show, choix de cedric du 24/10) : la partie calcul, sans Android.
 *
 * Le disque (socle, plateau, sillons irisés, comètes, balayage, diodes, étiquette) est une boucle vidéo à transparence
 * calculée en 3D une fois pour toutes (res/raw/gs_bt_disque.mp4, deux tours en 3,64 s), le bras une planche de 9
 * positions (res/drawable-nodpi/gs_bt_bras.webp). Tout ce qui bouge avec la musique est dessiné en direct par-dessus,
 * à partir d'ici : la couronne d'égaliseur autour du socle, les ondes de choc sur le disque, les éventails de lasers
 * fins, l'hologramme au-dessus de l'axe, l'étincelle du diamant. Mêmes réglages de caméra que le rendu 3D
 * (tools/habillage/platine-neon/platine-appli.html), pour que les traits tombent pile sur l'image.
 *
 * Tout est en coordonnées de l'image du disque : x de 0 à 1 sur la largeur, y de 0 à 1 sur la hauteur.
 * Rien ici ne touche à la partie : ce n'est que de la lumière.
 */
internal object PlatineNeon {
    /** Taille de l'image du disque (rendu 3D), en pixels. */
    const val LARGEUR = 1012f
    const val HAUTEUR = 900f

    /** Partie couleur de la vidéo du disque : les 1008 premières colonnes (largeur multiple de 16 pour le décodeur). */
    const val VIDEO_L = 1008

    /** Planche du bras : 3 × 3 positions de BRAS_L × BRAS_H, chacune à (BRAS_X, BRAS_Y) dans l'image du disque. */
    const val BRAS_X = 593
    const val BRAS_Y = 249
    const val BRAS_L = 379
    const val BRAS_H = 319

    /** Caméra du rendu 3D : champ vertical 27°, élévation 33°, distance 6,8, visée (0,08 ; 0,05 ; 0). */
    private const val CHAMP = 27.0
    private const val ELEVATION = 33.0
    private const val DISTANCE = 6.8
    private const val VISEE_X = 0.08
    private const val VISEE_Y = 0.05

    // Repère de la caméra (comme three.js lookAt, haut = +y).
    private val pos: DoubleArray
    private val avant: DoubleArray
    private val droite: DoubleArray
    private val haut: DoubleArray
    private val focale = 1.0 / tan(CHAMP / 2 * PI / 180)
    private const val ASPECT = LARGEUR / HAUTEUR

    init {
        val el = ELEVATION * PI / 180
        pos = doubleArrayOf(VISEE_X, sin(el) * DISTANCE + VISEE_Y, cos(el) * DISTANCE)
        avant = norme(doubleArrayOf(VISEE_X - pos[0], VISEE_Y - pos[1], -pos[2]))
        droite = norme(doubleArrayOf(-avant[2], 0.0, avant[0]))                // avant × (0, 1, 0)
        haut = doubleArrayOf(                                                    // droite × avant
            droite[1] * avant[2] - droite[2] * avant[1],
            droite[2] * avant[0] - droite[0] * avant[2],
            droite[0] * avant[1] - droite[1] * avant[0],
        )
    }

    private fun norme(v: DoubleArray): DoubleArray {
        val n = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
        return doubleArrayOf(v[0] / n, v[1] / n, v[2] / n)
    }

    /** Point du monde → image : x, y (0..1) écrits dans [sortie] à [i] ; renvoie la profondeur (distance à la caméra). */
    fun projeter(x: Double, y: Double, z: Double, sortie: FloatArray, i: Int): Double {
        val dx = x - pos[0]; val dy = y - pos[1]; val dz = z - pos[2]
        val xc = dx * droite[0] + dy * droite[1] + dz * droite[2]
        val yc = dx * haut[0] + dy * haut[1] + dz * haut[2]
        val zc = dx * avant[0] + dy * avant[1] + dz * avant[2]
        sortie[i] = ((xc * focale / ASPECT / zc + 1) / 2).toFloat()
        sortie[i + 1] = ((1 - yc * focale / zc) / 2).toFloat()
        return zc
    }

    /** Largeur à l'écran (fraction de la largeur de l'image) d'une longueur [l] du monde vue à la profondeur [zc]. */
    fun largeur(l: Double, zc: Double): Float = (l * focale / zc * HAUTEUR / 2 / LARGEUR).toFloat()

    // ---------------------------------------------------------------------------------------------- repères 3D
    const val ROSE = 0xFF2D95L
    const val CYAN = 0x00F0FFL
    const val VIOLET = 0x8B2CFFL
    private val TROIS = longArrayOf(CYAN, ROSE, VIOLET)
    const val BARRES = 72
    private const val R0 = 1.24
    private const val Y_BARRES = -0.07

    /** Pointe du diamant posée sur le disque (rendu 3D, bras au jeu). */
    private val DIAMANT = doubleArrayOf(0.5791, 0.05, 0.4587)

    /** Temps de l'appli (ms depuis le départ des musiques) : battement, temps fort de la mesure, âge du temps (s). */
    class Temps(ms: Long) {
        val indice: Long = Math.floorDiv(ms, Tempo.TEMPS)
        val age: Float = (ms - indice * Tempo.TEMPS) / 1000f
        val fort: Boolean = Math.floorMod(indice, 4L) == 0L
        /** 1 sur le temps, retombe en un tiers de seconde. */
        val battement: Float = exp(-age * 6f)
    }

    /**
     * Ce que montre la platine à un instant : [t] horloge (s) ; [ms] temps de l'appli ; [vie] 0 → 1 quand l'extrait
     * joue ; [niveau] hauteur de l'égaliseur ; [holo] hologramme déployé (0 → 1) ; [leve] bras posé (0) ou relevé (1) ;
     * [ecoute] l'extrait s'entend en ce moment.
     */
    class Etat(val t: Float, val ms: Long, val vie: Float, val niveau: Float, val holo: Float, val leve: Float, val ecoute: Boolean)

    enum class Genre { LIGNE, BARRE, DEGRADE, REMPLI, LUEUR, NOTE }

    /**
     * Un trait de lumière. LIGNE : ligne brisée [points] (x0, y0, x1, y1…), fermée si [ferme] ; BARRE : segment qui
     * s'allume de son pied (35 %) à sa tête ; DEGRADE : segment dont l'éclat s'éteint vers son bout ; REMPLI : polygone
     * plein ; LUEUR : halo rond (centre, rayons x et y) ; NOTE : note de musique (centre, taille dans [largeur],
     * [etirement] = largeur apparente quand elle tourne). Épaisseurs et rayons : en fraction de la largeur de l'image.
     */
    class Trait(
        val genre: Genre,
        val points: FloatArray,
        val couleur: Long,
        val alpha: Float,
        val largeur: Float = 0f,
        val ferme: Boolean = false,
        val etirement: Float = 1f,
    )

    /** Les trois couches : sous le disque, sur le disque (sous le bras), devant tout. */
    class Calques(val derriere: List<Trait>, val milieu: List<Trait>, val devant: List<Trait>)

    /** Couleur d'une barre : rose → violet → cyan autour de la couronne, en miroir (comme le rendu 3D). */
    fun couleurBarre(k: Int): Long {
        val u = abs(((k.toFloat() / BARRES) * 2 + 0.5f) % 2 - 1)
        return if (u < 0.5f) melange(ROSE, VIOLET, u * 2) else melange(VIOLET, CYAN, (u - 0.5f) * 2)
    }

    fun melange(a: Long, b: Long, u: Float): Long {
        fun c(x: Long, d: Int) = ((x shr d) and 0xFF).toFloat()
        fun m(d: Int) = (c(a, d) + (c(b, d) - c(a, d)) * u.coerceIn(0f, 1f)).toLong().coerceIn(0L, 255L) shl d
        return m(16) or m(8) or m(0)
    }

    /**
     * Niveau d'une barre de 0 à 1, sans les vraies fréquences de la chanson (secours de la maquette) : les graves
     * (devant) frappent sur le temps, les aigus (derrière) ondulent plus vite.
     */
    fun niveauBarre(k: Int, t: Float, battement: Float): Float {
        val s = abs(((k.toFloat() / BARRES) * 2 + 1) % 2 - 1)        // 0 devant, 1 derrière
        val v = 0.16f + 0.55f * battement * (1 - 0.55f * s) +
            0.2f * abs(sin(t * (2.3f + 1.6f * s) + k * 0.37f)) + 0.13f * abs(sin(t * 5.1f + k * 1.3f))
        return v.coerceIn(0f, 1f)
    }

    /**
     * Lasers d'un temps : un éventail fin sur chaque temps, deux fois plus de rayons sur le premier temps de la mesure ;
     * chaque rayon s'éteint en moins d'une demi-seconde. Renvoie l'éclat (0 = éteint) du rayon [n] (0..11).
     */
    fun eclatLaser(n: Int, temps: Temps, ecoute: Boolean): Float {
        if (!ecoute || temps.age >= 0.45f) return 0f
        if (!temps.fort && n >= 6) return 0f
        return exp(-temps.age * 7f) * if (temps.fort) 1.2f else 0.85f
    }

    /** Mémoire des pics de l'égaliseur (ils retombent doucement) : à garder d'une image à l'autre. */
    class Pics {
        val hauteurs = FloatArray(BARRES)
        var dernier = -1f
    }

    private fun cercle(r: Double, y: Double, n: Int, de: Double = 0.0, a: Double = 2 * PI): FloatArray {
        val p = FloatArray(n * 2)
        for (k in 0 until n) {
            val th = de + a * k / (if (a >= 2 * PI) n else n - 1)
            projeter(r * cos(th), y, r * sin(th), p, k * 2)
        }
        return p
    }

    // Formes fixes (projetées une fois) : bord du disque, couronne en deux moitiés.
    private val bordDisque = cercle(1.03, -0.01, 72)
    private val couronneDerriere = cercle(R0, Y_BARRES, 48, PI, PI)
    private val couronneDevant = cercle(R0, Y_BARRES, 48, 0.0, PI)

    /** Toute la lumière dessinée en direct à cet instant. [pics] garde la mémoire des pics entre deux images. */
    fun calques(e: Etat, pics: Pics): Calques {
        val derriere = ArrayList<Trait>(48)
        val milieu = ArrayList<Trait>(8)
        val devant = ArrayList<Trait>(80)
        val temps = Temps(e.ms)
        val b = if (e.ecoute) temps.battement else 0f
        val dt = if (pics.dernier < 0f) 0f else (e.t - pics.dernier).coerceIn(0f, 0.2f)
        pics.dernier = e.t
        val p = FloatArray(4)

        // Halo sous le socle : il respire sur le temps.
        val ph = FloatArray(4)
        projeter(0.0, -0.22, 0.0, ph, 0)
        projeter(1.9, -0.22, 0.0, ph, 2)
        val rx = ph[2] - ph[0]
        derriere += Trait(Genre.LUEUR, floatArrayOf(ph[0], ph[1], rx, rx * 0.42f), VIOLET, (0.1f + 0.22f * b) * e.vie)

        // Couronne d'égaliseur : 72 barres couchées sur le plateau, de R0 vers l'extérieur ; derrière le disque ou devant.
        for (k in 0 until BARRES) {
            val a = k.toDouble() / BARRES * 2 * PI + PI / 2
            val c = cos(a); val s = sin(a)
            val h = ((0.02 + 0.3 * niveauBarre(k, e.t, b).toDouble().pow(1.8) * (1 + 0.3 * b)) * e.niveau + 0.012)
            pics.hauteurs[k] = max(h.toFloat(), pics.hauteurs[k] - 0.36f * dt)
            val zc = projeter(c * R0, Y_BARRES, s * R0, p, 0)
            projeter(c * (R0 + h), Y_BARRES, s * (R0 + h), p, 2)
            val calque = if (s < 0) derriere else devant
            // Barre de 0,028 aux bords fondus dans le rendu 3D : un trait net de 0,016 et son halo.
            calque += Trait(Genre.BARRE, p.copyOf(), couleurBarre(k), 0.95f, largeur(0.016, zc))
            val rp = R0 + pics.hauteurs[k] + 0.03
            val pp = FloatArray(4)
            projeter(c * (rp - 0.015), Y_BARRES, s * (rp - 0.015), pp, 0)
            projeter(c * (rp + 0.015), Y_BARRES, s * (rp + 0.015), pp, 2)
            calque += Trait(Genre.LIGNE, pp, 0xEEEEFFL, 0.3f + 0.7f * e.niveau, largeur(0.016, zc))
        }
        val anneau = (0.35f + 0.3f * e.niveau + 0.35f * b).coerceIn(0f, 1f)
        derriere += Trait(Genre.LIGNE, couronneDerriere, CYAN, anneau, 0.0022f)
        devant += Trait(Genre.LIGNE, couronneDevant, CYAN, anneau, 0.0026f)

        // Disque arrêté : un voile sombre l'éteint un peu (la vidéo, elle, est figée).
        if (e.vie < 0.99f) milieu += Trait(Genre.REMPLI, bordDisque, 0x000000L, 0.45f * (1 - e.vie), ferme = true)

        // Le bord du disque s'embrase sur chaque temps (dans la vidéo, il garde son éclat moyen).
        if (e.ecoute && b > 0.03f) milieu += Trait(Genre.LIGNE, bordDisque, 0xCFFBFFL, (0.75f * b * e.vie).coerceIn(0f, 1f), 0.0042f, ferme = true)

        // Ondes de choc : une par temps, du cœur du disque vers le bord.
        if (e.ecoute) for (n in 0..2) {
            val kk = temps.indice - n
            val age = ((e.ms - kk * Tempo.TEMPS) / 1000f) / 0.55f
            if (age >= 1f) continue
            val r = 0.36 + (1 - 0.36) * age.toDouble().pow(0.7)
            val couleur = TROIS[Math.floorMod(kk, 3L).toInt()]
            val fort = Math.floorMod(kk, 4L) == 0L
            milieu += Trait(Genre.LIGNE, cercle(r, 0.006, 64), couleur, ((1 - age) * if (fort) 0.95f else 0.6f), 0.0032f, ferme = true)
        }

        // L'étincelle du diamant, quand la pointe est dans le sillon.
        if (e.leve < 0.05f && e.vie > 0.01f) {
            val zc = projeter(DIAMANT[0], DIAMANT[1], DIAMANT[2], p, 0)
            val r = largeur(0.09 + 0.05 * b, zc)
            val eclat = e.vie * (0.75f + 0.25f * sin(e.t * 37f) * sin(e.t * 23f)) * (1 + 0.6f * b) * (1 - e.leve / 0.05f)
            milieu += Trait(Genre.LUEUR, floatArrayOf(p[0], p[1], r, r * HAUTEUR / LARGEUR), 0xFF9AD8L, (0.8f * eclat).coerceIn(0f, 1f))
        }

        // Hologramme au-dessus de l'axe : cône de lumière, trois anneaux qui tanguent, une note qui tourne.
        if (e.holo > 0.01f) {
            val hv = e.holo.toDouble()
            val yb = 0.1; val yh = 0.1 + 0.78 * hv
            val cone = FloatArray(8)
            projeter(-0.03, yb, 0.0, cone, 0); projeter(0.03, yb, 0.0, cone, 2)
            projeter(0.27, yh, 0.0, cone, 4); projeter(-0.27, yh, 0.0, cone, 6)
            devant += Trait(Genre.REMPLI, cone, 0x9CF8FFL, 0.18f * e.holo, ferme = true)
            devant += Trait(Genre.LIGNE, floatArrayOf(cone[0], cone[1], cone[6], cone[7]), CYAN, 0.55f * e.holo, 0.002f)
            devant += Trait(Genre.LIGNE, floatArrayOf(cone[2], cone[3], cone[4], cone[5]), VIOLET, 0.55f * e.holo, 0.002f)
            for (i in 0..2) {                                                      // lignes de balayage qui montent
                val u = ((e.t * 0.45f + i / 3f) % 1f).toDouble()
                devant += Trait(Genre.LIGNE, cercle(0.03 + 0.24 * u, yb + 0.78 * hv * u, 32), melange(CYAN, VIOLET, u.toFloat()),
                    (0.5f * (1 - u.toFloat()).pow(2) * e.holo), 0.0018f, ferme = true)
            }
            for (n in 0..2) {
                val r = (0.13 + n * 0.055) * (1 + 0.25 * b * if (n == 1) 1.0 else 0.5)
                val ax = 0.25 * sin(e.t * 1.3 + n * 2); val az = 0.25 * cos(e.t * 1.1 + n)
                val yy = (0.26 + n * 0.17) * hv
                val pts = FloatArray(80)
                for (k in 0 until 40) {
                    val th = 2 * PI * k / 40
                    val x0 = r * cos(th); val z0 = r * sin(th)
                    val y1 = -z0 * sin(ax); val z1 = z0 * cos(ax)                        // tangage autour de x
                    val x2 = x0 * cos(az) - y1 * sin(az); val y2 = x0 * sin(az) + y1 * cos(az)   // puis autour de z
                    projeter(x2, yy + y2, z1, pts, k * 2)
                }
                devant += Trait(Genre.LIGNE, pts, if (n == 1) ROSE else CYAN, 0.9f * e.holo, 0.0028f, ferme = true)
            }
            val zc = projeter(0.0, 0.92 * hv, 0.0, p, 0)
            devant += Trait(Genre.NOTE, floatArrayOf(p[0], p[1]), CYAN, 0.9f * e.holo, largeur(0.34, zc), etirement = cos(e.t * 1.6f))
        }

        // Lasers fins qui jaillissent du bord arrière du disque, vers le haut, sur les temps.
        for (n in 0 until 12) {
            val eclat = eclatLaser(n, temps, e.ecoute) * e.vie
            if (eclat <= 0.01f) continue
            val j = if (temps.fort) n else n * 2 + Math.floorMod(temps.indice, 2L).toInt()
            val a = PI + 0.4 + (j / 11.0) * (PI - 0.8)
            val bal = (if (Math.floorMod(temps.indice, 2L) == 1L) 1 else -1) * temps.age * 0.6
            val dx = cos(a) * 0.45 + (j - 5.5) * 0.025 + bal; val dy = 1.0; val dz = sin(a) * 0.3 - 0.25
            val l = 2.4 / sqrt(dx * dx + dy * dy + dz * dz)
            val ox = cos(a); val oz = sin(a)
            val seg = FloatArray(4)
            val zc = projeter(ox, 0.0, oz, seg, 0)
            projeter(ox + dx * l, dy * l, oz + dz * l, seg, 2)
            val couleur = TROIS[j % 3]
            devant += Trait(Genre.DEGRADE, seg, couleur, (0.3f * eclat).coerceIn(0f, 1f), largeur(0.03, zc))
            devant += Trait(Genre.DEGRADE, seg.copyOf(), 0xFFFFFFL, eclat.coerceIn(0f, 1f), largeur(0.007, zc))
            val r = largeur(0.07, zc)
            devant += Trait(Genre.LUEUR, floatArrayOf(seg[0], seg[1], r, r * HAUTEUR / LARGEUR), couleur, (0.9f * eclat).coerceIn(0f, 1f))
        }
        return Calques(derriere, milieu, devant)
    }

    /** Bras : 9 positions de la planche, de posé (0) à relevé (8). Renvoie l'image et la part de la suivante (fondu). */
    fun imageBras(leve: Float): Pair<Int, Float> {
        val x = leve.coerceIn(0f, 1f) * 8
        val k = min(7, floor(x).toInt())
        return k to (x - k)
    }
}
