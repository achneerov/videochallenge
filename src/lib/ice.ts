import { diag } from './debug'

const STUN_FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

let cachedServers: RTCIceServer[] | null = null
let cachedHasTurn = false

function urlsIncludeTurn(urls: string | string[]): boolean {
  const list = Array.isArray(urls) ? urls : [urls]
  return list.some((u) => u.startsWith('turn:') || u.startsWith('turns:'))
}

function serversHaveTurn(servers: RTCIceServer[]): boolean {
  return servers.some((s) => urlsIncludeTurn(s.urls))
}

function buildCredentialsUrl(): string | null {
  const direct = import.meta.env.VITE_METERED_TURN_URL as string | undefined
  if (direct?.trim()) return direct.trim()

  const app = import.meta.env.VITE_METERED_APP as string | undefined
  const apiKey = import.meta.env.VITE_METERED_API_KEY as string | undefined
  if (app?.trim() && apiKey?.trim()) {
    return `https://${app.trim()}.metered.live/api/v1/turn/credentials?apiKey=${apiKey.trim()}`
  }

  return null
}

export async function resolveIceServers(): Promise<{
  servers: RTCIceServer[]
  hasTurn: boolean
}> {
  if (cachedServers) {
    return { servers: cachedServers, hasTurn: cachedHasTurn }
  }

  const credentialsUrl = buildCredentialsUrl()
  if (credentialsUrl) {
    try {
      const response = await fetch(credentialsUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = (await response.json()) as RTCIceServer[]
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('empty iceServers response')
      }
      cachedServers = data
      cachedHasTurn = serversHaveTurn(data)
      diag('RTC', 'TURN credentials loaded', {
        serverCount: data.length,
        hasTurn: cachedHasTurn,
        urls: data.map((s) => s.urls),
      })
      return { servers: cachedServers, hasTurn: cachedHasTurn }
    } catch (err) {
      diag('RTC', 'TURN credential fetch FAILED', { err, credentialsUrl })
    }
  } else {
    diag(
      'RTC',
      'TURN not configured — set VITE_METERED_TURN_URL or VITE_METERED_APP + VITE_METERED_API_KEY',
    )
  }

  cachedServers = STUN_FALLBACK
  cachedHasTurn = false
  return { servers: cachedServers, hasTurn: false }
}

export function resetIceServerCache(): void {
  cachedServers = null
  cachedHasTurn = false
}
