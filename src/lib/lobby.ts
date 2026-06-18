import { COUNTDOWN_DURATION_MS, CHALLENGE_DURATION_MS } from './constants'
import { debug, debugError } from './debug'
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
  debug('LobbyAPI', 'createLobby called', { playerId, displayName })
  if (!supabase) throw new Error('Supabase is not configured')

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLobbyCode()
    debug('LobbyAPI', `createLobby attempt ${attempt + 1}`, { code })

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
      debugError('LobbyAPI', 'createLobby insert lobbies failed', lobbyError)
      if (lobbyError.code === '23505') continue
      throw lobbyError
    }

    debug('LobbyAPI', 'Lobby row created', lobby)

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

    if (playerError) {
      debugError('LobbyAPI', 'createLobby insert player failed', playerError)
      throw playerError
    }

    debug('LobbyAPI', 'createLobby success', { lobby, player })
    return { lobby, player }
  }

  throw new Error('Could not create lobby. Try again.')
}

export async function joinLobby(
  code: string,
  playerId: string,
  displayName: string,
): Promise<{ lobby: Lobby; player: LobbyPlayer }> {
  debug('LobbyAPI', 'joinLobby called', { code, playerId, displayName })
  if (!supabase) throw new Error('Supabase is not configured')

  const normalized = code.trim().toUpperCase()
  const { data: lobby, error: lobbyError } = await supabase
    .from('lobbies')
    .select()
    .eq('code', normalized)
    .maybeSingle()

  if (lobbyError) {
    debugError('LobbyAPI', 'joinLobby fetch lobby failed', lobbyError)
    throw lobbyError
  }
  if (!lobby) {
    debug('LobbyAPI', 'joinLobby lobby not found', { normalized })
    throw new Error('Lobby not found')
  }
  if (lobby.status !== 'waiting') {
    debug('LobbyAPI', 'joinLobby game already started', { status: lobby.status })
    throw new Error('This game already started')
  }

  debug('LobbyAPI', 'joinLobby found lobby', lobby)

  const { data: existingPlayers, error: playersError } = await supabase
    .from('lobby_players')
    .select()
    .eq('lobby_id', lobby.id)

  if (playersError) {
    debugError('LobbyAPI', 'joinLobby fetch players failed', playersError)
    throw playersError
  }

  debug('LobbyAPI', 'joinLobby existing players', existingPlayers)

  const alreadyJoined = existingPlayers?.some((p) => p.player_id === playerId)
  if (alreadyJoined) {
    const self = existingPlayers!.find((p) => p.player_id === playerId)!
    debug('LobbyAPI', 'joinLobby player already in lobby', self)
    return { lobby, player: self }
  }

  if ((existingPlayers?.length ?? 0) >= 2) {
    debug('LobbyAPI', 'joinLobby lobby full')
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

  if (playerError) {
    debugError('LobbyAPI', 'joinLobby insert player failed', playerError)
    throw playerError
  }

  debug('LobbyAPI', 'joinLobby success', { lobby, player })
  return { lobby, player }
}

export async function fetchLobbyState(lobbyId: string): Promise<{
  lobby: Lobby | null
  players: LobbyPlayer[]
}> {
  if (!supabase) {
    debug('LobbyAPI', 'fetchLobbyState skipped — no supabase client')
    return { lobby: null, players: [] }
  }

  const [{ data: lobby, error: lobbyError }, { data: players, error: playersError }] =
    await Promise.all([
      supabase.from('lobbies').select().eq('id', lobbyId).maybeSingle(),
      supabase
        .from('lobby_players')
        .select()
        .eq('lobby_id', lobbyId)
        .order('slot'),
    ])

  if (lobbyError) debugError('LobbyAPI', 'fetchLobbyState lobby error', lobbyError)
  if (playersError) debugError('LobbyAPI', 'fetchLobbyState players error', playersError)

  debug('LobbyAPI', 'fetchLobbyState result', { lobby, players })

  return { lobby, players: players ?? [] }
}

export async function setPlayerReady(
  lobbyId: string,
  playerId: string,
  ready: boolean,
): Promise<void> {
  debug('LobbyAPI', 'setPlayerReady', { lobbyId, playerId, ready })
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from('lobby_players')
    .update({ is_ready: ready })
    .eq('lobby_id', lobbyId)
    .eq('player_id', playerId)

  if (error) {
    debugError('LobbyAPI', 'setPlayerReady failed', error)
    throw error
  }
  debug('LobbyAPI', 'setPlayerReady success')
}

export async function submitSmileScore(
  lobbyId: string,
  playerId: string,
  score: number,
): Promise<void> {
  debug('LobbyAPI', 'submitSmileScore', { lobbyId, playerId, score })
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from('lobby_players')
    .update({ smile_score: Math.round(score * 10) / 10 })
    .eq('lobby_id', lobbyId)
    .eq('player_id', playerId)

  if (error) {
    debugError('LobbyAPI', 'submitSmileScore failed', error)
    throw error
  }
  debug('LobbyAPI', 'submitSmileScore success')
}

export async function maybeAdvanceLobby(
  lobby: Lobby,
  players: LobbyPlayer[],
  actorPlayerId: string,
): Promise<void> {
  if (!supabase) return

  // Only the lobby host advances state to avoid races between both clients
  if (actorPlayerId !== lobby.host_player_id) return

  const bothReady =
    players.length === 2 && players.every((player) => player.is_ready)
  const now = Date.now()

  if (lobby.status === 'waiting' && bothReady) {
    const gameStartAt = new Date(now + COUNTDOWN_DURATION_MS).toISOString()
    debug('LobbyAPI', 'Advancing: waiting → countdown', { gameStartAt })
    const { error } = await supabase
      .from('lobbies')
      .update({
        status: 'countdown',
        countdown_starts_at: new Date().toISOString(),
        started_at: gameStartAt,
      })
      .eq('id', lobby.id)
      .eq('status', 'waiting')
    if (error) debugError('LobbyAPI', 'Advance to countdown failed', error)
    return
  }

  if (lobby.status === 'countdown' && lobby.started_at) {
    const gameStart = new Date(lobby.started_at).getTime()
    if (now >= gameStart) {
      debug('LobbyAPI', 'Advancing: countdown → active')
      const { error } = await supabase
        .from('lobbies')
        .update({ status: 'active' })
        .eq('id', lobby.id)
        .eq('status', 'countdown')
      if (error) debugError('LobbyAPI', 'Advance to active failed', error)
    }
    return
  }

  if (lobby.status === 'active' && lobby.started_at) {
    const gameEnd =
      new Date(lobby.started_at).getTime() + CHALLENGE_DURATION_MS
    if (now >= gameEnd) {
      debug('LobbyAPI', 'Advancing: active → finished')
      const { error } = await supabase
        .from('lobbies')
        .update({ status: 'finished' })
        .eq('id', lobby.id)
        .eq('status', 'active')
      if (error) debugError('LobbyAPI', 'Advance to finished failed', error)
    }
  }
}

export async function leaveLobby(
  lobbyId: string,
  playerId: string,
): Promise<void> {
  debug('LobbyAPI', 'leaveLobby', { lobbyId, playerId })
  if (!supabase) return

  const { error: deleteError } = await supabase
    .from('lobby_players')
    .delete()
    .eq('lobby_id', lobbyId)
    .eq('player_id', playerId)

  if (deleteError) debugError('LobbyAPI', 'leaveLobby delete player failed', deleteError)

  const { data: remaining, error: remainingError } = await supabase
    .from('lobby_players')
    .select('id')
    .eq('lobby_id', lobbyId)

  if (remainingError) debugError('LobbyAPI', 'leaveLobby count remaining failed', remainingError)

  debug('LobbyAPI', 'leaveLobby remaining players', remaining)

  if (!remaining?.length) {
    debug('LobbyAPI', 'leaveLobby deleting empty lobby')
    const { error } = await supabase.from('lobbies').delete().eq('id', lobbyId)
    if (error) debugError('LobbyAPI', 'leaveLobby delete lobby failed', error)
  }
}
