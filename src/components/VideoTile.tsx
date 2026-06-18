import { useEffect, useRef, useState } from 'react'
import { debug, diag } from '../lib/debug'

interface VideoTileProps {
  stream: MediaStream | null
  label: string
  score?: number | null
  mirrored?: boolean
  placeholder?: string
}

async function startPlayback(video: HTMLVideoElement, label: string): Promise<boolean> {
  try {
    if (video.paused) await video.play()
    return video.videoWidth > 0
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      try {
        if (video.paused) await video.play()
        return video.videoWidth > 0
      } catch {
        return false
      }
    }
    diag('Video', `play() failed for "${label}"`, err)
    return false
  }
}

export function VideoTile({
  stream,
  label,
  score,
  mirrored = false,
  placeholder = 'Waiting for opponent…',
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const labelRef = useRef(label)
  const [hasFrames, setHasFrames] = useState(false)
  labelRef.current = label

  useEffect(() => {
    setHasFrames(false)
    const video = videoRef.current
    if (!video) return

    if (!stream) {
      diag('Video', `no stream for "${labelRef.current}"`)
      video.srcObject = null
      return
    }

    if (video.srcObject !== stream) {
      video.srcObject = stream
    }

    diag('Video', `attaching stream for "${labelRef.current}"`, {
      streamId: stream.id,
      tracks: stream.getTracks().map((t) => ({
        kind: t.kind,
        enabled: t.enabled,
        readyState: t.readyState,
      })),
    })
    debug('VideoTile', `attaching stream for "${labelRef.current}"`, {
      streamId: stream.id,
    })

    let cancelled = false

    const reportPlayback = async () => {
      const ok = await startPlayback(video, labelRef.current)
      if (cancelled) return
      if (ok || video.videoWidth > 0) {
        setHasFrames(true)
        diag('Video', `playing "${labelRef.current}"`, {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        })
      }
    }

    const onReady = () => void reportPlayback()

    video.addEventListener('loadedmetadata', onReady)
    video.addEventListener('resize', onReady)
    void reportPlayback()

    // ICE can negotiate before frames arrive — keep trying briefly
    const poll = window.setInterval(() => {
      if (cancelled) return
      if (video.videoWidth > 0) {
        setHasFrames(true)
        diag('Video', `frames arrived for "${labelRef.current}"`, {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        })
        window.clearInterval(poll)
        return
      }
      void video.play().catch(() => {})
    }, 500)

    const pollTimeout = window.setTimeout(() => window.clearInterval(poll), 30_000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      window.clearTimeout(pollTimeout)
      video.removeEventListener('loadedmetadata', onReady)
      video.removeEventListener('resize', onReady)
    }
  }, [stream])

  const showConnectingOverlay = stream != null && !hasFrames && !mirrored

  return (
    <div className="video-tile">
      <div className="video-tile__header">
        <span>{label}</span>
        {score != null && <span className="video-tile__score">{score}</span>}
      </div>
      <div className="video-tile__frame">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={mirrored ? 'mirrored' : undefined}
        />
        {!stream && (
          <div className="video-tile__placeholder">{placeholder}</div>
        )}
        {showConnectingOverlay && (
          <div className="video-tile__placeholder video-tile__placeholder--overlay">
            Connecting video…
          </div>
        )}
      </div>
    </div>
  )
}
