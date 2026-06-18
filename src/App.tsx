import { useCallback, useState } from 'react'
import { BattleArena } from './components/BattleArena'
import { HomePage } from './components/HomePage'
import { WaitingRoom } from './components/WaitingRoom'
import { useLobby } from './hooks/useLobby'
import { useWebRTC } from './hooks/useWebRTC'
import { leaveLobby } from './lib/lobby'
import { getPlayerId } from './lib/player'

export default function App() {
  const [playerId] = useState(() => getPlayerId())
  const [lobbyId, setLobbyId] = useState<string | null>(null)

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

  const isHost = Boolean(lobby && lobby.host_player_id === playerId)
  const webrtcEnabled = Boolean(lobbyId && lobby && me && players.length === 2)
  const { localStream, remoteStream, connected, error: rtcError } = useWebRTC(
    lobbyId,
    playerId,
    isHost,
    webrtcEnabled,
  )

  const handleEnterLobby = useCallback((id: string) => {
    setLobbyId(id)
  }, [])

  const handleLeave = useCallback(async () => {
    if (lobbyId) {
      await leaveLobby(lobbyId, playerId)
    }
    setLobbyId(null)
  }, [lobbyId, playerId])

  const handleScoreFinalized = useCallback(
    (score: number) => {
      void reportScore(score)
    },
    [reportScore],
  )

  if (!lobbyId) {
    return (
      <main className="app-shell">
        <HomePage playerId={playerId} onEnterLobby={handleEnterLobby} />
      </main>
    )
  }

  if (loading || !lobby || !me) {
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
