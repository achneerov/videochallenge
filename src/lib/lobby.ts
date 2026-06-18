import { COUNTDOWN_DURATION_MS, CHALLENGE_DURATION_MS } from './constants'
import { supabase } from './supabase'
import type { Lobby, LobbyPlayer } from '../types'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateLobbyCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
  ).join('')
}

export async function createLobby(
  playerId: string,
  displayName: string,
): Promise<{ lobby: Lobby; player: LobbyPlayer }> {
  if (!supabase) throw new Error('Supabase is not configured')

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLobbyCode()
    const { data: lobby, error: lobbyError } = await supabase
      .from('lobbies')
      .insert({
        code,
        host_player_id: playerId,
        status: 'waiting',
      })
      .select()
      .single()

    if (lobbyError) {
      if (lobbyError.code === '23505') continue
      throw lobbyError
    }

    const { data: player, error: playerError } = await supabase
      .from('lobby_players')
      .insert({
        lobby_id: lobby.id,
        player_id: playerId,
        display_name: displayName,
        slot: 1,
      })
      .select()
      .single()

    if (playerError) throw playerError
    return { lobby, player }
  }

  throw new Error('Could not create lobby. Try again.')
}

export async function joinLobby(
  code: string,
  playerId: string,
  displayName: string,
): Promise<{ lobby: Lobby; player: LobbyPlayer }> {
  if (!supabase) throw new Error('Supabase is not configured')

  const normalized = code.trim().toUpperCase()
  const { data: lobby, error: lobbyError } = await supabase
    .from('lobbies')
    .select()
    .eq('code', normalized)
    .maybeSingle()

  if (lobbyError) throw lobbyError
  if (!lobby) throw new Error('Lobby not found')
  if (lobby.status !== 'waiting') throw new Error('This game already started')

  const { data: existingPlayers, error: playersError } = await supabase
    .from('lobby_players')
    .select()
    .eq('lobby_id', lobby.id)

  if (playersError) throw playersError

  const alreadyJoined = existingPlayers?.some((p) => p.player_id === playerId)
  if (alreadyJoined) {
    const self = existingPlayers!.find((p) => p.player_id === playerId)!
    return { lobby, player: self }
  }

  if ((existingPlayers?.length ?? 0) >= 2) {
    throw new Error('Lobby is full')
  }

  const { data: player, error: playerError } = await supabase
    .from('lobby_players')
    .insert({
      lobby_id: lobby.id,
      player_id: playerId,
      display_name: displayName,
      slot: 2,
    })
    .select()
    .single()

  if (playerError) throw playerError
  return { lobby, player }
}

export async function fetchLobbyState(lobbyId: string): Promise<{
  lobby: Lobby | null
  players: LobbyPlayer[]
}> {
  if (!supabase) return { lobby: null, players: [] }

  const [{ data: lobby }, { data: players }] = await Promise.all([
    supabase.from('lobbies').select().eq('id', lobbyId).maybeSingle(),
    supabase
      .from('lobby_players')
      .select()
      .eq('lobby_id', lobbyId)
      .order('slot'),
  ])

  return { lobby, players: players ?? [] }
}

export async function setPlayerReady(
  lobbyId: string,
  playerId: string,
  ready: boolean,
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from('lobby_players')
    .update({ is_ready: ready })
    .eq('lobby_id', lobbyId)
    .eq('player_id', playerId)

  if (error) throw error
}

export async function submitSmileScore(
  lobbyId: string,
  playerId: string,
  score: number,
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from('lobby_players')
    .update({ smile_score: Math.round(score * 10) / 10 })
    .eq('lobby_id', lobbyId)
    .eq('player_id', playerId)

  if (error) throw error
}

export async function maybeAdvanceLobby(
  lobby: Lobby,
  players: LobbyPlayer[],
): Promise<void> {
  if (!supabase) return

  const bothReady =
    players.length === 2 && players.every((player) => player.is_ready)
  const now = Date.now()

  if (lobby.status === 'waiting' && bothReady) {
    await supabase
      .from('lobbies')
      .update({
        status: 'countdown',
        countdown_starts_at: new Date().toISOString(),
      })
      .eq('id', lobby.id)
      .eq('status', 'waiting')
    return
  }

  if (lobby.status === 'countdown' && lobby.countdown_starts_at) {
    const countdownEnd =
      new Date(lobby.countdown_starts_at).getTime() + COUNTDOWN_DURATION_MS
    if (now >= countdownEnd) {
      await supabase
        .from('lobbies')
        .update({
          status: 'active',
          started_at: new Date().toISOString(),
        })
        .eq('id', lobby.id)
        .eq('status', 'countdown')
    }
    return
  }

  if (lobby.status === 'active' && lobby.started_at) {
    const gameEnd =
      new Date(lobby.started_at).getTime() + CHALLENGE_DURATION_MS
    if (now >= gameEnd) {
      await supabase
        .from('lobbies')
        .update({ status: 'finished' })
        .eq('id', lobby.id)
        .eq('status', 'active')
    }
  }
}

export async function leaveLobby(
  lobbyId: string,
  playerId: string,
): Promise<void> {
  if (!supabase) return

  await supabase
    .from('lobby_players')
    .delete()
    .eq('lobby_id', lobbyId)
    .eq('player_id', playerId)

  const { data: remaining } = await supabase
    .from('lobby_players')
    .select('id')
    .eq('lobby_id', lobbyId)

  if (!remaining?.length) {
    await supabase.from('lobbies').delete().eq('id', lobbyId)
  }
}
