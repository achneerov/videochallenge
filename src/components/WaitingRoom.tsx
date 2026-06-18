import { VideoTile } from './VideoTile'
import type { Lobby, LobbyPlayer } from '../types'

interface WaitingRoomProps {
  lobby: Lobby
  me: LobbyPlayer
  players: LobbyPlayer[]
  opponent: LobbyPlayer | null
  connected: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  onReady: (ready: boolean) => void
  onLeave: () => void
  error: string | null
}

export function WaitingRoom({
  lobby,
  me,
  players,
  opponent,
  connected,
  localStream,
  remoteStream,
  onReady,
  onLeave,
  error,
}: WaitingRoomProps) {
  return (
    <div className="panel lobby-panel">
      <div className="lobby-top">
        <div>
          <p className="eyebrow">Lobby code</p>
          <h2 className="lobby-code">{lobby.code}</h2>
        </div>
        <button className="btn ghost" onClick={onLeave}>
          Leave
        </button>
      </div>

      <p className="lede">
        {players.length < 2
          ? 'Share the code with your opponent and wait for them to join.'
          : connected
            ? 'You are connected. Hit ready when you want to battle.'
            : 'Opponent joined. Connecting video…'}
      </p>

      <div className="video-grid">
        <VideoTile
          stream={localStream}
          label={`You (${me.display_name})`}
          mirrored
          placeholder="Starting camera…"
        />
        <VideoTile
          stream={remoteStream}
          label={opponent ? opponent.display_name : 'Opponent'}
          placeholder={
            players.length < 2 ? 'Waiting for opponent…' : 'Connecting video…'
          }
        />
      </div>

      <div className="ready-row">
        <button
          className={`btn ${me.is_ready ? 'secondary' : 'primary'}`}
          onClick={() => onReady(!me.is_ready)}
          disabled={players.length < 2}
        >
          {me.is_ready ? 'Cancel ready' : 'Ready to smile'}
        </button>
        {players.length === 2 && (
          <p className="ready-status">
            {players.every((p) => p.is_ready)
              ? 'Both ready — starting soon!'
              : opponent?.is_ready
                ? 'Opponent is ready'
                : 'Waiting for opponent to ready up'}
          </p>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
