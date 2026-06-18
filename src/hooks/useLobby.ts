import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchLobbyState,
  maybeAdvanceLobby,
  setPlayerReady,
  submitSmileScore,
} from '../lib/lobby'
import { debug, debugError } from '../lib/debug'
import { supabase } from '../lib/supabase'
import type { Lobby, LobbyPlayer } from '../types'

export function useLobby(lobbyId: string | null, playerId: string) {
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [players, setPlayers] = useState<LobbyPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scoreSubmitted = useRef(false)

  debug('useLobby', 'hook init', { lobbyId, playerId })

  const refresh = useCallback(async () => {
    if (!lobbyId) {
      debug('useLobby', 'refresh skipped — no lobbyId')
      return
    }
    debug('useLobby', 'refresh start', { lobbyId })
    const state = await fetchLobbyState(lobbyId)
    debug('useLobby', 'refresh got state', state)
    setLobby(state.lobby)
    setPlayers(state.players)
    if (state.lobby) {
      await maybeAdvanceLobby(state.lobby, state.players)
    }
  }, [lobbyId])

  useEffect(() => {
    debug('useLobby', 'effect run', { lobbyId, hasSupabase: Boolean(supabase) })

    if (!lobbyId || !supabase) {
      debug('useLobby', 'effect abort — missing lobbyId or supabase')
      setLoading(false)
      return
    }

    let active = true
    scoreSubmitted.current = false

    const load = async () => {
      debug('useLobby', 'initial load start')
      try {
        await refresh()
      } catch (err) {
        debugError('useLobby', 'initial load failed', err)
        if (active) setError(err instanceof Error ? err.message : 'Failed to load lobby')
      } finally {
        if (active) {
          debug('useLobby', 'initial load done')
          setLoading(false)
        }
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
        (payload) => {
          debug('useLobby', 'realtime: lobbies change', payload)
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
        (payload) => {
          debug('useLobby', 'realtime: lobby_players change', payload)
          void refresh()
        },
      )
      .subscribe((status, err) => {
        debug('useLobby', 'realtime subscribe status', { status, err })
      })

    const tick = window.setInterval(() => {
      debug('useLobby', 'poll tick')
      void refresh()
    }, 500)

    return () => {
      debug('useLobby', 'cleanup', { lobbyId })
      active = false
      window.clearInterval(tick)
      if (supabase) void supabase.removeChannel(channel)
    }
  }, [lobbyId, refresh])

  useEffect(() => {
    debug('useLobby', 'state update', {
      lobbyStatus: lobby?.status,
      playerCount: players.length,
      players: players.map((p) => ({
        name: p.display_name,
        slot: p.slot,
        ready: p.is_ready,
        score: p.smile_score,
      })),
      loading,
      error,
    })
  }, [lobby, players, loading, error])

  const toggleReady = useCallback(
    async (ready: boolean) => {
      debug('useLobby', 'toggleReady', { lobbyId, playerId, ready })
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
      debug('useLobby', 'reportScore called', {
        lobbyId,
        playerId,
        score,
        alreadySubmitted: scoreSubmitted.current,
      })
      if (!lobbyId || scoreSubmitted.current) return
      scoreSubmitted.current = true
      try {
        await submitSmileScore(lobbyId, playerId, score)
      } catch (err) {
        scoreSubmitted.current = false
        debugError('useLobby', 'reportScore failed', err)
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
