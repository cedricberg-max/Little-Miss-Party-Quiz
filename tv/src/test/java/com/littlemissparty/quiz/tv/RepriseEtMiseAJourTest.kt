package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Soirée du 31/10 : la box refusait « Rechercher une mise à jour » au salon (une page fantôme rejoignait chaque nouvelle
 * partie), et, démarrée sans Wi-Fi, proposait de reprendre une partie vide que cedric avait quittée.
 */
class RepriseEtMiseAJourTest {
    private val equipes = listOf("e0", "e1").map { Team(it, it, "#fff", 0L) }
    private fun partie(phase: Phase, teams: List<Team> = equipes) = UiState.Playing(code = "ABCDE", joinUrl = "", teams = teams, phase = phase)

    @Test
    fun `mise a jour a la main, jamais bloquee au salon ni sur l'ecran Reprendre, seulement pendant la prestation`() {
        assertFalse(manualUpdateBlocked(partie(Phase.LOBBY)))
        assertFalse(manualUpdateBlocked(partie(Phase.LOBBY, emptyList())))
        assertFalse(manualUpdateBlocked(partie(Phase.ENDED)))
        assertFalse(manualUpdateBlocked(UiState.ResumeOffer("ABCDE", listOf("e0"), 10)))
        assertFalse(manualUpdateBlocked(UiState.Connecting))
        assertTrue(manualUpdateBlocked(partie(Phase.QUESTION)))
        assertTrue(manualUpdateBlocked(partie(Phase.SCORES)))
        // La proposition faite d'elle-même par la box, elle, attend toujours un salon vide (rien ne change).
        assertTrue(gameInProgress(partie(Phase.LOBBY)))
    }

    @Test
    fun `reprise au demarrage, rien a l'aveugle, salon rouvert sans question, plus de 24 h oubliee`() {
        val maintenant = 1_800_000_000_000L
        val hier = maintenant - REPRISE_MAX_MS - 60_000
        val tout = maintenant - 3_600_000
        // Une prestation commencée il y a une heure : proposée.
        assertTrue(decisionReprise(Phase.QUESTION.code, tout, maintenant) is Reprise.Proposer)
        assertTrue(decisionReprise(Phase.SCORES.code, tout, maintenant) is Reprise.Proposer)
        // Un salon pas encore commencé (équipes ou non) : la box y revient sans rien proposer.
        assertEquals(Reprise.Rouvrir, decisionReprise(Phase.LOBBY.code, tout, maintenant))
        // Finie, illisible ou vieille de plus de 24 h : oubliée, une nouvelle partie.
        assertEquals(Reprise.Rien, decisionReprise(Phase.ENDED.code, tout, maintenant))
        assertEquals(Reprise.Rien, decisionReprise(null, tout, maintenant))
        assertEquals(Reprise.Rien, decisionReprise(Phase.QUESTION.code, hier, maintenant))
        assertEquals(Reprise.Rien, decisionReprise(Phase.LOBBY.code, hier, maintenant))
        // Heure inconnue : on se fie à la phase.
        assertTrue(decisionReprise(Phase.QUESTION.code, null, maintenant) is Reprise.Proposer)
    }

    @Test
    fun `demarrage sans Internet, aucune reprise proposee a l'aveugle, Reessayer refait le choix`() {
        val source = java.io.File("src/main/java/com/littlemissparty/quiz/tv/GameViewModel.kt").readText()
        // L'ancienne reprise à l'aveugle (sans réseau, une offre vide) n'existe plus.
        assertFalse(source.contains("?: return UiState.ResumeOffer(code, emptyList()"))
        assertTrue(source.contains("?: return Reprise.SansReseau"))
        assertTrue(source.contains("fun retry() = if (activeCode != null && !repriseADecider) resume() else start()"))
        assertTrue(SANS_RESEAU_AU_DEMARRAGE.contains("Wi-Fi"))
    }
}
