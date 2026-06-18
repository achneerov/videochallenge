const PLAYER_ID_KEY = 'smile-battle-player-id'
const DISPLAY_NAME_KEY = 'smile-battle-display-name'

export function getPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(PLAYER_ID_KEY, id)
  }
  return id
}

export function getSavedDisplayName(): string {
  return localStorage.getItem(DISPLAY_NAME_KEY) ?? ''
}

export function saveDisplayName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name.trim())
}
