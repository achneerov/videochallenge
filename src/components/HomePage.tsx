import { useState } from 'react'
import { createLobby, joinLobby } from '../lib/lobby'
import { debug, debugError } from '../lib/debug'
import { getSavedDisplayName, saveDisplayName } from '../lib/player'
import { isSupabaseConfigured } from '../lib/supabase'

interface HomePageProps {
  playerId: string
  onEnterLobby: (lobbyId: string) => void
}

export function HomePage({ playerId, onEnterLobby }: HomePageProps) {
  const [name, setName] = useState(getSavedDisplayName())
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  debug('HomePage', 'render', { playerId, isSupabaseConfigured })

  const trimmedName = name.trim()

  const handleCreate = async () => {
    debug('HomePage', 'create clicked', { trimmedName, playerId })
    if (!trimmedName) {
      setError('Enter your name first')
      return
    }
    setLoading(true)
    setError(null)
    try {
      saveDisplayName(trimmedName)
      const { lobby } = await createLobby(playerId, trimmedName)
      debug('HomePage', 'create success, entering lobby', lobby.id)
      onEnterLobby(lobby.id)
    } catch (err) {
      debugError('HomePage', 'create failed', err)
      setError(err instanceof Error ? err.message : 'Could not create lobby')
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async () => {
    debug('HomePage', 'join clicked', { trimmedName, joinCode, playerId })
    if (!trimmedName) {
      setError('Enter your name first')
      return
    }
    if (!joinCode.trim()) {
      setError('Enter a lobby code')
      return
    }
    setLoading(true)
    setError(null)
    try {
      saveDisplayName(trimmedName)
      const { lobby } = await joinLobby(joinCode, playerId, trimmedName)
      debug('HomePage', 'join success, entering lobby', lobby.id)
      onEnterLobby(lobby.id)
    } catch (err) {
      debugError('HomePage', 'join failed', err)
      setError(err instanceof Error ? err.message : 'Could not join lobby')
    } finally {
      setLoading(false)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="panel setup-panel">
        <h1>Smile Battle</h1>
        <p className="lede">1v1 smile challenge over live video.</p>
        <div className="callout error-callout">
          <strong>Supabase not configured</strong>
          <p>
            Copy <code>.env.example</code> to <code>.env</code>, add your free
            Supabase project URL and anon key, run the migration in{' '}
            <code>supabase/migrations/001_initial.sql</code>, then restart the
            dev server.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="panel home-panel">
      <div className="badge">1v1 live video</div>
      <h1>Smile Battle</h1>
      <p className="lede">
        Face off in a 10-second smile showdown. Highest smile score wins.
      </p>

      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Smile Master"
          maxLength={24}
        />
      </label>

      <div className="home-actions">
        <button className="btn primary" onClick={handleCreate} disabled={loading}>
          Create lobby
        </button>
      </div>

      <div className="divider">or join with code</div>

      <label className="field">
        <span>Lobby code</span>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="ABC123"
          maxLength={6}
        />
      </label>

      <button className="btn secondary" onClick={handleJoin} disabled={loading}>
        Join lobby
      </button>

      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
