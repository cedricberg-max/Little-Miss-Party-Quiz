package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Soirée du 31/10 : sur le Wi-Fi faible de la box, le téléchargement de la mise à jour restait bloqué à 0 %. */
class TelechargementPatientTest {
    @Test
    fun `on ne renonce jamais tant que le fichier avance, pauses de 3 a 30 s`() {
        assertEquals(12, UpdateViewModel.ESSAIS_TELECHARGEMENT)
        assertEquals(3_000L, PatienceTelechargement.pause(1))
        assertEquals(6_000L, PatienceTelechargement.pause(2))
        assertEquals(30_000L, PatienceTelechargement.pause(50))
        var sans = 0
        // 500 coupures qui font toutes avancer le fichier : jamais d'abandon.
        repeat(500) { sans = PatienceTelechargement.apresCoupure(sans, aAvance = true); assertTrue(!PatienceTelechargement.renoncer(sans)) }
        repeat(11) { sans = PatienceTelechargement.apresCoupure(sans, aAvance = false) }
        assertTrue(!PatienceTelechargement.renoncer(sans))
        // Un seul octet de plus remet le compteur à zéro.
        assertEquals(0, PatienceTelechargement.apresCoupure(sans, aAvance = true))
        assertTrue(PatienceTelechargement.renoncer(PatienceTelechargement.apresCoupure(sans, aAvance = false)))
    }

