import { debug } from './debug'

const PLAYER_ID_KEY = 'smile-battle-player-id'
const DISPLAY_NAME_KEY = 'smile-battle-display-name'

export function getPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(PLAYER_ID_KEY, id)
    debug('Player', 'generated new playerId', id)
  }
  return id
}

export function getSavedDisplayName(): string {
  const name = localStorage.getItem(DISPLAY_NAME_KEY) ?? ''
  debug('Player', 'loaded display name', name || '(empty)')
  return name
}

export function saveDisplayName(name: string): void {
  debug('Player', 'saving display name', name)
  localStorage.setItem(DISPLAY_NAME_KEY, name.trim())
}
