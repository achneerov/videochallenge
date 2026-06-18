import { useEffect, useRef } from 'react'
import { debug, diag } from '../lib/debug'
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
  turnConfigured: boolean
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
  turnConfigured,
}: WaitingRoomProps) {
  const videoStatusRef = useRef({
    connected,
    hasLocal: Boolean(localStream),
    hasRemote: Boolean(remoteStream),
  })

  useEffect(() => {
    const prev = videoStatusRef.current
    const next = {
      connected,
      hasLocal: Boolean(localStream),
      hasRemote: Boolean(remoteStream),
    }
    if (
      prev.connected !== next.connected ||
      prev.hasLocal !== next.hasLocal ||
      prev.hasRemote !== next.hasRemote
    ) {
      diag('Lobby', 'video status changed', { ...next, error })
      videoStatusRef.current = next
    }
    debug('WaitingRoom', 'render state', {
      code: lobby.code,
      status: lobby.status,
      playerCount: players.length,
      me: { name: me.display_name, ready: me.is_ready, slot: me.slot },
      opponent: opponent
        ? { name: opponent.display_name, ready: opponent.is_ready, slot: opponent.slot }
        : null,
      connected,
      hasLocalStream: Boolean(localStream),
      hasRemoteStream: Boolean(remoteStream),
      error,
    })
  }, [lobby, me, players, opponent, connected, localStream, remoteStream, error])

  return (
    <div className="panel lobby-panel">
      <div className="lobby-top">
        <div>
          <p className="eyebrow">Lobby code</p>
          <h2 className="lobby-code">{lobby.code}</h2>
        </div>
        <button
          className="btn ghost"
          onClick={() => {
            debug('WaitingRoom', 'leave clicked')
            onLeave()
          }}
        >
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

      {players.length >= 1 && (
        <p className="hint rtc-status">
          Video debug — you: {localStream ? 'on' : 'off'} · opponent:{' '}
          {remoteStream ? 'on' : 'off'} · link: {connected ? 'connected' : 'connecting…'}
          {!turnConfigured && ' · TURN missing'}
        </p>
      )}

      {!turnConfigured && (
        <p className="error-text">
          Remote video needs a TURN server. Sign up free at metered.ca/tools/openrelay, then add{' '}
          <code>VITE_METERED_API_KEY</code> and <code>VITE_METERED_APP</code> to Cloudflare Pages env
          vars and redeploy.
        </p>
      )}

      <div className="ready-row">
        <button
          className={`btn ${me.is_ready ? 'secondary' : 'primary'}`}
          onClick={() => {
            debug('WaitingRoom', 'ready toggle', { current: me.is_ready, next: !me.is_ready })
            onReady(!me.is_ready)
          }}
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
