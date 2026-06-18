import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchLobbyState,
  maybeAdvanceLobby,
  setPlayerReady,
  submitSmileScore,
} from '../lib/lobby'
import { supabase } from '../lib/supabase'
import type { Lobby, LobbyPlayer } from '../types'

export function useLobby(lobbyId: string | null, playerId: string) {
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [players, setPlayers] = useState<LobbyPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scoreSubmitted = useRef(false)

  const refresh = useCallback(async () => {
    if (!lobbyId) return
    const state = await fetchLobbyState(lobbyId)
    setLobby(state.lobby)
    setPlayers(state.players)
    if (state.lobby) {
      await maybeAdvanceLobby(state.lobby, state.players)
    }
  }, [lobbyId])

  useEffect(() => {
    if (!lobbyId || !supabase) {
      setLoading(false)
      return
    }

    let active = true
    scoreSubmitted.current = false

    const load = async () => {
      try {
        await refresh()
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load lobby')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

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
      void refresh()
    }, 500)

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
      } catch (err) {
        scoreSubmitted.current = false
        setError(err instanceof Error ? err.message : 'Could not save score')
      }
    },
    [lobbyId, playerId],
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
