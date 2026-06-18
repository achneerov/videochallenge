import { useEffect, useRef } from 'react'
import { debug, diag } from '../lib/debug'

interface VideoTileProps {
  stream: MediaStream | null
  label: string
  score?: number | null
  mirrored?: boolean
  placeholder?: string
}

export function VideoTile({
  stream,
  label,
  score,
  mirrored = false,
  placeholder = 'Waiting for opponent…',
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (stream) {
      diag('Video', `attaching stream for "${label}"`, {
        streamId: stream.id,
        tracks: stream.getTracks().map((t) => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState,
        })),
      })
      debug('VideoTile', `attaching stream for "${label}"`, {
        streamId: stream.id,
        tracks: stream.getTracks().map((t) => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState,
        })),
      })
      if (video.srcObject !== stream) {
        video.srcObject = stream
      }
      void video.play().catch((err) => {
        diag('Video', `play() failed for "${label}"`, err)
        debug('VideoTile', `play() failed for "${label}"`, err)
      })
    } else {
      diag('Video', `no stream for "${label}"`)
      video.srcObject = null
    }
  }, [stream, label])

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
      </div>
    </div>
  )
}
