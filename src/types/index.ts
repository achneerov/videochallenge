export type LobbyStatus = 'waiting' | 'countdown' | 'active' | 'finished'

export interface Lobby {
  id: string
  code: string
  status: LobbyStatus
  host_player_id: string
  countdown_starts_at: string | null
  started_at: string | null
  created_at: string
}

export interface LobbyPlayer {
  id: string
  lobby_id: string
  player_id: string
  display_name: string
  slot: 1 | 2
  is_ready: boolean
  smile_score: number
  created_at: string
}

export type SignalPayload =
  | { type: 'hello'; from: string }
  | { type: 'offer'; sdp: string; from: string }
  | { type: 'answer'; sdp: string; from: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit; from: string }

export type AppPhase = 'home' | 'lobby' | 'game'
