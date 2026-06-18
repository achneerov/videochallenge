import { useCallback, useEffect, useState } from 'react'
import { BattleArena } from './components/BattleArena'
import { HomePage } from './components/HomePage'
import { WaitingRoom } from './components/WaitingRoom'
import { useLobby } from './hooks/useLobby'
import { useWebRTC } from './hooks/useWebRTC'
import { debug } from './lib/debug'
import { leaveLobby } from './lib/lobby'
import { getPlayerId } from './lib/player'

export default function App() {
  const playerId = getPlayerId()
  const [lobbyId, setLobbyId] = useState<string | null>(null)

  debug('App', 'render', { playerId, lobbyId })

  const {
    lobby,
    players,
    me,
    opponent,
    loading,
    error,
    toggleReady,
    reportScore,
  } = useLobby(lobbyId, playerId)

  const isHost = me?.slot === 1
  const webrtcEnabled = Boolean(lobbyId && players.length === 2)
  const { localStream, remoteStream, connected, error: rtcError } = useWebRTC(
    lobbyId,
    playerId,
    Boolean(isHost),
    webrtcEnabled,
  )

  useEffect(() => {
    debug('App', 'lobby state', {
      lobbyId,
      lobbyStatus: lobby?.status,
      lobbyCode: lobby?.code,
      playerCount: players.length,
      me: me ? { slot: me.slot, name: me.display_name, ready: me.is_ready } : null,
      opponent: opponent
        ? { slot: opponent.slot, name: opponent.display_name, ready: opponent.is_ready }
        : null,
      isHost,
      webrtcEnabled,
      connected,
      loading,
      error,
      rtcError,
    })
  }, [
    lobbyId,
    lobby,
    players,
    me,
    opponent,
    isHost,
    webrtcEnabled,
    connected,
    loading,
    error,
    rtcError,
  ])

  const handleEnterLobby = useCallback((id: string) => {
    debug('App', 'entering lobby', { id })
    setLobbyId(id)
  }, [])

  const handleLeave = useCallback(async () => {
    debug('App', 'leaving lobby', { lobbyId })
    if (lobbyId) {
      await leaveLobby(lobbyId, playerId)
    }
    setLobbyId(null)
  }, [lobbyId, playerId])

  const handleScoreFinalized = useCallback(
    (score: number) => {
      debug('App', 'score finalized', { score })
      void reportScore(score)
    },
    [reportScore],
  )

  if (!lobbyId) {
    debug('App', 'phase: home')
    return (
      <main className="app-shell">
        <HomePage playerId={playerId} onEnterLobby={handleEnterLobby} />
      </main>
    )
  }

  if (loading || !lobby || !me) {
    debug('App', 'phase: loading', { loading, hasLobby: Boolean(lobby), hasMe: Boolean(me) })
    return (
      <main className="app-shell">
        <div className="panel">
          <p>Loading lobby…</p>
        </div>
      </main>
    )
  }

  const inBattle =
    lobby.status === 'countdown' ||
    lobby.status === 'active' ||
    lobby.status === 'finished'

  debug('App', 'phase decision', { phase: inBattle ? 'battle' : 'waiting', status: lobby.status })

  return (
    <main className="app-shell">
      {inBattle ? (
        <BattleArena
          lobby={lobby}
          me={me}
          opponent={opponent}
          localStream={localStream}
          remoteStream={remoteStream}
          onScoreFinalized={handleScoreFinalized}
          onLeave={handleLeave}
        />
      ) : (
        <WaitingRoom
          lobby={lobby}
          me={me}
          players={players}
          opponent={opponent}
          connected={connected}
          localStream={localStream}
          remoteStream={remoteStream}
          onReady={toggleReady}
          onLeave={handleLeave}
          error={error ?? rtcError}
        />
      )}
    </main>
  )
}
