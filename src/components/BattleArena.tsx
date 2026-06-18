import { useEffect, useMemo, useRef, useState } from 'react'
import { CHALLENGE_DURATION_MS, COUNTDOWN_DURATION_MS } from '../lib/constants'
import { useSmileDetection } from '../hooks/useSmileDetection'
import type { Lobby, LobbyPlayer } from '../types'
import { VideoTile } from './VideoTile'

interface BattleArenaProps {
  lobby: Lobby
  me: LobbyPlayer
  opponent: LobbyPlayer | null
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  onScoreFinalized: (score: number) => void
  onLeave: () => void
}

export function BattleArena({
  lobby,
  me,
  opponent,
  localStream,
  remoteStream,
  onScoreFinalized,
  onLeave,
}: BattleArenaProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = localVideoRef.current
    if (!video || !localStream) return
    video.srcObject = localStream
  }, [localStream])

  const phase = useMemo(() => {
    if (lobby.status === 'countdown' && lobby.countdown_starts_at) {
      return 'countdown' as const
    }
    if (lobby.status === 'active' && lobby.started_at) {
      return 'active' as const
    }
    if (lobby.status === 'finished') {
      return 'finished' as const
    }
    return 'waiting' as const
  }, [lobby])

  const [countdownValue, setCountdownValue] = useState(3)
  const [timeLeftMs, setTimeLeftMs] = useState(CHALLENGE_DURATION_MS)
  const scoreReported = useRef(false)

  const { liveScore, finalScore, ready: modelsReady } = useSmileDetection(
    localVideoRef,
    phase === 'active',
  )

  useEffect(() => {
    if (phase !== 'countdown' || !lobby.countdown_starts_at) return

    const tick = () => {
      const elapsed = Date.now() - new Date(lobby.countdown_starts_at!).getTime()
      const remaining = Math.ceil((COUNTDOWN_DURATION_MS - elapsed) / 1000)
      setCountdownValue(Math.max(remaining, 0))
    }

    tick()
    const interval = window.setInterval(tick, 100)
    return () => window.clearInterval(interval)
  }, [phase, lobby.countdown_starts_at])

  useEffect(() => {
    if (phase !== 'active' || !lobby.started_at) return

    const tick = () => {
      const elapsed = Date.now() - new Date(lobby.started_at!).getTime()
      setTimeLeftMs(Math.max(CHALLENGE_DURATION_MS - elapsed, 0))
    }

    tick()
    const interval = window.setInterval(tick, 50)
    return () => window.clearInterval(interval)
  }, [phase, lobby.started_at])

  useEffect(() => {
    if (phase !== 'finished') return

    const submit = (score: number) => {
      if (scoreReported.current) return
      scoreReported.current = true
      onScoreFinalized(score)
    }

    if (finalScore != null) {
      submit(finalScore)
      return
    }

    const timeout = window.setTimeout(() => submit(liveScore), 800)
    return () => window.clearTimeout(timeout)
  }, [phase, finalScore, liveScore, onScoreFinalized])

  const myScore =
    phase === 'finished' ? (me.smile_score || finalScore || liveScore) : liveScore
  const opponentScore = opponent?.smile_score ?? null

  const winner =
    phase === 'finished' && opponent && opponent.smile_score > 0
      ? me.smile_score === opponent.smile_score
        ? 'tie'
        : me.smile_score > opponent.smile_score
          ? 'you'
          : 'opponent'
      : null

  return (
    <div className="panel battle-panel">
      <div className="battle-top">
        <div>
          <p className="eyebrow">Smile Battle</p>
          <h2>
            {phase === 'countdown' && `Get ready… ${countdownValue}`}
            {phase === 'active' && `Smile! ${(timeLeftMs / 1000).toFixed(1)}s`}
            {phase === 'finished' && 'Results'}
          </h2>
        </div>
        <button className="btn ghost" onClick={onLeave}>
          Leave
        </button>
      </div>

      {phase === 'countdown' && (
        <div className="countdown-overlay">
          <span className="countdown-number">{countdownValue || 'GO'}</span>
        </div>
      )}

      <div className="video-grid">
        <div className="video-tile">
          <div className="video-tile__header">
            <span>You</span>
            <span className="video-tile__score">{myScore}</span>
          </div>
          <div className="video-tile__frame">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="mirrored"
            />
          </div>
          {!modelsReady && phase === 'active' && (
            <p className="hint">Loading smile detector…</p>
          )}
        </div>

        <VideoTile
          stream={remoteStream}
          label={opponent?.display_name ?? 'Opponent'}
          score={phase === 'finished' ? opponentScore : null}
          placeholder="Opponent video"
        />
      </div>

      {phase === 'active' && (
        <div className="score-meter">
          <div className="score-meter__fill" style={{ width: `${liveScore}%` }} />
          <span>Live smile score: {liveScore}</span>
        </div>
      )}

      {phase === 'finished' && (
        <div className="results-card">
          <p className="results-line">
            You: <strong>{me.smile_score}</strong>
          </p>
          {opponent && (
            <p className="results-line">
              {opponent.display_name}: <strong>{opponent.smile_score}</strong>
            </p>
          )}
          <p className="winner-text">
            {winner === 'tie' && "It's a tie! Nobody out-smiled the other."}
            {winner === 'you' && 'You win! Best smile in the room.'}
            {winner === 'opponent' && `${opponent?.display_name} wins this round.`}
            {winner === null && 'Waiting for final scores…'}
          </p>
        </div>
      )}
    </div>
  )
}
