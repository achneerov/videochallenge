/** Verbose logs: dev server, or `localStorage.setItem('smile-battle-debug', '1')` in prod */
export function isVerboseDebug(): boolean {
  if (import.meta.env.DEV) return true
  try {
    return localStorage.getItem('smile-battle-debug') === '1'
  } catch {
    return false
  }
}

export function debug(scope: string, message: string, data?: unknown): void {
  if (!isVerboseDebug()) return
  const prefix = `[SmileBattle:${scope}]`
  if (data !== undefined) {
    console.log(prefix, message, data)
  } else {
    console.log(prefix, message)
  }
}

export function debugError(scope: string, message: string, error?: unknown): void {
  console.error(`[SmileBattle:${scope}]`, message, error)
}

export function debugWarn(scope: string, message: string, data?: unknown): void {
  if (!isVerboseDebug()) return
  const prefix = `[SmileBattle:${scope}]`
  if (data !== undefined) {
    console.warn(prefix, message, data)
  } else {
    console.warn(prefix, message)
  }
}

/** Always-on low-volume logs for diagnosing WebRTC in production */
export function diag(scope: string, message: string, data?: unknown): void {
  const prefix = `[SmileBattle:${scope}]`
  if (data !== undefined) {
    console.info(prefix, message, data)
  } else {
    console.info(prefix, message)
  }
}

export function maskSecret(value: string | undefined): string {
  if (!value) return '(missing)'
  if (value.length <= 12) return '***'
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}