    /**
     * Un faux serveur comme un Wi-Fi faible : il rame, coupe la connexion tous les ~300 Ko, refuse parfois (503), et
     * sait reprendre (« Range »). Le téléchargement doit finir avec exactement le bon fichier.
     */
    @Test
    fun `wifi faible qui coupe sans arret, le fichier arrive entier et intact`() {
        val donnees = ByteArray(3_000_000) { (it * 31 + it / 7).toByte() }
        val coupure = 300_000
        val serveur = MiniServeur { debut, appel, sortie ->
            if (appel % 4 == 2) {
                sortie.write("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                return@MiniServeur
            }
            val reste = donnees.size - debut
            val entete = StringBuilder(if (debut > 0) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
            if (debut > 0) entete.append("Content-Range: bytes $debut-${donnees.size - 1}/${donnees.size}\r\n")
            entete.append("Content-Length: $reste\r\nConnection: close\r\n\r\n")
            sortie.write(entete.toString().toByteArray())
            val n = minOf(reste, coupure)
            sortie.write(donnees, debut, n / 2); sortie.flush()
            Thread.sleep(5)
            sortie.write(donnees, debut + n / 2, n - n / 2); sortie.flush()
            // Coupure brutale au milieu du fichier (sauf la toute fin) : la connexion se ferme ici.
        }
        try {
            val dossier = java.nio.file.Files.createTempDirectory("maj").toFile()
            val cible = java.io.File(dossier, "lmp-tv-999.apk")
            val url = java.net.URL("http://127.0.0.1:${serveur.port}/apk")
            var essais = 0
            var sans = 0
            while (true) {
                val avant = TelechargementApk.dejaRecu(cible)
                try {
                    TelechargementApk.reprendre(url, cible, donnees.size.toLong(), { (it.openConnection() as java.net.HttpURLConnection).apply { readTimeout = 2_000 } })
                    break
                } catch (e: Exception) {
                    essais++
                    sans = PatienceTelechargement.apresCoupure(sans, TelechargementApk.dejaRecu(cible) > avant)
                    assertTrue("abandon alors que ça avançait ($essais essais)", !PatienceTelechargement.renoncer(sans))
                    assertTrue(essais < 200)
                }
            }
            assertTrue("le faux Wi-Fi a bien coupé plusieurs fois ($essais)", essais >= 8)
            assertTrue(java.util.Arrays.equals(donnees, cible.readBytes()))
            assertTrue(!java.io.File(dossier, "lmp-tv-999.apk.part").exists())
        } finally {
            serveur.close()
        }
    }

    @Test
    fun `un serveur qui ne sait pas reprendre, on repart du debut sans coller deux morceaux`() {
        val donnees = ByteArray(500_000) { (it % 251).toByte() }
        val serveur = MiniServeur { _, _, sortie ->
            sortie.write("HTTP/1.1 200 OK\r\nContent-Length: ${donnees.size}\r\nConnection: close\r\n\r\n".toByteArray())
            sortie.write(donnees)
        }
        try {
            val dossier = java.nio.file.Files.createTempDirectory("maj").toFile()
            val cible = java.io.File(dossier, "lmp-tv-1.apk")
            // Un début déjà reçu (100 Ko) : le serveur renvoie tout le fichier avec 200.
            java.io.File(dossier, "lmp-tv-1.apk.part").writeBytes(donnees.copyOf(100_000))
            TelechargementApk.reprendre(java.net.URL("http://127.0.0.1:${serveur.port}/apk"), cible, donnees.size.toLong(), { it.openConnection() as java.net.HttpURLConnection })
            assertTrue(java.util.Arrays.equals(donnees, cible.readBytes()))
        } finally {
            serveur.close()
        }
    }

    @Test
    fun `le wifi de la box reste allume pendant le telechargement`() {
        val vm = java.io.File("src/main/java/com/littlemissparty/quiz/tv/UpdateViewModel.kt").readText()
        assertTrue(vm.contains("WIFI_MODE_FULL_HIGH_PERF"))
        assertTrue(vm.contains("runCatching { verrou?.release() }"))
        assertTrue(java.io.File("src/main/AndroidManifest.xml").readText().contains("android.permission.WAKE_LOCK"))
    }

    @Test
    fun `secours GitHub, la release de la meme version que publie la CI`() {
        assertEquals(
            "https://github.com/cedricberg-max/Little-Miss-Party-Quiz/releases/download/tv-v0.1.921/little-miss-party-quiz-tv.apk",
            UpdateViewModel.urlGithub("0.1.921"),
        )
        // Même nom de release et même fichier que l'étape de publication de la CI.
        val ci = java.io.File("../.github/workflows/build.yml").readText()
        assertTrue(ci.contains("gh release create \"tv-v0.1.\${{ github.run_number }}\" little-miss-party-quiz-tv.apk"))
        val gradle = java.io.File("build.gradle.kts").readText()
        assertTrue(gradle.contains("versionName = \"0.1.\${System.getenv(\"GITHUB_RUN_NUMBER\")"))
    }

    @Test
    fun `la raison de la coupure est dite en mots simples`() {
        assertEquals("le Wi-Fi ne répond plus, délai dépassé", UpdateViewModel.raisonEnClair(java.net.SocketTimeoutException("Read timed out")))
        assertEquals("pas d'accès à Internet", UpdateViewModel.raisonEnClair(java.net.UnknownHostException("x")))
        assertEquals("Téléchargement incomplet", UpdateViewModel.raisonEnClair(IllegalStateException("Téléchargement incomplet")))
    }

    @Test
    fun `la progression bouge des 64 Ko et l'ecran dit qu'un nouvel essai reprend`() {
        val vm = java.io.File("src/main/java/com/littlemissparty/quiz/tv/UpdateViewModel.kt").readText()
        assertTrue(java.io.File("src/main/java/com/littlemissparty/quiz/tv/TelechargementApk.kt").readText().contains("deja - montre >= BLOC"))
        assertTrue(vm.contains("telechargerAvecPatience(r)"))
        val ecran = java.io.File("src/main/java/com/littlemissparty/quiz/tv/UpdateScreens.kt").readText()
        assertTrue(ecran.contains("reprend là où il s'est arrêté"))
    }
}

/**
 * Tout petit serveur HTTP de test (une connexion à la fois, fermée après chaque réponse) : le serveur du JDK
 * (com.sun.net.httpserver) n'existe pas pour les tests de l'appli Android. [repondre] reçoit le début demandé
 * (« Range: bytes=N- », 0 sans), le numéro de l'appel (à partir de 1) et la sortie de la connexion.
 */
private class MiniServeur(private val repondre: (debut: Int, appel: Int, sortie: java.io.OutputStream) -> Unit) : AutoCloseable {
    private val socket = java.net.ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1"))
    val port: Int get() = socket.localPort
    @Volatile private var ferme = false
    private var appels = 0

    init {
        Thread {
            while (!ferme) {
                val c = runCatching { socket.accept() }.getOrNull() ?: break
                runCatching {
                    c.use { co ->
                        val entree = co.getInputStream().bufferedReader(Charsets.ISO_8859_1)
                        var debut = 0
                        while (true) {
                            val ligne = entree.readLine() ?: break
                            if (ligne.isEmpty()) break
                            if (ligne.startsWith("Range:", ignoreCase = true)) {
                                debut = ligne.substringAfter("bytes=").substringBefore("-").trim().toIntOrNull() ?: 0
                            }
                        }
                        appels++
                        repondre(debut, appels, co.getOutputStream())
                        co.getOutputStream().flush()
                    }
                }
            }
        }.apply { isDaemon = true; start() }
    }

    override fun close() {
        ferme = true
        runCatching { socket.close() }
    }
}
