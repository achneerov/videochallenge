import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchLobbyState,
  maybeAdvanceLobby,
  setPlayerReady,
  submitSmileScore,
} from '../lib/lobby'
import { debugError } from '../lib/debug'
import { supabase } from '../lib/supabase'
import type { Lobby, LobbyPlayer } from '../types'

function lobbySnapshot(lobby: Lobby | null): string {
  if (!lobby) return ''
  return [
    lobby.status,
    lobby.countdown_starts_at,
    lobby.started_at,
    lobby.host_player_id,
  ].join('|')
}

function playersSnapshot(players: LobbyPlayer[]): string {
  return players
    .map(
      (p) =>
        `${p.player_id}:${p.slot}:${p.is_ready}:${p.smile_score}:${p.display_name}`,
    )
    .join('|')
}

export function useLobby(lobbyId: string | null, playerId: string) {
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [players, setPlayers] = useState<LobbyPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scoreSubmitted = useRef(false)
  const lobbyStatusRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!lobbyId) return
    const state = await fetchLobbyState(lobbyId)

    setLobby((prev) =>
      lobbySnapshot(prev) === lobbySnapshot(state.lobby) ? prev : state.lobby,
    )
    setPlayers((prev) =>
      playersSnapshot(prev) === playersSnapshot(state.players)
        ? prev
        : state.players,
    )

    if (state.lobby) {
      lobbyStatusRef.current = state.lobby.status
      await maybeAdvanceLobby(state.lobby, state.players, playerId)
    }
  }, [lobbyId, playerId])

  useEffect(() => {
    if (!lobbyId || !supabase) {
      setLoading(false)
      return
    }

    let active = true
    scoreSubmitted.current = false
    lobbyStatusRef.current = null

    const load = async () => {
      try {
        await refresh()
      } catch (err) {
        debugError('useLobby', 'initial load failed', err)
        if (active) setError(err instanceof Error ? err.message : 'Failed to load lobby')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()

    const channel = supabase
      .channel(`lobby-state:${lobbyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lobbies',
          filter: `id=eq.${lobbyId}`,
        },
        () => {
          void refresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lobby_players',
          filter: `lobby_id=eq.${lobbyId}`,
        },
        () => {
          void refresh()
        },
      )
      .subscribe()

    const tick = window.setInterval(() => {
      if (lobbyStatusRef.current === 'finished') return
      void refresh()
    }, 1000)

    return () => {
      active = false
      window.clearInterval(tick)
      if (supabase) void supabase.removeChannel(channel)
    }
  }, [lobbyId, refresh])

  const toggleReady = useCallback(
    async (ready: boolean) => {
      if (!lobbyId) return
      setError(null)
      try {
        await setPlayerReady(lobbyId, playerId, ready)
        await refresh()
      } catch (err) {
        debugError('useLobby', 'toggleReady failed', err)
        setError(err instanceof Error ? err.message : 'Could not update ready state')
      }
    },
    [lobbyId, playerId, refresh],
  )

  const reportScore = useCallback(
    async (score: number) => {
      if (!lobbyId || scoreSubmitted.current) return
      scoreSubmitted.current = true
      try {
        await submitSmileScore(lobbyId, playerId, score)
        await refresh()
      } catch (err) {
        scoreSubmitted.current = false
        debugError('useLobby', 'reportScore failed', err)
        setError(err instanceof Error ? err.message : 'Could not save score')
      }
    },
    [lobbyId, playerId, refresh],
  )

  const me = players.find((player) => player.player_id === playerId) ?? null
  const opponent = players.find((player) => player.player_id !== playerId) ?? null

  return {
    lobby,
    players,
    me,
    opponent,
    loading,
    error,
    toggleReady,
    reportScore,
    refresh,
  }
}
